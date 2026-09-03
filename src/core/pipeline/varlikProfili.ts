import type { AnalysisColumns } from "./nedenAnalizi";
import {
  previousTimeRangeCondition, previousTimeRangeLabel,
  timeRangeCondition, timeRangeLabel, type TimeRange,
} from "./zamanAraligi";

/**
 * TEK VARLIGIN GERCEK KARTI.
 *
 * "Fellas'a bu ay kac satis yaptik?" sorusunun cevabi tek bir sayi ama
 * o sayi tek basina bir sey soylemiyor: 10 satis, gecen ay 25 ise kotu,
 * 3 ise iyi. Danisman gibi konusabilmek icin gereken baglam sudur ve
 * HEPSI VERIDEN cikarilabilir:
 *
 *   - bu donem / onceki esdeger donem
 *   - tum gecmis, ilk ve son kayit
 *   - son kayittan bu yana gecen gun
 *   - varligin KENDI ortalama alim araligi
 *   - ayni donemdeki diger varliklara gore konumu
 *
 * Hicbiri modelden alinmiyor. Model yalnizca bunlari CUMLEYE dokuyor
 * (`tavsiye.ts`) ve urettigi metinde yeni sayi varsa reddediliyor.
 *
 * Iki sorgu: biri varligin kendi gecmisi, digeri akran karsilastirmasi.
 * Ikisi de tek tablo uzerinde, 0 token.
 */

/** Ortalama aralik bu kat asilirsa "gecikmis" sayilir. */
const OVERDUE_FACTOR = 1.5;

/**
 * Ortalama aralik icin en az bu kadar kayit gerekir.
 *
 * Iki kayitla "ortalama aralik" hesaplamak tek bir olcumu ortalama diye
 * sunmaktir; ucuncu kayit olmadan duzenlilikten soz edilemez.
 */
const MIN_HISTORY_FOR_INTERVAL = 3;

/** Donem farkinin anlamli sayilmasi icin esik, yuzde. */
const CHANGE_THRESHOLD = 20;

/** Akranlarin bu yuzdesinin uzerindeyse "ust dilim". */
const TOP_PERCENTILE = 80;

const GUN_MS = 86_400_000;

function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

/**
 * Varligin kendi gecmisi: bu donem, onceki donem ve tum zamanlar.
 *
 * Tek satir doner. Ayri sorgular yerine CASE WHEN kullanmak uc gidis
 * gelisi bire indiriyor ve donemlerin AYNI satir kumesinden okundugunu
 * garanti ediyor.
 */
export function buildEntityProfileQuery(
  k: AnalysisColumns, entity: string, range: TimeRange, quoteValue: (v: string) => string
): string {
  const suanki = timeRangeCondition(range, k.tarih);
  const onceki = previousTimeRangeCondition(range, k.tarih);

  const secilen = [
    `SUM(CASE WHEN ${suanki} THEN 1 ELSE 0 END) AS [Simdi]`,
    `SUM(CASE WHEN ${onceki} THEN 1 ELSE 0 END) AS [Onceki]`,
    "COUNT(*) AS [Tum]",
    `MIN(${quote(k.tarih)}) AS [Ilk]`,
    `MAX(${quote(k.tarih)}) AS [Son]`,
  ];

  if (k.tutar) {
    const t = quote(k.tutar);
    secilen.push(
      `SUM(CASE WHEN ${suanki} THEN ${t} ELSE 0 END) AS [SimdiTutar]`,
      `SUM(CASE WHEN ${onceki} THEN ${t} ELSE 0 END) AS [OncekiTutar]`,
      // Tutari kaydedilmis kayit sayisi AYRI: toplamin 0 olmasi ile
      // tutarin hic girilmemis olmasi ayni sey degil.
      `SUM(CASE WHEN ${suanki} AND ${t} IS NOT NULL THEN 1 ELSE 0 END) AS [SimdiTutarli]`,
      `SUM(CASE WHEN ${onceki} AND ${t} IS NOT NULL THEN 1 ELSE 0 END) AS [OncekiTutarli]`
    );
  }
  if (k.paraBirimi) secilen.push(`MAX(${quote(k.paraBirimi)}) AS [ParaBirimi]`);

  return [
    `SELECT ${secilen.join(", ")}`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}` +
      `${quote(k.varlik)} = ${quoteValue(entity)}`,
  ].join(" ");
}

/**
 * Akran karsilastirmasi: ayni donemde digerleri kac kayit uretti.
 *
 * "10 satis cok mu az mi" sorusunun cevabi sirkete gore degisir; sabit
 * bir esik uydurmak yerine verinin kendi dagilimina bakiyoruz.
 */
export function buildPeerQuery(
  k: AnalysisColumns, entity: string, range: TimeRange, quoteValue: (v: string) => string
): string {
  const silinmis = k.silinmisVar ? "IsDeleted = 0 AND " : "";
  // Hedefin kendi sayisi AYRI bir CTE'de: SQL Server bir toplam
  // fonksiyonunun ifadesi icinde alt sorguya izin vermiyor
  // ("Cannot perform an aggregate function on an expression containing
  // an aggregate or a subquery"). CROSS JOIN tek satirla carpiyor.
  //
  // Hedef donemde hic yoksa hedef.n NULL kalir; "n < NULL" bilinmez
  // sayilir ve [Altinda] 0 doner -- dogru davranis.
  return [
    `WITH akran AS (SELECT ${quote(k.varlik)} AS v, COUNT(*) AS n`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${silinmis}${timeRangeCondition(range, k.tarih)}`,
    `GROUP BY ${quote(k.varlik)}),`,
    `hedef AS (SELECT MAX(n) AS n FROM akran WHERE v = ${quoteValue(entity)})`,
    "SELECT COUNT(*) AS [Toplam],",
    "SUM(CASE WHEN a.n < h.n THEN 1 ELSE 0 END) AS [Altinda],",
    "AVG(CAST(a.n AS float)) AS [Ortalama], MAX(a.n) AS [Enfazla]",
    "FROM akran a CROSS JOIN hedef h",
  ].join(" ");
}

/* --- Sonuclarin yorumu: aritmetik kodda --- */

export interface PeerPosition {
  /** Donemde kaydi olan varlik sayisi. */
  total: number;
  /** Bu varligin altinda kalan varlik sayisi. */
  below: number;
  /** Yuzdelik dilim: 0-100. */
  percentile: number;
  average: number;
  max: number;
}

export interface EntityProfile {
  entity: string;
  table: string;
  rangeLabel: string;
  previousRangeLabel: string;
  /** Bu donemdeki kayit adedi. */
  current: number;
  previous: number;
  /** Yuzde degisim; onceki donem 0 ise tanimsiz (null). */
  changePercent: number | null;
  /** Tutar toplamlari; kolon yoksa ya da hic tutar girilmemisse null. */
  currentAmount: number | null;
  previousAmount: number | null;
  amountChangePercent: number | null;
  currency: string | null;
  /** Tum zamanlardaki kayit adedi. */
  allTime: number;
  /**
   * ISO tarih; Date DEGIL.
   *
   * Bu yapi SSE ile istemciye JSON olarak gidiyor ve JSON'da Date yok.
   * Tipte Date yazip telde string gondermek, arayuzun sessizce yanlis
   * tipe guvenmesi demekti.
   */
  firstSeen: string | null;
  lastSeen: string | null;
  /** Son kayittan bugune gecen gun. */
  daysSinceLast: number | null;
  /** Varligin KENDI ortalama kayit araligi, gun. */
  averageIntervalDays: number | null;
  peers: PeerPosition | null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function percentChange(once: number, sonra: number): number | null {
  if (once === 0) return null;
  return Math.round(((sonra - once) / once) * 1000) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function readEntityProfile(
  entity: string, table: string, range: TimeRange,
  kolonlar: string[], satirlar: unknown[][],
  peers: PeerPosition | null = null,
  simdi: Date = new Date()
): EntityProfile | null {
  const s = satirlar[0];
  if (!s) return null;
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());

  const current = num(s[i("Simdi")]);
  const previous = num(s[i("Onceki")]);
  const allTime = num(s[i("Tum")]);

  // HIC KAYDI YOKSA PROFIL YOKTUR.
  //
  // Tam esitlik hicbir satira uymadiginda sorgu yine tek satir doner
  // ama her alani sifirdir. Bunu profil saymak "0 kayit, akranlarin
  // altinda" gibi bir tablo uretiyordu -- var olmayan bir musteri
  // hakkinda performans yorumu. Cagiran taraf bunu "bulunamadi" olarak
  // gostermeli.
  if (allTime === 0) return null;
  const firstSeen = toDate(s[i("Ilk")]);
  const lastSeen = toDate(s[i("Son")]);

  // Tutar YALNIZCA gercekten kaydedilmisse okunur; aksi halde null.
  // Sifir gostermek "bu musteri hic para birakmadi" demek olurdu.
  const tutarli = i("SimdiTutarli") >= 0 ? num(s[i("SimdiTutarli")]) : 0;
  const oncekiTutarli = i("OncekiTutarli") >= 0 ? num(s[i("OncekiTutarli")]) : 0;
  const currentAmount = tutarli > 0 ? round2(num(s[i("SimdiTutar")])) : null;
  const previousAmount = oncekiTutarli > 0 ? round2(num(s[i("OncekiTutar")])) : null;

  const iPara = i("ParaBirimi");
  const currency = iPara >= 0 && typeof s[iPara] === "string" ? String(s[iPara]) : null;

  // Ortalama aralik: ilk ve son kayit arasindaki sure / (adet - 1).
  // Tek kayitli varlikta aralik YOKTUR; sifira bolmek yerine null.
  let averageIntervalDays: number | null = null;
  if (allTime >= MIN_HISTORY_FOR_INTERVAL && firstSeen && lastSeen) {
    const gun = (lastSeen.getTime() - firstSeen.getTime()) / GUN_MS;
    if (gun > 0) averageIntervalDays = Math.round((gun / (allTime - 1)) * 10) / 10;
  }

  return {
    entity,
    table,
    rangeLabel: timeRangeLabel(range),
    previousRangeLabel: previousTimeRangeLabel(range),
    current,
    previous,
    changePercent: percentChange(previous, current),
    currentAmount,
    previousAmount,
    amountChangePercent:
      currentAmount != null && previousAmount != null
        ? percentChange(previousAmount, currentAmount)
        : null,
    currency,
    allTime,
    firstSeen: firstSeen ? firstSeen.toISOString() : null,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
    daysSinceLast: lastSeen
      ? Math.max(0, Math.floor((simdi.getTime() - lastSeen.getTime()) / GUN_MS))
      : null,
    averageIntervalDays,
    peers,
  };
}

export function readPeerPosition(
  kolonlar: string[], satirlar: unknown[][]
): PeerPosition | null {
  const s = satirlar[0];
  if (!s) return null;
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());

  const total = num(s[i("Toplam")]);
  if (total === 0) return null;
  const below = num(s[i("Altinda")]);

  return {
    total,
    below,
    percentile: Math.round((below / total) * 1000) / 10,
    average: round2(num(s[i("Ortalama")])),
    max: num(s[i("Enfazla")]),
  };
}

/* --- Sinyaller: oneriyi tasiyan gozlemler, hepsi kodda --- */

export type SignalKind =
  /** Son kayit, varligin kendi ortalama araliginin cok uzerinde. */
  | "overdue"
  /** Bu donemde hic kaydi yok ama gecmiste var. */
  | "dormant"
  | "declining"
  | "growing"
  /** Akranlarin ust diliminde. */
  | "topTier"
  /** Akran ortalamasinin altinda. */
  | "belowAverage"
  /** Ilk kaydi bu donemde: yeni varlik. */
  | "new";

export interface Signal {
  kind: SignalKind;
  /** Kodda kurulmus OLGU cumlesi; modele de bu veriliyor. */
  text: string;
}

/**
 * Profilden gozlemleri turetir.
 *
 * Bunlar tavsiye DEGIL, tavsiyenin dayanagi. Model bu listeyi cumleye
 * dokuyor; listede olmayan bir gozlemi kendi ekleyemiyor cunku urettigi
 * metindeki sayilar bu profile karsi dogrulaniyor.
 */
export function deriveSignals(p: EntityProfile): Signal[] {
  const s: Signal[] = [];

  if (p.current === 0 && p.allTime > 0) {
    s.push({
      kind: "dormant",
      text: `${p.rangeLabel} içinde hiç kaydı yok; toplam ${p.allTime} kaydı geçmiş dönemlere ait.`,
    });
  }

  if (
    p.daysSinceLast != null && p.averageIntervalDays != null &&
    p.averageIntervalDays > 0 &&
    p.daysSinceLast > p.averageIntervalDays * OVERDUE_FACTOR
  ) {
    s.push({
      kind: "overdue",
      text:
        `Son kayıttan bu yana ${p.daysSinceLast} gün geçti; ` +
        `bu varlığın ortalama aralığı ${p.averageIntervalDays} gün.`,
    });
  }

  if (p.changePercent != null && p.changePercent <= -CHANGE_THRESHOLD) {
    s.push({
      kind: "declining",
      text:
        `${p.previousRangeLabel} ${p.previous} kayıt varken ${p.rangeLabel} ` +
        `${p.current} kayıt var: %${Math.abs(p.changePercent)} düşüş.`,
    });
  } else if (p.changePercent != null && p.changePercent >= CHANGE_THRESHOLD) {
    s.push({
      kind: "growing",
      text:
        `${p.previousRangeLabel} ${p.previous} kayıttan ${p.rangeLabel} ` +
        `${p.current} kayda çıktı: %${p.changePercent} artış.`,
    });
  }

  if (p.peers && p.current > 0) {
    if (p.peers.percentile >= TOP_PERCENTILE) {
      s.push({
        kind: "topTier",
        text:
          `${p.peers.total} varlık içinde üst dilimde: ${p.peers.below} tanesinin üzerinde ` +
          `(%${p.peers.percentile}).`,
      });
    } else if (p.current < p.peers.average) {
      s.push({
        kind: "belowAverage",
        text:
          `Dönem ortalaması ${p.peers.average} kayıt; bu varlık ${p.current} kayıtla ` +
          "ortalamanın altında.",
      });
    }
  }

  // "Yeni" ilk kaydin bu donemde olmasi demek; gecmis kayit varsa degil.
  if (p.firstSeen && p.current > 0 && p.current === p.allTime) {
    s.push({
      kind: "new",
      text: `İlk kaydı bu dönemde: toplam ${p.allTime} kaydının hepsi ${p.rangeLabel} içinde.`,
    });
  }

  return s;
}

/**
 * Modelin kullanmasina IZIN VERILEN sayilar.
 *
 * Uretilen tavsiye metnindeki her sayi bu kumede olmali; olmayan bir
 * sayi modelin uydurdugu demektir ve metin reddedilir.
 */
export function allowedNumbers(p: EntityProfile): number[] {
  const n: (number | null)[] = [
    p.current, p.previous, p.changePercent,
    p.currentAmount, p.previousAmount, p.amountChangePercent,
    p.allTime, p.daysSinceLast, p.averageIntervalDays,
    p.peers?.total ?? null, p.peers?.below ?? null,
    p.peers?.percentile ?? null, p.peers?.average ?? null, p.peers?.max ?? null,
  ];
  // Mutlak deger de gecerli: "%20 dustu" ile "-%20" ayni olgu.
  const kume = new Set<number>();
  for (const v of n) {
    if (v == null || !Number.isFinite(v)) continue;
    kume.add(v);
    kume.add(Math.abs(v));
    kume.add(Math.round(Math.abs(v)));
  }
  return [...kume];
}
