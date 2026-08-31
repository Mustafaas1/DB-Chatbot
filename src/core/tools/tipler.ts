import type { z } from "zod";

/** Aracin nereden geldigi. MCP araclari dis surecten gelir, yereller kod icinde tanimlidir. */
export type AracKaynagi = "yerel" | "mcp";

/**
 * Aracin yan etkisi.
 *
 * Bu alan ISTEGE BAGLI DEGIL. F5'teki "beyaz liste + insan onayi" kapisi
 * tamamen buna dayanacak: "yazma" isaretli hicbir arac onaysiz
 * calistirilamayacak. Ilk gunden zorunlu tutuluyor ki sonradan eklenen bir
 * arac yanlislikla onay kapisinin disinda kalmasin.
 */
export type YanEtki = "okuma" | "yazma";

/** Arac calistirilirken tasinan baglam. Su an sade; F5'te kullanici/onay bilgisi eklenecek. */
export interface Baglam {
  /** Bu cagrinin izlenebilir kimligi; audit log F5'te buna baglanacak. */
  izId: string;
  /** true ise arac gercekten calismaz, ne yapacagini anlatir. */
  provaMi: boolean;
}

export interface AracTanimi<G = unknown, C = unknown> {
  ad: string;
  aciklama: string;
  kaynak: AracKaynagi;
  yanEtki: YanEtki;
  girdiSemasi: z.ZodType<G>;
  calistir(girdi: G, baglam: Baglam): Promise<C>;
}

/** Arac cagrisinin sonucu. Hata firlatmak yerine tiplenmis sonuc doner. */
export type AracSonucu<C = unknown> =
  | { ok: true; deger: C; sureMs: number }
  | { ok: false; hata: string; kod: AracHataKodu; sureMs: number };

export type AracHataKodu =
  | "bilinmeyen_arac"
  | "gecersiz_girdi"
  | "onay_gerekli"
  | "calistirma_hatasi";
