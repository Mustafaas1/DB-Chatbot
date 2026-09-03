import type { Tablo } from "../db/sema";
import { KARSILIK } from "../hedef/zemin";
import type { AnalysisColumns } from "./nedenAnalizi";
import { timeRangeCondition, type TimeRange } from "./zamanAraligi";

/**
 * SAYIM ve SIRALAMA sorularinin SQL'i.
 *
 * Ikisi de kodda uretiliyor, 0 token. Ajana yazdirmanin faydasi yok:
 * cevabin sekli sabit ve model bu sekilde kosudan kosuya farkli sorgu
 * yaziyordu.
 *
 * Tanima `soruSekli.ts`te; burasi yalnizca SQL kuruyor. Ayri tutuluyor ki
 * tanima kolon adindan bagimsiz test edilebilsin.
 */

/** Siralama tablosunda en fazla kac satir gosterilir. */
const AZAMI_SIRA = 15;

function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

/* --- Sayim --- */

/**
 * Tek sayi sorgusu.
 *
 * Adet ve BENZERSIZ VARLIK ayni sorguda: "bu ay kac fatura kesildi" ile
 * "kac musteriye kesildi" farkli sorular ve ikincisini ayri bir tur
 * harcayarak sormak gereksiz.
 */
export function buildCountQuery(k: AnalysisColumns, range: TimeRange): string {
  const secilen = [
    "COUNT(*) AS [Adet]",
    `COUNT(DISTINCT ${quote(k.varlik)}) AS [Varlik]`,
    ...(k.tutar ? [`SUM(${quote(k.tutar)}) AS [Toplam]`] : []),
  ];
  return [
    `SELECT ${secilen.join(", ")}`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}` +
      timeRangeCondition(range, k.tarih),
  ].join(" ");
}

export interface CountResult {
  adet: number;
  /** Benzersiz varlik; kolon yoksa null. */
  varlik: number | null;
  toplam?: number | null;
}

function sayi(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function readCount(kolonlar: string[], satirlar: unknown[][]): CountResult {
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());
  const s = satirlar[0];

  // COUNT(*) her zaman bir satir dondurur; satir yoksa sorgu hic
  // calismamistir ve sifir dogru cevaptir.
  if (!s) return { adet: 0, varlik: 0 };

  const iVarlik = i("Varlik");
  const iToplam = i("Toplam");
  return {
    adet: sayi(s[i("Adet")]),
    varlik: iVarlik >= 0 ? sayi(s[iVarlik]) : null,
    ...(iToplam >= 0 && s[iToplam] != null ? { toplam: sayi(s[iToplam]) } : {}),
  };
}

/* --- Siralama --- */

/** Bu kolonlar gruplama ekseni olmaz. */
const GRUPLANMAZ = /^(.*id|.*tarih|.*date|.*aciklama|.*not|.*adres)$/i;

/**
 * Soruda gecen kavrama gore gruplama kolonunu secer.
 *
 * "En cok satan URUNLER" -> UrunAdi, "en fazla fatura kesilen MUSTERI"
 * -> MusteriAdi. Eslesme yoksa `null` doner ve cagiran taraf ajana
 * duser: uydurup yanlis kolona gruplamak, sessizce yanlis cevap uretmek
 * olurdu.
 *
 * Sozluk `zemin.ts`ten paylasiliyor; iki yerde ayri Turkce-Ingilizce
 * esleme tutmak kaymaya acik olurdu.
 */
export function pickRankingColumn(tablo: Tablo, soru: string): string | null {
  const s = soru.toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");

  const adaylar = tablo.kolonlar
    .filter((c) => /char/i.test(c.tip))
    .filter((c) => !GRUPLANMAZ.test(c.ad));

  let enIyi: { ad: string; puan: number } | null = null;

  for (const c of adaylar) {
    const kolonDuz = c.ad.toLowerCase();
    let puan = 0;

    for (const [terim, karsiliklar] of Object.entries(KARSILIK)) {
      if (!karsiliklar.length) continue;
      // Terim soruda geciyor mu (Turkce), karsiligi kolon adinda mi
      // (Ingilizce ya da Turkce kolon adi).
      if (!s.includes(terim)) continue;
      if (karsiliklar.some((x) => kolonDuz.includes(x)) || kolonDuz.includes(terim)) {
        puan += terim.length;
      }
    }

    if (puan > 0 && (!enIyi || puan > enIyi.puan)) enIyi = { ad: c.ad, puan };
  }

  return enIyi?.ad ?? null;
}

/**
 * Sirali kucuk tablo.
 *
 * `tutarMi` true ise olcu SUM(tutar), degilse COUNT(*). Tutar kolonu
 * yoksa SUM istense bile adede duser: olmayan kolon uzerinde SUM yazmak
 * calisan ama anlamsiz bir sorgu uretirdi.
 */
export function buildRankingQuery(
  k: AnalysisColumns,
  kolon: string,
  range: TimeRange,
  yon: "ust" | "alt",
  tutarMi: boolean
): string {
  const tutarla = tutarMi && Boolean(k.tutar);
  const olcu = tutarla
    ? `SUM(${quote(k.tutar!)}) AS [Olcu]`
    : "COUNT(*) AS [Olcu]";

  // Kayit sayisi YALNIZCA tutar siralamasinda ek bilgi verir. Adede gore
  // siralarken ikisi ayni sayi olur ve ozet katmani onlari iki ayri olcu
  // sanip "OLCU TOPLAMI 13 / KAYIT TOPLAMI 13" diye tekrarliyordu.
  const ek = tutarla ? ", COUNT(*) AS [Kayit]" : "";

  return [
    `SELECT TOP (${AZAMI_SIRA}) ${quote(kolon)} AS [Deger], ${olcu}${ek}`,
    `FROM dbo.${quote(k.tablo)}`,
    // Bos gruplar disarida: "(bos)" bir urun adi degil ve siralamanin
    // basinda durmasi yaniltici olur.
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}` +
      `${quote(kolon)} IS NOT NULL AND ${quote(kolon)} <> '' AND ` +
      timeRangeCondition(range, k.tarih),
    `GROUP BY ${quote(kolon)}`,
    `ORDER BY [Olcu] ${yon === "ust" ? "DESC" : "ASC"}`,
  ].join(" ");
}

/** Soru parasal bir olcu mu istiyor. */
export function tutarSoruluyorMu(soru: string): boolean {
  const s = soru.toLocaleLowerCase("tr").replace(/[ıİ]/g, "i");
  return /tutar|ciro|gelir|harcama|kazanc|para|fiyat|bedel|toplam tutar/.test(s);
}
