import type { Tablo } from "../db/sema";
import type { AnalysisColumns } from "./nedenAnalizi";
import { timeRangeCondition, type TimeRange } from "./zamanAraligi";

/**
 * TEK VARLIGIN AYRINTI SATIRLARI.
 *
 * Ozet tablosu varlik basina TEK satir gosteriyor: "3 teklif, 671.946 TRY".
 * Kullanicinin bir sonraki sorusu her zaman ayni: "hangi 3 teklif?".
 * Bunu yeni bir soru sormaya birakmak, cevabi zaten elimizde olan bir sey
 * icin bir tur daha harcamak olurdu.
 *
 * SQL kodda uretiliyor, 0 token. Kolonlar SEMADAN desenle bulunuyor;
 * tablo adina gore sabitlenmiyor.
 */

/** Ayrinti tablosunda en fazla kac satir. */
const AZAMI_SATIR = 50;

/** Insan okunabilir kimlik: "2026_00685", "MIKRO BAKIM ANLASMASI". */
const KIMLIK_ONCELIGI = [
  /No$/i, /^Baslik$/i, /^UrunAdi$/i, /^Konu$/i, /^Ad$/i,
];

/** Durum/asama kolonu; kaydin nerede oldugunu gosterir. */
const DURUM_ONCELIGI = [/^Durum$/i, /^Asama$/i, /^Statu/i, /^Periyot$/i];

export interface DetailColumns {
  /** Kimlik kolonu; yoksa tarih tek basina ayirt edici olur. */
  kimlik: string | null;
  durum: string | null;
}

function bul(tablo: Tablo, desenler: RegExp[], tipSuzgeci: RegExp): string | null {
  for (const d of desenler) {
    const k = tablo.kolonlar.find((c) => d.test(c.ad) && tipSuzgeci.test(c.tip));
    if (k) return k.ad;
  }
  return null;
}

export function pickDetailColumns(tablo: Tablo): DetailColumns {
  return {
    // GUID kolonlari kimlik SAYILMAZ: kullaniciya hicbir sey anlatmiyor.
    kimlik: bul(tablo, KIMLIK_ONCELIGI, /char/i),
    durum: bul(tablo, DURUM_ONCELIGI, /char/i),
  };
}

function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

/**
 * Tek varligin donem icindeki HAM kayitlari.
 *
 * Varlik tam esitlikle suzuluyor; ad zaten ozet tablosundan geliyor,
 * yani veritabanindan okunmus bir deger. LIKE kullanmak baska musteriyi
 * karistirirdi.
 */
export function buildDetailQuery(
  k: AnalysisColumns,
  d: DetailColumns,
  entity: string,
  range: TimeRange,
  quoteValue: (v: string) => string
): string {
  const secilen = [
    ...(d.kimlik ? [`${quote(d.kimlik)} AS [Kayit]`] : []),
    `${quote(k.tarih)} AS [Tarih]`,
    ...(k.tutar ? [`${quote(k.tutar)} AS [Tutar]`] : []),
    ...(k.paraBirimi ? [`${quote(k.paraBirimi)} AS [ParaBirimi]`] : []),
    ...(d.durum ? [`${quote(d.durum)} AS [Durum]`] : []),
  ];

  return [
    `SELECT TOP (${AZAMI_SATIR}) ${secilen.join(", ")}`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}` +
      `${quote(k.varlik)} = ${quoteValue(entity)} AND ` +
      timeRangeCondition(range, k.tarih),
    // En yeni ustte: kullanici once son hareketi ariyor.
    `ORDER BY ${quote(k.tarih)} DESC`,
  ].join(" ");
}
