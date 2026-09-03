import type { Tablo } from "../db/sema";
import { timeRangeCondition, type TimeRange } from "./zamanAraligi";

/**
 * NEDEN ANALIZI: donem karsilastirmasi + turetilmis segment.
 *
 * Kabul senaryosu "gecen aya gore ne degisti" ve "hangi segmentte
 * yogunlasiyor" istiyor. Ikisi de VERIDEN cikarilabiliyor, ama:
 *
 *   - Donem farki GERCEK: tarih ve tutar kolonlari var.
 *   - Segment TURETILMIS: veritabaninda segment kolonu YOK. Harcama
 *     dilimlerini biz hesapliyoruz ve arayuzde oyle etiketliyoruz.
 *     "Kayitli segment" gibi sunmak veriyi yanlis temsil etmek olurdu.
 *
 * Kanal BILEREK yok: edinim kanali hicbir tabloda tutulmuyor.
 * TicketRecords.Kanal destek kanali; ikisini esitlemek yanlis olur.
 *
 * SQL kodda uretiliyor, aritmetik kodda yapiliyor: model hic devrede
 * degil, sonuc her kosuda ayni.
 */

export interface AnalysisColumns {
  tablo: string;
  /** Musteri/varlik adi kolonu. */
  varlik: string;
  /** Tarih kolonu; donem kirilimi buradan. */
  tarih: string;
  /** Parasal kolon; yoksa yalnizca adet uzerinden calisilir. */
  tutar: string | null;
  /** Para birimi kolonu; varsa toplamlar birim bazinda ayrilir. */
  paraBirimi: string | null;
  silinmisVar: boolean;
}

const VARLIK_ONCELIGI = [/^MusteriAdi$/i, /Musteri/i, /^Ad$/i, /^Name$/i, /Adi$/i];
const TARIH_ONCELIGI = [/^CreatedAt$/i, /^OlusturmaTarihi$/i, /Tarihi$/i, /Date$/i];
const TUTAR_ONCELIGI = [/^Tutar$/i, /^GenelToplam$/i, /Toplam$/i, /^Fiyat$/i];

function findColumn(tablo: Tablo, desenler: RegExp[], tipSuzgeci?: RegExp): string | null {
  for (const d of desenler) {
    const k = tablo.kolonlar.find(
      (c) => d.test(c.ad) && (!tipSuzgeci || tipSuzgeci.test(c.tip))
    );
    if (k) return k.ad;
  }
  return null;
}

/** Analiz icin gereken kolonlari secer; varlik ve tarih zorunlu. */
export function pickAnalysisColumns(tablo: Tablo): AnalysisColumns | null {
  const varlik = findColumn(tablo, VARLIK_ONCELIGI, /char/i);
  const tarih = findColumn(tablo, TARIH_ONCELIGI, /date|time/i);
  if (!varlik || !tarih) return null;

  return {
    tablo: tablo.ad,
    varlik,
    tarih,
    tutar: findColumn(tablo, TUTAR_ONCELIGI, /decimal|numeric|money|float|int/i),
    paraBirimi: findColumn(tablo, [/^ParaBirimi$/i, /Currency/i], /char/i),
    silinmisVar: tablo.kolonlar.some((c) => /^IsDeleted$/i.test(c.ad)),
  };
}

function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

/**
 * Aylik donem sorgusu.
 *
 * CONVERT(char(7), d, 126) 'yyyy-MM' verir; FORMAT'tan hizli ve
 * kulturden bagimsiz.
 */
export function buildPeriodQuery(k: AnalysisColumns, ayAdedi = 6): string {
  const ay = `CONVERT(char(7), ${quote(k.tarih)}, 126)`;
  const secilen = [
    `${ay} AS [Ay]`,
    ...(k.paraBirimi ? [`${quote(k.paraBirimi)} AS [ParaBirimi]`] : []),
    "COUNT(*) AS [Kayit]",
    `COUNT(DISTINCT ${quote(k.varlik)}) AS [Varlik]`,
    ...(k.tutar ? [`SUM(${quote(k.tutar)}) AS [Toplam]`] : []),
  ];
  const grup = [ay, ...(k.paraBirimi ? [quote(k.paraBirimi)] : [])];

  return [
    `SELECT TOP (${ayAdedi * 4}) ${secilen.join(", ")}`,
    `FROM dbo.${quote(k.tablo)}`,
    k.silinmisVar ? "WHERE IsDeleted = 0" : "",
    `GROUP BY ${grup.join(", ")}`,
    `ORDER BY [Ay] DESC`,
  ].filter(Boolean).join(" ");
}

/**
 * Varlik basina toplam: segment dilimleri bundan TURETILIYOR, dogrudan
 * cevap da ayni sorguyu kullaniyor.
 *
 * Zaman araligi YAPI olarak geliyor; "son 1 ay" ile "bu ay" ayni sey
 * degil ve ikisini gun sayisina indirgemek ayin basinda yanlis cevap
 * verirdi.
 */
export function buildEntityQuery(
  k: AnalysisColumns,
  range: TimeRange = { kind: "relative", days: 30 }
): string {
  // PARA BIRIMI DE GRUPLAMAYA GIRER.
  //
  // Onceden `MAX(ParaBirimi)` aliniyor ve gruplama yalnizca varliga
  // gore yapiliyordu: hem TRY hem USD teklifi olan bir musterinin iki
  // birimdeki tutari TEK TOPLAMDA birlesiyor ve rastgele bir birimle
  // (alfabetik olarak sonuncu) etiketleniyordu.
  //
  // Gercek veride yakalandi: YENERLER YAPI'nin 3 teklifi iki birimde;
  // ekranda USD toplami 19.711,68 gorunuyordu, gercegi 5.311,68.
  //
  // `comparePeriods` bu kurala zaten uyuyordu; burasi uymuyordu.
  const birimVar = Boolean(k.paraBirimi);
  const secilen = [
    `${quote(k.varlik)} AS [Varlik]`,
    "COUNT(*) AS [Adet]",
    ...(k.tutar ? [`SUM(${quote(k.tutar)}) AS [Toplam]`] : []),
    ...(birimVar ? [`${quote(k.paraBirimi!)} AS [ParaBirimi]`] : []),
  ];
  const grup = [
    quote(k.varlik),
    ...(birimVar ? [quote(k.paraBirimi!)] : []),
  ];
  return [
    `SELECT TOP (500) ${secilen.join(", ")}`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}` +
      timeRangeCondition(range, k.tarih),
    `GROUP BY ${grup.join(", ")}`,
    "ORDER BY [Adet] DESC",
  ].join(" ");
}

/* --- Aritmetik: hepsi kodda --- */

export interface PeriodDelta {
  paraBirimi: string | null;
  simdikiAy: string;
  oncekiAy: string;
  kayit: { once: number; sonra: number; degisimYuzde: number | null };
  varlik: { once: number; sonra: number; degisimYuzde: number | null };
  toplam: { once: number; sonra: number; degisimYuzde: number | null } | null;
}

function percentChange(once: number, sonra: number): number | null {
  // Sifirdan artis yuzdesi tanimsiz; "%Infinity" gostermek yerine null.
  if (once === 0) return null;
  return Math.round(((sonra - once) / once) * 1000) / 10;
}

function toNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Son iki ayi karsilastirir.
 *
 * Para birimi kolonu varsa her birim AYRI karsilastirilir: farkli
 * birimleri tek toplamda birlestirmek anlamsiz bir sayi uretir.
 */
export function comparePeriods(kolonlar: string[], satirlar: unknown[][]): PeriodDelta[] {
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());
  const iAy = i("Ay"), iPara = i("ParaBirimi"), iKayit = i("Kayit");
  const iVarlik = i("Varlik"), iToplam = i("Toplam");
  if (iAy < 0 || iKayit < 0) return [];

  // Birim -> ay -> satir
  const gruplar = new Map<string, Map<string, unknown[]>>();
  for (const s of satirlar) {
    const birim = iPara >= 0 && s[iPara] != null ? String(s[iPara]) : "";
    const ay = String(s[iAy]);
    const g = gruplar.get(birim) ?? new Map<string, unknown[]>();
    g.set(ay, s);
    gruplar.set(birim, g);
  }

  const sonuc: PeriodDelta[] = [];
  for (const [birim, aylar] of gruplar) {
    const sirali = [...aylar.keys()].sort().reverse();
    if (sirali.length < 2) continue;
    const [sonAy, oncekiAy] = sirali as [string, string];
    const son = aylar.get(sonAy)!;
    const onceki = aylar.get(oncekiAy)!;

    sonuc.push({
      paraBirimi: birim || null,
      simdikiAy: sonAy,
      oncekiAy,
      kayit: {
        once: toNumber(onceki[iKayit]), sonra: toNumber(son[iKayit]),
        degisimYuzde: percentChange(toNumber(onceki[iKayit]), toNumber(son[iKayit])),
      },
      varlik: {
        once: toNumber(onceki[iVarlik]), sonra: toNumber(son[iVarlik]),
        degisimYuzde: percentChange(toNumber(onceki[iVarlik]), toNumber(son[iVarlik])),
      },
      // SUM yalnizca TUM degerler null oldugunda null doner: yani bu
      // grupta hic tutar kaydedilmemis demektir. Bunu 0 diye gostermek
      // "cirosu sifir" izlenimi verirdi; oysa veri yok.
      toplam: iToplam >= 0 && (onceki[iToplam] != null || son[iToplam] != null)
        ? {
            once: toNumber(onceki[iToplam]), sonra: toNumber(son[iToplam]),
            degisimYuzde: percentChange(toNumber(onceki[iToplam]), toNumber(son[iToplam])),
          }
        : null,
    });
  }
  // Cok kayitli birim once gelsin.
  return sonuc.sort((a, b) => b.kayit.sonra - a.kayit.sonra);
}

export interface SegmentTier {
  ad: string;
  entityCount: number;
  toplam: number;
  /** Varlik sayisinin tum varliklara orani, yuzde. */
  pay: number;
}

export interface Segmentation {
  tiers: SegmentTier[];
  /** Tutari olmayan varliklar: dilimlenemiyor, GIZLENMIYOR. */
  withoutAmount: number;
  totalEntities: number;
  paraBirimi: string | null;
}

/**
 * Harcama dilimlerini TURETIR.
 *
 * Esikler sabit degil, verinin kendisinden: ust %20 "yüksek", sonraki
 * %30 "orta", kalani "düşük". Sabit esik (100.000 TL gibi) para birimine
 * ve sirkete gore anlamsizlasirdi.
 *
 * Tutari null olan varliklar AYRI raporlanir. Gercek veride son 30 gunde
 * 52 musterinin 29'unun tutari yok; bunlari sessizce "dusuk" saymak
 * dilimlemenin tamamini yalan yapardi.
 */
export function deriveSegments(kolonlar: string[], satirlar: unknown[][]): Segmentation {
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());
  const iToplam = i("Toplam"), iPara = i("ParaBirimi");

  const bos: Segmentation = {
    tiers: [], withoutAmount: 0, totalEntities: satirlar.length, paraBirimi: null,
  };
  if (!satirlar.length || iToplam < 0) return { ...bos, withoutAmount: satirlar.length };

  const tutarli = satirlar.filter((s) => typeof s[iToplam] === "number");
  const withoutAmount = satirlar.length - tutarli.length;
  if (!tutarli.length) return { ...bos, withoutAmount };

  const degerler = tutarli
    .map((s) => s[iToplam] as number)
    .sort((a, b) => b - a);

  const ustSinir = degerler[Math.floor(degerler.length * 0.2)] ?? degerler[0]!;
  const ortaSinir = degerler[Math.floor(degerler.length * 0.5)] ?? degerler.at(-1)!;

  const kovalar: Record<string, { n: number; t: number }> = {
    yüksek: { n: 0, t: 0 }, orta: { n: 0, t: 0 }, düşük: { n: 0, t: 0 },
  };
  for (const d of degerler) {
    const ad = d >= ustSinir ? "yüksek" : d >= ortaSinir ? "orta" : "düşük";
    kovalar[ad]!.n += 1;
    kovalar[ad]!.t += d;
  }

  const paraBirimi = iPara >= 0
    ? (tutarli.map((s) => s[iPara]).find((v) => typeof v === "string") as string | undefined) ?? null
    : null;

  return {
    tiers: Object.entries(kovalar)
      .filter(([, v]) => v.n > 0)
      .map(([ad, v]) => ({
        ad,
        entityCount: v.n,
        toplam: Math.round(v.t * 100) / 100,
        pay: Math.round((v.n / satirlar.length) * 1000) / 10,
      })),
    withoutAmount,
    totalEntities: satirlar.length,
    paraBirimi,
  };
}
