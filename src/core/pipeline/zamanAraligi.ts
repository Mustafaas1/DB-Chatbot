/**
 * Turkce zaman araligi ifadesini YAPIYA cevirir.
 *
 * Niyet cikarimi `zamanAraligi` alanini serbest metin olarak veriyor
 * ("son 1 ay", "gectigimiz 30 gun", "bu yil"). Dogrudan cevabin SQL'ini
 * kod uretecekse bu metnin once yapiya donmesi gerekiyor.
 *
 * Ayristirilamayan ifade icin `null` doner. Bu KASITLI: tahmin etmektense
 * cagiran tarafin ajana dusmesi dogru. "kanala gore" bir zaman araligi
 * degildir ve oyle davranilmamali.
 *
 * SQL uretmez; sorgu kurmak `zamanKosulu()` isinde (ayri tutuluyor ki
 * ayristirma kolon adindan bagimsiz test edilebilsin).
 */

export type TimeRange =
  /** Bugunden geriye N gun. */
  | { kind: "relative"; days: number }
  /** Takvim birimi: offset 0 = icinde bulundugumuz, -1 = onceki. */
  | { kind: "calendar"; unit: "month" | "year"; offset: 0 | -1 };

/** Turkce harfleri ASCII'ye indirger; kalip eslesmesi icin. */
function flatten(s: string): string {
  return s.toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");
}

/** Yazili sayilar; "son bir ay" da "son 1 ay" kadar yaygin. */
const WORD_NUMBERS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6,
  yedi: 7, sekiz: 8, dokuz: 9, on: 10, oniki: 12,
};

const UNIT_DAYS: Record<string, number> = {
  gun: 1, hafta: 7, ay: 30, yil: 365, sene: 365, ceyrek: 90,
};

/** "son", "gecen", "gectigimiz", "geride kalan" — hepsi geriye bakar. */
const BACKWARD = /\b(son|gecen|gectigimiz|geride|onceki|gerideki)\b/;

export function parseTimeRange(raw: string | null | undefined): TimeRange | null {
  if (!raw?.trim()) return null;
  const s = flatten(raw);

  // 1) Takvim ifadeleri once: "bu ay" ile "son 1 ay" AYNI SEY DEGIL.
  //    "bu ay" ayin 1'inden bugune, "son 1 ay" 30 gun geriye.
  if (/\b(bu|icinde bulundugumuz|mevcut)\s+(ay)\b/.test(s)) {
    return { kind: "calendar", unit: "month", offset: 0 };
  }
  if (/\b(bu|icinde bulundugumuz|mevcut)\s+(yil|sene)\b/.test(s)) {
    return { kind: "calendar", unit: "year", offset: 0 };
  }
  // "gecen ay" tek basina: onceki TAKVIM ayi. Sayi varsa (asagida)
  // goreli araliga duser.
  if (/\b(gecen|onceki|gectigimiz)\s+ay\b/.test(s) && !/\d/.test(s)) {
    return { kind: "calendar", unit: "month", offset: -1 };
  }
  if (/\b(gecen|onceki|gectigimiz)\s+(yil|sene)\b/.test(s) && !/\d/.test(s)) {
    return { kind: "calendar", unit: "year", offset: -1 };
  }

  // 2) Goreli aralik: "son 30 gun", "son bir ay", "son ceyrek"
  //
  // KELIME SINIRI SART: sinirsiz alternasyon "son" icindeki "on"u sayi
  // sanip "son ceyrek"i 10 x 90 = 900 gun yapiyordu.
  const birimDeseni = Object.keys(UNIT_DAYS).join("|");
  const sayiDeseni = Object.keys(WORD_NUMBERS).join("|");
  const m = new RegExp(
    `(?:\\b(\\d+)\\b|\\b(${sayiDeseni})\\b)?\\s*\\b(${birimDeseni})\\b`
  ).exec(s);
  if (!m) return null;

  const birim = m[3]!;
  // Sayi yoksa 1 varsayilir: "son ay" = "son 1 ay". "ceyrek" zaten 90 gun.
  const adet = m[1] ? parseInt(m[1], 10) : m[2] ? WORD_NUMBERS[m[2]]! : 1;
  if (adet <= 0) return null;

  // Geriye bakan bir sozcuk yoksa bu bir zaman araligi olmayabilir.
  // "aylik ciro" gibi ifadeleri aralik saymiyoruz.
  if (!BACKWARD.test(s)) return null;

  return { kind: "relative", days: adet * UNIT_DAYS[birim]! };
}

/**
 * Yapiyi SQL kosuluna cevirir.
 *
 * Kolon adi SEMADAN gelir; yine de koseli parantezle kacisliyor.
 */
export function timeRangeCondition(range: TimeRange, column: string): string {
  const col = `[${column.replace(/]/g, "]]")}]`;

  if (range.kind === "relative") {
    return `${col} >= DATEADD(day, -${range.days}, CAST(GETDATE() AS date))`;
  }

  if (range.unit === "month") {
    const ay = range.offset === 0
      ? "DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)"
      : "DATEADD(month, -1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))";
    // Onceki ay KAPALI aralik: bu ayin basina kadar.
    return range.offset === 0
      ? `${col} >= ${ay}`
      : `${col} >= ${ay} AND ${col} < DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)`;
  }

  const yil = range.offset === 0
    ? "DATEFROMPARTS(YEAR(GETDATE()), 1, 1)"
    : "DATEFROMPARTS(YEAR(GETDATE()) - 1, 1, 1)";
  return range.offset === 0
    ? `${col} >= ${yil}`
    : `${col} >= ${yil} AND ${col} < DATEFROMPARTS(YEAR(GETDATE()), 1, 1)`;
}

/** Kullaniciya gosterilecek kisa aciklama. */
export function timeRangeLabel(range: TimeRange): string {
  if (range.kind === "relative") return `son ${range.days} gün`;
  if (range.unit === "month") return range.offset === 0 ? "bu ay" : "geçen ay";
  return range.offset === 0 ? "bu yıl" : "geçen yıl";
}

/**
 * ONCEKI esdeger donemin SQL kosulu.
 *
 * "Bu ay 10 satis" tek basina bir sey soylemiyor; gecen ay 25 ise durum
 * baska, 3 ise baska. Karsilastirma donemi TAHMIN EDILMIYOR, aralik
 * turunden turetiliyor:
 *
 *   goreli N gun  -> ondan onceki N gun (kapali aralik)
 *   takvim ayi    -> bir onceki takvim ayi
 *   takvim yili   -> bir onceki takvim yili
 *
 * Goreli aralikta ust sinir SART: "son 60 gun" onceki donemi de
 * kapsardi ve karsilastirma kendi kendisiyle yapilirdi.
 */
export function previousTimeRangeCondition(range: TimeRange, column: string): string {
  const col = `[${column.replace(/]/g, "]]")}]`;

  if (range.kind === "relative") {
    const n = range.days;
    return (
      `${col} >= DATEADD(day, -${n * 2}, CAST(GETDATE() AS date)) AND ` +
      `${col} < DATEADD(day, -${n}, CAST(GETDATE() AS date))`
    );
  }

  // Takvim araliginda "onceki" = ayni birimden bir tane geriye. offset 0
  // icin -1, offset -1 icin -2 demek; ikisini de DATEADD ile kuruyoruz.
  const birim = range.unit;
  const bu = birim === "month"
    ? "DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)"
    : "DATEFROMPARTS(YEAR(GETDATE()), 1, 1)";
  const bas = `DATEADD(${birim}, ${range.offset - 1}, ${bu})`;
  const son = `DATEADD(${birim}, ${range.offset}, ${bu})`;
  return `${col} >= ${bas} AND ${col} < ${son}`;
}

/** Onceki donemin okunabilir etiketi. */
export function previousTimeRangeLabel(range: TimeRange): string {
  if (range.kind === "relative") return `önceki ${range.days} gün`;
  if (range.unit === "month") return range.offset === 0 ? "geçen ay" : "iki ay önce";
  return range.offset === 0 ? "geçen yıl" : "iki yıl önce";
}
