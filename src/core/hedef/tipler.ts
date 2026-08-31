/**
 * Hedef agaci ("Sampiyonluk Agaci").
 *
 * Bir soru dogrudan cevaplanmaz; once bir HEDEF AGACINA cevrilir.
 * Her dugum bir ust dugumun "neden/nasil" katmanidir:
 *
 *   Ciro artisi                      (hedef)
 *     Musteri sayisi                 (surucu)
 *       Yeni musteri kazanimi        (olcum)  -> veriyle olculebilir
 *         Kanal bazli kampanya       (aksiyon)
 */

export type DugumTuru =
  /** Kok: kullanicinin asil amaci. */
  | "hedef"
  /** Hedefi belirleyen bilesen; matematiksel ya da nedensel. */
  | "surucu"
  /** Veriyle OLCULEBILIR soru. Bunlar veri adimina donusur. */
  | "olcum"
  /** Somut, uygulanabilir aksiyon. F5'te yurutulecek. */
  | "aksiyon";

export type DugumDurumu = "bekliyor" | "olculuyor" | "olculdu" | "basarisiz";

export interface Bulgu {
  ozet: string;
  kolonlar?: string[];
  satirlar?: unknown[][];
  sql?: string;
}

export interface HedefDugumu {
  id: string;
  baslik: string;
  tur: DugumTuru;
  /** Bu dugum ust dugumden NEDEN turedi. Agacin okunabilirligi buna bagli. */
  gerekce: string;
  seviye: number;
  cocuklar: HedefDugumu[];
  /** Yalnizca "olcum" dugumlerinde: veriye sorulacak soru. */
  olcumSorusu?: string;
  durum: DugumDurumu;
  bulgu?: Bulgu;
}

export interface AgacKullanimi {
  girdiTokeni: number;
  ciktiTokeni: number;
  cagriSayisi: number;
}

export interface Agac {
  kok: HedefDugumu;
  kullanim: AgacKullanimi;
  /** Butce ya da derinlik yuzunden genisletilemeyen dugum sayisi. */
  genisletilmeyen: number;
}

/** Agaci duz listeye acar (gorsellestirme ve olcum sirasi icin). */
export function duzles(dugum: HedefDugumu): HedefDugumu[] {
  return [dugum, ...dugum.cocuklar.flatMap(duzles)];
}

/** Veriyle olculebilir dugumler; F4 bunlari ajanlara dagitacak. */
export function olcumDugumleri(kok: HedefDugumu): HedefDugumu[] {
  return duzles(kok).filter((d) => d.tur === "olcum" && d.olcumSorusu);
}
