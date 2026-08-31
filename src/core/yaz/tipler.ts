import type { z } from "zod";

/**
 * Yazma islemleri.
 *
 * TEMEL KURAL: LLM serbest SQL yazamaz. Yalnizca burada TANIMLI islemler
 * calistirilabilir ve her biri tipli parametre alir. Beyaz liste iki yerde
 * birden zorlanir:
 *   1. Burada (kod)  -- tanimsiz islem cagrilamaz
 *   2. Veritabaninda -- ajan_yazar kullanicisinin tablolara yazma yetkisi
 *      YOK, yalnizca bu islemlerin sakli yordamlarina EXECUTE yetkisi var
 * Kod katmani asilsa bile veritabani reddeder.
 */

export type IslemDurumu =
  | "oneri"        // hazirlandi, onay bekliyor
  | "onaylandi"    // insan onayladi, henuz calismadi
  | "uygulandi"
  | "reddedildi"
  | "geri_alindi"
  | "basarisiz";

/** Provanin ciktisi: ne DEGISECEK, insan okuyabilir bicimde. */
export interface Prova {
  /** Tek cumlelik ozet. Onay ekraninda basliktir. */
  ozet: string;
  /** Etkilenecek kayit sayisi. 0 ise islem anlamsiz, onaya sunulmamali. */
  etkilenen: number;
  /** Once/sonra tablosu. */
  degisiklikler: {
    kimlik: string;
    alan: string;
    onceki: string;
    sonraki: string;
  }[];
  /** Prova sirasinda fark edilen uyarilar (cok kayit, geri alinamaz vb.). */
  uyarilar: string[];
}

export interface IslemTanimi<P = unknown> {
  kod: string;
  ad: string;
  aciklama: string;
  /** Hangi tabloyu etkiliyor; denetim kaydinda ve onay ekraninda gosterilir. */
  hedefTablo: string;
  parametreSemasi: z.ZodType<P>;
  /** Calistirmadan once ne olacagini hesaplar. YAN ETKISI YOKTUR. */
  prova(p: P): Promise<Prova>;
  /** Uygular ve GERI ALMA icin gereken onceki durumu dondurur. */
  uygula(p: P): Promise<{ etkilenen: number; oncekiDurum: unknown }>;
  /** Onceki duruma dondurur. */
  geriAl(oncekiDurum: unknown): Promise<{ etkilenen: number }>;
}

export interface DenetimKaydi {
  id: string;
  islemKodu: string;
  islemAdi: string;
  hedefTablo: string;
  parametreler: unknown;
  durum: IslemDurumu;
  prova: Prova | null;
  oncekiDurum: unknown;
  /** Onaylayan kisi. Sistem KENDI KENDINI onaylayamaz. */
  onaylayan: string | null;
  hata: string | null;
  olusturma: string;
  guncelleme: string;
}
