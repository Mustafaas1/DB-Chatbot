import type { Tablo } from "../db/sema";
import type { AnalysisColumns } from "./nedenAnalizi";
import { timeRangeCondition, type TimeRange } from "./zamanAraligi";

/**
 * KIRILIMLAR: "bu musteriler nereden geldi, nerede yogunlasiyor".
 *
 * Kabul senaryosu edinim KANALI istiyor ama sema boyle bir kolon
 * tutmuyor. Uydurmak yerine veride GERCEKTEN olan kirilimlari veriyoruz:
 *
 *   1. ATIF   -- musteriyi kim getirdi (SatisTemsilcisi, AtananKisi)
 *   2. KATEGORI -- neyde yogunlasiyor (Periyot, Kanal, UrunTipi)
 *   3. YENI/MEVCUT -- ilk kayit tarihinden turetilir
 *
 * Hepsi TEK TABLO uzerinde. Join'e girmek sorguyu bu semaya sabitlerdi;
 * kolonlar desene gore bulunuyor, tablo adina gore degil.
 *
 * TicketRecords.Kanal burada KATEGORI olarak cikar ve dogru etiketlenir:
 * destek kanali, edinim kanali degil.
 */

/** Musteriyi kim getirdi/yurutuyor: kisi ya da ekip kolonu. */
const ATTRIBUTION = [
  /^SatisTemsilcisi$/i, /Temsilci$/i, /^AtananKisi$/i, /Sorumlu/i, /Ekip$/i, /Danisman/i,
];

/** Yogunlasma kirilimi olabilecek kategorik kolonlar. */
const CATEGORY = [
  /^Kategori$/i, /Kategori$/i, /^Periyot$/i, /^Kanal$/i,
  /Turu?$/i, /Tipi?$/i, /^Marka$/i, /^Grup$/i, /^Sinif$/i,
];

/**
 * Bir kirilimin anlamli sayilmasi icin ust sinir.
 *
 * Invoices.UrunAdi son 30 gunde 73 satirda 58 farkli deger aliyor --
 * bu bir kirilim degil, neredeyse satirin kendisi. Boyle kolonlar
 * `tooGranular` isaretlenip GOSTERILMIYOR.
 */
const MAX_GROUPS = 12;

/**
 * Tek kovanin toplami bu orani asarsa kirilim BILGI TASIMIYOR.
 *
 * Teklifler.IskontoTuru son 30 gunde tek deger aliyor (%100 bos),
 * UrunTipi %95 bos. Bunlari "kirilim" diye gostermek gurultu olur.
 */
const MAX_DOMINANT_SHARE = 90;

export interface BreakdownColumns {
  attribution: string | null;
  categories: string[];
}

function metinKolonlari(tablo: Tablo, desenler: RegExp[], haric: string[]): string[] {
  const atla = new Set(haric.map((h) => h.toLowerCase()));
  return tablo.kolonlar
    .filter((c) => /char/i.test(c.tip))
    .filter((c) => !atla.has(c.ad.toLowerCase()))
    // Kimlik ve GUID benzeri kolonlar kirilim olmaz.
    .filter((c) => !/id$/i.test(c.ad))
    .filter((c) => desenler.some((d) => d.test(c.ad)))
    .map((c) => c.ad);
}

export function pickBreakdownColumns(tablo: Tablo, haric: string[] = []): BreakdownColumns {
  const attribution = metinKolonlari(tablo, ATTRIBUTION, haric)[0] ?? null;
  const categories = metinKolonlari(
    tablo, CATEGORY, [...haric, ...(attribution ? [attribution] : [])]
  ).slice(0, 3);
  return { attribution, categories };
}

function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

/** Tek kolona gore kirilim: deger basina varlik ve kayit sayisi. */
export function buildBreakdownQuery(
  k: AnalysisColumns,
  column: string,
  range: TimeRange
): string {
  return [
    `SELECT TOP (50) ${quote(column)} AS [Deger],`,
    `COUNT(DISTINCT ${quote(k.varlik)}) AS [Varlik], COUNT(*) AS [Kayit]`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}${timeRangeCondition(range, k.tarih)}`,
    `GROUP BY ${quote(column)}`,
    "ORDER BY [Varlik] DESC",
  ].join(" ");
}

/**
 * Yeni mi, mevcut mu.
 *
 * "Yeni" = varligin TUM tablodaki ilk kaydi da bu aralikta. Aralik
 * disindan kaydi olan varlik mevcut sayilir.
 */
export function buildNewVsReturningQuery(k: AnalysisColumns, range: TimeRange): string {
  const silinmis = k.silinmisVar ? "IsDeleted = 0 AND " : "";
  const araliktaki = timeRangeCondition(range, k.tarih);
  return [
    `WITH ilk AS (SELECT ${quote(k.varlik)} AS v, MIN(${quote(k.tarih)}) AS ilkKayit`,
    `FROM dbo.${quote(k.tablo)}`,
    k.silinmisVar ? "WHERE IsDeleted = 0" : "",
    `GROUP BY ${quote(k.varlik)})`,
    "SELECT",
    `SUM(CASE WHEN ${timeRangeCondition(range, "ilkKayit").replace(/\[ilkKayit\]/g, "i.ilkKayit")}`,
    "THEN 1 ELSE 0 END) AS [Yeni],",
    `SUM(CASE WHEN NOT ${timeRangeCondition(range, "ilkKayit").replace(/\[ilkKayit\]/g, "i.ilkKayit")}`,
    "THEN 1 ELSE 0 END) AS [Mevcut]",
    "FROM (",
    `SELECT DISTINCT ${quote(k.varlik)} AS v FROM dbo.${quote(k.tablo)}`,
    `WHERE ${silinmis}${araliktaki}) a JOIN ilk i ON i.v = a.v`,
  ].filter(Boolean).join(" ");
}

/* --- Sonuclarin yorumu: aritmetik kodda --- */

export interface BreakdownRow {
  value: string;
  entities: number;
  records: number;
  /** Varlik sayisinin toplama orani, yuzde. */
  share: number;
}

export interface Breakdown {
  column: string;
  kind: "attribution" | "category";
  rows: BreakdownRow[];
  /** Cok fazla farkli deger: kirilim anlamli degil, gosterilmiyor. */
  tooGranular: boolean;
  /** Tek kova her seyi kapsiyor: kirilim bilgi tasimiyor. */
  uninformative: boolean;
  distinctValues: number;
}

/** Gosterilmeye deger mi: hem ayirt edici hem yeterince kaba. */
export function isUsefulBreakdown(b: Breakdown): boolean {
  return b.rows.length > 1 && !b.tooGranular && !b.uninformative;
}

export function readBreakdown(
  column: string,
  kind: Breakdown["kind"],
  kolonlar: string[],
  satirlar: unknown[][]
): Breakdown {
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());
  const iDeger = i("Deger"), iVarlik = i("Varlik"), iKayit = i("Kayit");

  const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  // Bos/null degerler ayri bir kova olarak kalir; gizlemek dagilimi bozar.
  const temiz = satirlar.filter((s) => iDeger >= 0);
  const toplam = temiz.reduce((t, s) => t + sayi(s[iVarlik]), 0);

  const rows: BreakdownRow[] = temiz.map((s) => ({
    value: s[iDeger] == null || String(s[iDeger]).trim() === ""
      ? "(boş)"
      : String(s[iDeger]),
    entities: sayi(s[iVarlik]),
    records: sayi(s[iKayit]),
    share: toplam > 0 ? Math.round((sayi(s[iVarlik]) / toplam) * 1000) / 10 : 0,
  }));

  const enBuyukPay = rows.length ? Math.max(...rows.map((r) => r.share)) : 100;

  return {
    column,
    kind,
    rows: rows.slice(0, MAX_GROUPS),
    tooGranular: rows.length > MAX_GROUPS,
    uninformative: enBuyukPay >= MAX_DOMINANT_SHARE,
    distinctValues: rows.length,
  };
}

export interface NewVsReturning {
  neww: number;
  returning: number;
  /** Yeni varliklarin toplama orani, yuzde. */
  newShare: number;
}

export function readNewVsReturning(
  kolonlar: string[],
  satirlar: unknown[][]
): NewVsReturning | null {
  const s = satirlar[0];
  if (!s) return null;
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());
  const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  const neww = sayi(s[i("Yeni")]);
  const returning = sayi(s[i("Mevcut")]);
  const toplam = neww + returning;
  if (toplam === 0) return null;

  return { neww, returning, newShare: Math.round((neww / toplam) * 1000) / 10 };
}
