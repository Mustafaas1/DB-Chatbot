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
  /** Bu cagrinin izlenebilir kimligi; denetim kaydi buna baglanir. */
  izId: string;
  /** true ise arac gercekten calismaz, ne yapacagini anlatir. */
  provaMi: boolean;
  /**
   * IDEMPOTENCY ANAHTARI.
   *
   * Yan etkili araclarda ZORUNLU. Ayni anahtarla ikinci cagri araci
   * TEKRAR CALISTIRMAZ; ilk cagrinin sonucunu doner.
   *
   * Neden gerekli: aginin kopmasi, kullanicinin iki kez tiklamasi ya da
   * bir retry, ayni aksiyonu iki kez uygulayabilir. "Bileti ata" iki kez
   * calisirsa zararsiz, ama "fatura kes" ya da "e-posta gonder" iki kez
   * calisirsa geri alinamaz.
   */
  idempotencyAnahtari?: string;
  /**
   * Onaylayan kisi. Yan etkili araclarda ZORUNLU.
   *
   * F5'teki yurutucu de ayni sarti koyuyor; burada TEKRAR zorlanmasi
   * savunma derinligi: bir ajan araci dogrudan cagirirsa onay akisini
   * atlayabilirdi. Sistem kendi kendini onaylayamaz.
   */
  onaylayan?: string;
}

/** Hiz siniri: pencere icinde en fazla kac cagri. */
export interface HizSiniri {
  /** Pencere uzunlugu (ms). */
  pencereMs: number;
  /** Pencere icinde izin verilen cagri sayisi. */
  azamiCagri: number;
}

export interface AracTanimi<G = unknown, C = unknown> {
  ad: string;
  aciklama: string;
  kaynak: AracKaynagi;
  yanEtki: YanEtki;
  /**
   * Risk seviyesi. yanEtki "bu arac yaziyor mu" sorusunu, risk ise
   * "yazarsa ne kadar kotu olur" sorusunu cevaplar. Ikisi ayri:
   * bilet atamak da fatura kesmek de yazma, ama riskleri farkli.
   */
  risk: "low" | "medium" | "high";
  girdiSemasi: z.ZodType<G>;
  calistir(girdi: G, baglam: Baglam): Promise<C>;
  /**
   * Yan etkisiz on izleme. Yan etkili araclarda BULUNMALI: onaya sunulan
   * seyin ne yapacagi once gosterilebilmeli.
   */
  prova?(girdi: G, baglam: Baglam): Promise<unknown>;
  /** Verilmezse sinir uygulanmaz. */
  hizSiniri?: HizSiniri;
}

/** Arac cagrisinin sonucu. Hata firlatmak yerine tiplenmis sonuc doner. */
export type AracSonucu<C = unknown> =
  | { ok: true; deger: C; sureMs: number; tekrarMi?: boolean }
  | { ok: false; hata: string; kod: AracHataKodu; sureMs: number };

export type AracHataKodu =
  | "bilinmeyen_arac"
  | "gecersiz_girdi"
  | "onay_gerekli"
  | "idempotency_gerekli"
  | "hiz_siniri"
  | "calistirma_hatasi";
