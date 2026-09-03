import type { Tablo } from "../db/sema";
import { veriSorgulaAraci } from "../db/aracSorgu";
import type { OlcumSonucu } from "../ajan/olcum";
import { dataAnalyst } from "../../agents/data-analyst";
import { buildEntityQuery, pickAnalysisColumns } from "./nedenAnalizi";
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
 * Taninan sekil "varlik basina olcum": <tablo>'dan <varlik> bazinda adet
 * ve tutar, <zaman araligi> icinde. Kabul senaryosunun sorusu tam bu.
 *
 * Taninmayan soru (ornegin "kac bilet acik?") ajana gider; her soruyu
 * koda almak giderek bir sorgu diline donusurdu.
 */

export interface DirectAnswerPlan {
  tablo: Tablo;
  range: TimeRange;
  /** Kullaniciya gosterilecek aralik etiketi. */
  rangeLabel: string;
}

/**
 * Soru kodun cozebilecegi sekle uyuyor mu?
 *
 * Uc kosul da saglanmali; biri eksikse `null` doner ve cagiran taraf
 * ajana duser. Tahmin etmiyoruz.
 */
export function planDirectAnswer(
  tablo: Tablo | null,
  zamanAraligi: string | null | undefined
): DirectAnswerPlan | null {
  if (!tablo) return null;

  // Varlik ve tarih kolonu yoksa "varlik basina olcum" kurulamaz.
  if (!pickAnalysisColumns(tablo)) return null;

  const range = parseTimeRange(zamanAraligi);
  if (!range) return null;

  return { tablo, range, rangeLabel: timeRangeLabel(range) };
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
  const kolonlar = pickAnalysisColumns(plan.tablo)!;
  const sql = buildEntityQuery(kolonlar, plan.range);
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
    cevap: `${sonuc.satirSayisi} kayıt (${plan.rangeLabel}).`,
    sql: sonuc.calisanSql,
    kolonlar: sonuc.kolonlar,
    satirlar: sonuc.satirlar,
    satirSayisi: sonuc.satirSayisi,
    bosMu: sonuc.satirSayisi === 0,
    belirsiz: false,
    sureMs: Date.now() - t0,
    // Model cagrilmadi.
    kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
  };
}
