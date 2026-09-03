/**
 * SORU SEKLI TANIMA.
 *
 * Kod yolu bugune kadar iki sekli cozuyordu: "varlik basina liste" ve
 * "tek varlik profili". Geri kalan her sey ajana dusuyor ve ajan yolu
 * kosudan kosuya degisiyor -- ayni soru bir kosuda 73 satir, digerinde 33
 * satir dondurmustu.
 *
 * Burada iki sekil daha taniniyor:
 *
 *   sayim     -- "Bu ay kac bilet acildi?"   -> tek sayi
 *   siralama  -- "En cok satan urunler"      -> sirali kucuk tablo
 *
 * TANIYAMADIGINDA `null` DONER. Zaman ayristiricida verilen kararin
 * aynisi: yanlis tanivip yanlis SQL uretmektense hic tanimamak ve ajana
 * dusmek dogru.
 */

export type SoruSekli =
  | { kind: "sayim" }
  | { kind: "siralama"; yon: "ust" | "alt" };

/** Turkce harfleri ASCII'ye indirger; kullanici ikisini de yazabiliyor. */
function duzle(s: string): string {
  return s.toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");
}

/**
 * Sozcuk siniri.
 *
 * `\b` ASCII tabanli oldugu icin Turkce metinde guvenilmez; bu projede
 * ayni hata enjeksiyon kaliplarinda bir kez yasandi ve `\p{L}` sinifina
 * gecilmisti. Girdi burada zaten ASCII'ye indirgeniyor ama kural ayni
 * kalsin diye acik sinif kullaniliyor.
 */
function sozcuk(kalip: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${kalip})(?!\\p{L})`, "u");
}

/** Kirilim isteyen ifadeler: cevap tek sayi DEGIL, tablo olur. */
const KIRILIM = sozcuk("gore|bazinda|bazli|kirilim|kirilimi|dagilim|dagilimi|basina");

/** Sayim sorusu isaretleri. */
const SAYIM = sozcuk("kac|kacar|adet|adedi|sayisi|sayisini|ne kadar");

/** Siralama isaretleri; yon ayri belirleniyor. */
const SIRALAMA_UST = sozcuk("en cok|en fazla|en yuksek|en buyuk|en populer");
const SIRALAMA_ALT = sozcuk("en az|en dusuk|en kucuk|en seyrek");

export function detectShape(soru: string): SoruSekli | null {
  const s = duzle(soru ?? "").trim();
  if (!s) return null;

  // SIRALAMA ONCE: "En cok kac bilet acan musteri" her iki kalibi da
  // tasiyor ama cevabi tek sayi degil, sirali liste.
  if (SIRALAMA_UST.test(s)) return { kind: "siralama", yon: "ust" };
  if (SIRALAMA_ALT.test(s)) return { kind: "siralama", yon: "alt" };

  // Kirilim isteniyorsa sayim degil: "asamaya gore kac bilet" bir tablo.
  if (KIRILIM.test(s)) return null;

  if (SAYIM.test(s)) return { kind: "sayim" };

  return null;
}
