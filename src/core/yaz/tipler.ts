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
  /**
   * Islemin risk seviyesi. MODELE SORULMAZ: islemin kendi ozelligi.
   * Modelin "risk: low" deyip gecmesi mumkun; bu alan kodda sabit.
   */
  risk: "low" | "medium" | "high";
  /** Hangi tabloyu etkiliyor; denetim kaydinda ve onay ekraninda gosterilir. */
  hedefTablo: string;
  /**
   * Kaydi tekillestiren parametrenin adi (biletNo, teklifNo, faturaId).
   * Aksiyon uretiminde bu parametre GERCEK kayitlara karsi dogrulanir;
   * dogrulanamiyorsa aksiyon uretilmez.
   */
  kimlikParametresi: string;
  /**
   * Kaydi tekillestiren TABLO KOLONU. Parametre adindan farkli olabilir
   * (faturaId -> Id). Somut kayit getirirken bu kolon kullanilir; aksi
   * halde listelenen kimlik (ornegin MikroEvrakNo) islemin bekledigi
   * kimlige (Id) hic uymuyordu.
   */
  kimlikKolonu: string;
  /** Kisi adi tasiyan parametre varsa adi; gercek kisilere karsi dogrulanir. */
  kisiParametresi?: string;
  parametreSemasi: z.ZodType<P>;
  /** Calistirmadan once ne olacagini hesaplar. YAN ETKISI YOKTUR. */
  prova(p: P): Promise<Prova>;
  /** Uygular ve GERI ALMA icin gereken onceki durumu dondurur. */
  uygula(p: P): Promise<{ etkilenen: number; oncekiDurum: unknown }>;
  /** Onceki duruma dondurur. */
  geriAl(oncekiDurum: unknown): Promise<{ etkilenen: number }>;
}

/**
 * Parametre tipi SILINMIS islem.
 *
 * Beyaz liste farkli parametre tiplerindeki islemleri tek dizide tutuyor;
 * IslemTanimi<any> ile yazilmisti. `any` yerine silinmis bir arayuz
 * kullaniyoruz: metotlar `unknown` aliyor ve cagrilmadan ONCE kendi Zod
 * semasiyla dogruluyor.
 *
 * Bu yalnizca tip hilesi degil, ek bir guvenlik katmani: silinmis yoldan
 * cagrilan her islem parametrelerini yeniden dogruluyor.
 */
export interface SilinmisIslem {
  kod: string;
  ad: string;
  aciklama: string;
  risk: "low" | "medium" | "high";
  hedefTablo: string;
  kimlikParametresi: string;
  kimlikKolonu: string;
  kisiParametresi?: string;
  parametreSemasi: z.ZodType<unknown>;
  prova(p: unknown): Promise<Prova>;
  uygula(p: unknown): Promise<{ etkilenen: number; oncekiDurum: unknown }>;
  geriAl(oncekiDurum: unknown): Promise<{ etkilenen: number }>;
}

/** Tipli islemi silinmis bicime cevirir; parametreler her cagrida dogrulanir. */
export function islemiSil<P>(i: IslemTanimi<P>): SilinmisIslem {
  const dogrula = (p: unknown): P => i.parametreSemasi.parse(p);
  return {
    kod: i.kod,
    ad: i.ad,
    aciklama: i.aciklama,
    risk: i.risk,
    hedefTablo: i.hedefTablo,
    kimlikParametresi: i.kimlikParametresi,
    kimlikKolonu: i.kimlikKolonu,
    ...(i.kisiParametresi ? { kisiParametresi: i.kisiParametresi } : {}),
    parametreSemasi: i.parametreSemasi as z.ZodType<unknown>,
    prova: (p) => i.prova(dogrula(p)),
    uygula: (p) => i.uygula(dogrula(p)),
    geriAl: (o) => i.geriAl(o),
  };
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
  /**
   * Onaylayan. Insan adi, ya da otonomi karariyla calistiysa
   * "otomatik:<mod>". Ikisi ayirt edilebilsin diye tek alanda
   * birlestirilmedi: otonomiModu ayrica yaziliyor.
   */
  onaylayan: string | null;
  /** Karar hangi otonomi modunda verildi. Eski kayitlarda null. */
  otonomiModu: string | null;
  hata: string | null;
  olusturma: string;
  guncelleme: string;
}
