/**
 * Geri besleme dongusu tipleri.
 *
 * F6: uygulanan aksiyonun KPI etkisini olcup agaci guncelleme.
 */

/** Tek bir olcumun belirli bir andaki goruntusunu (snapshot) tutar. */
export interface OlcumSnapshot {
  id: string;
  denetimId: string;
  dugumId: string;
  ajanKod: string;
  soru: string;
  sqlSorgu: string;
  kolonlar: string[];
  satirlar: unknown[][];
  satirSayisi: number;
  /** "once" = uygulama oncesi, "sonra" = uygulama sonrasi. */
  tur: "once" | "sonra";
  olusturma: string;
}

/** Olcum baglami: hangi olcum sorgusunun hangi islemle iliskili oldugu. */
export interface OlcumBaglami {
  dugumId: string;
  ajanKod: string;
  soru: string;
  sql: string;
  /** Ajana ait tablo kapsamı; yeniden çalıştırmak için gerekli. */
  tablolar: string[];
}

/** Tek bir kolonun onceki ve sonraki degerleri arasindaki fark. */
export interface KolonEtkisi {
  kolon: string;
  /** Sayısal kolonlarda fark; diğerlerinde null. */
  fark: number | null;
  /** Yüzde değişim; önceki 0 ise null. */
  yuzde: number | null;
  /** Artış, azalış veya değişim yok. */
  yon: "artis" | "azalis" | "ayni" | "belirsiz";
}

/** Satır düzeyinde karşılaştırma. */
export interface SatirKarsilastirma {
  /** Her iki snapshot'ta ortak olan anahtar kolon değeri (ilk kolon). */
  anahtar: string;
  /** Kolon bazında önceki → sonraki değişimler. */
  degisimler: {
    kolon: string;
    onceki: unknown;
    sonraki: unknown;
    fark: number | null;
    yuzde: number | null;
  }[];
}

/** Tam etki raporu. */
export interface EtkiRaporu {
  /** Toplam satır sayısı değişimi. */
  satirDegisimi: {
    onceki: number;
    sonraki: number;
    fark: number;
    yon: "artis" | "azalis" | "ayni";
  };
  /** Kolon bazında toplamlar (sayısal kolonlar için). */
  kolonEtkileri: KolonEtkisi[];
  /** Satır bazında ayrıntılı karşılaştırma (ilk 20). */
  satirKarsilastirmalari: SatirKarsilastirma[];
  /** Önceki snapshot'ın zamanı. */
  onceZaman: string;
  /** Sonraki snapshot'ın zamanı. */
  sonraZaman: string;
  /** Snapshot uygulama öncesinde mi alındı, yoksa sonradan mı oluşturuldu. */
  gercekOnceMi: boolean;
}

/** SSE olayları. */
export type GeriBeslemeOlayi =
  | { tur: "basladi"; denetimId: string; islemAdi: string }
  | { tur: "once_tamam"; snapshot: OlcumSnapshot }
  | { tur: "sonra_basladi"; ajanKod: string; soru: string }
  | { tur: "sonra_tamam"; snapshot: OlcumSnapshot }
  | { tur: "etki"; rapor: EtkiRaporu; dugumId: string; baslik: string }
  | { tur: "bitti"; toplamSure: number }
  | { tur: "hata"; mesaj: string }
  | { tur: "uyari"; mesaj: string };

export interface GeriBeslemeSecenekleri {
  denetimId: string;
}
