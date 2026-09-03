import type { Tablo } from "../db/sema";
import { veriSorgulaAraci } from "../db/aracSorgu";
import type { OlcumSonucu } from "../ajan/olcum";
import { dataAnalyst } from "../../agents/data-analyst";
import { buildEntityQuery, pickAnalysisColumns } from "./nedenAnalizi";
import { detectShape } from "./soruSekli";
import {
  buildCountQuery, buildRankingQuery, pickRankingColumn, readCount,
  tutarSoruluyorMu,
} from "./sayimSiralama";
import { parseTimeRange, timeRangeLabel, type TimeRange } from "./zamanAraligi";

/**
 * DOGRUDAN CEVABIN KOD YOLU.
 *
 * Ajana yazdirilan sorgu kosudan kosuya degisiyordu: bir kosu 73 satir
 * (52 musteri), digeri `AND Tutar IS NOT NULL` ekleyip 33 satir (23
 * musteri) dondurdu. Ikisi de veriye gore dogru ama SORULAN sey degil --
 * tutari kaydedilmemis musteri de satin alim yapmistir.
 *
 * HIBRIT: kod yalnizca TANIYABILDIGI sekli cozer, gerisini ajana birakir.
 * Bugun uc sekil taniniyor:
 *
 *   liste     -- "<tablo>'dan <varlik> bazinda adet ve tutar"
 *   sayim     -- "Bu ay kac bilet acildi?"     -> tek sayi
 *   siralama  -- "En cok satan urunler"        -> sirali kucuk tablo
 *
 * Taninmayan soru ajana gider; her soruyu koda almak giderek bir sorgu
 * diline donusurdu.
 */

interface Ortak {
  tablo: Tablo;
  range: TimeRange;
  /** Kullaniciya gosterilecek aralik etiketi. */
  rangeLabel: string;
}

/**
 * Ayrik birlesim: her sekil YALNIZCA kendi alanlarini tasir.
 *
 * Istege bagli alanlarla tek nesne tutmak, siralamaya ait kolonu sayim
 * planinda okumayi mumkun kilardi ve derleyici bunu yakalayamazdi.
 */
export type DirectAnswerPlan =
  | (Ortak & { sekil: "liste" })
  | (Ortak & { sekil: "sayim" })
  | (Ortak & {
      sekil: "siralama";
      kolon: string;
      yon: "ust" | "alt";
      tutarMi: boolean;
    });

/**
 * Soru kodun cozebilecegi sekle uyuyor mu?
 *
 * Tablo, varlik/tarih kolonu ve zaman araligi UCU DE gerekli; biri
 * eksikse `null` doner ve cagiran taraf ajana duser. Tahmin etmiyoruz.
 */
export function planDirectAnswer(
  tablo: Tablo | null,
  zamanAraligi: string | null | undefined,
  soru = ""
): DirectAnswerPlan | null {
  if (!tablo) return null;

  // Varlik ve tarih kolonu yoksa hicbir sekil kurulamaz.
  const k = pickAnalysisColumns(tablo);
  if (!k) return null;

  const range = parseTimeRange(zamanAraligi);
  if (!range) return null;

  const ortak: Ortak = { tablo, range, rangeLabel: timeRangeLabel(range) };
  const sekil = detectShape(soru);

  if (sekil?.kind === "sayim") return { ...ortak, sekil: "sayim" };

  if (sekil?.kind === "siralama") {
    const kolon = pickRankingColumn(tablo, soru);
    // Hangi kolona gruplanacagi anlasilamadiysa ajana dusuyoruz;
    // rastgele bir kolona gruplamak sessizce yanlis cevap uretirdi.
    if (!kolon) return null;
    return {
      ...ortak, sekil: "siralama", kolon, yon: sekil.yon,
      tutarMi: tutarSoruluyorMu(soru),
    };
  }

  return { ...ortak, sekil: "liste" };
}

/** Plandan SQL. Ayri tutuluyor ki sorgu calistirmadan test edilebilsin. */
export function buildDirectQuery(plan: DirectAnswerPlan): string {
  const k = pickAnalysisColumns(plan.tablo)!;
  switch (plan.sekil) {
    case "sayim": return buildCountQuery(k, plan.range);
    case "siralama":
      return buildRankingQuery(k, plan.kolon, plan.range, plan.yon, plan.tutarMi);
    case "liste": return buildEntityQuery(k, plan.range);
  }
}

/** Sonucu tek cumleyle anlatir; sekil basina farkli. */
function cevapMetni(
  plan: DirectAnswerPlan, kolonlar: string[], satirlar: unknown[][]
): string {
  if (plan.sekil === "sayim") {
    const c = readCount(kolonlar, satirlar);
    if (c.adet === 0) return `Bu aralıkta kayıt yok (${plan.rangeLabel}).`;

    // Varlik kolonunun GERCEK adi yaziliyor. "benzersiz kayit sahibi"
    // gibi genel bir ifade neyin sayildigini gizler; ozet katmani da
    // ayni sekilde kolon adini gosteriyor.
    const k = pickAnalysisColumns(plan.tablo);
    const parcalar = [`${c.adet.toLocaleString("tr-TR")} kayıt`];
    if (c.varlik != null && k) {
      parcalar.push(`${c.varlik.toLocaleString("tr-TR")} benzersiz ${k.varlik}`);
    }
    return `${parcalar.join(" · ")} (${plan.rangeLabel}).`;
  }

  if (plan.sekil === "siralama") {
    const yon = plan.yon === "ust" ? "En çok" : "En az";
    const olcu = plan.tutarMi ? "tutara" : "adede";
    return `${yon} — ${plan.kolon} bazında ${olcu} göre ilk ` +
      `${satirlar.length} (${plan.rangeLabel}).`;
  }

  return `${satirlar.length} kayıt (${plan.rangeLabel}).`;
}

/**
 * Planlanan sorguyu calistirip OlcumSonucu bicimine cevirir.
 *
 * Bicim, ozet ve teshis asamalarinin bekledigi bicimle ayni; ayri bir
 * yol acmak iki kod yolu demek olurdu.
 */
export async function runDirectAnswer(
  plan: DirectAnswerPlan,
  soru: string,
  dugumId: string
): Promise<OlcumSonucu> {
  const sql = buildDirectQuery(plan);
  const t0 = Date.now();

  const sonuc = await veriSorgulaAraci.calistir(
    { sorgu: sql },
    { izId: dugumId, provaMi: false }
  );

  return {
    dugumId,
    ajanKod: dataAnalyst.kod,
    ajanAd: dataAnalyst.ad,
    renk: dataAnalyst.renk,
    baslik: soru,
    soru: `${plan.tablo.ad} · ${plan.rangeLabel}`,
    cevap: cevapMetni(plan, sonuc.kolonlar, sonuc.satirlar),
    sql: sonuc.calisanSql,
    kolonlar: sonuc.kolonlar,
    satirlar: sonuc.satirlar,
    satirSayisi: sonuc.satirSayisi,
    bosMu: sonuc.satirSayisi === 0,
    // SQL kodda uretildi ve calistirildi; ajan devrede degil.
    sorguCalisti: true,
    belirsiz: false,
    sureMs: Date.now() - t0,
    // Model cagrilmadi.
    kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
  };
}
