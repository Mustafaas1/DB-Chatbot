import type { z } from "zod";

/**
 * Ajan tanimlari.
 *
 * Her ajan KENDI DOSYASINDA: rol promptu, arac allowlist'i, cikti semasi
 * ve maliyet/tur limiti bir arada durur. Boylece bir ajanin ne yapabildigi
 * tek yerden okunur; kod tabanina dagilmis olmaz.
 */

export type AjanTuru =
  /** Zinciri kurar; veri sorgulamaz. */
  | "orkestra"
  /** Veri okur ve plan uretir. YAZMA YETKISI YOKTUR. */
  | "planlama"
  /** Onaylanmis aksiyonlari yuruten TEK ajan. */
  | "yurutme";

export interface AjanLimitleri {
  /** Kac kez arac cagirabilir. Kotayi korur. */
  azamiTur: number;
  /** Tek cagrida uretebilecegi azami cikti tokeni. */
  azamiCiktiTokeni: number;
  /** Bir soru boyunca toplam LLM cagrisi tavani. */
  azamiCagri: number;
}

export interface AjanTanimi {
  kod: string;
  ad: string;
  renk: string;
  tur: AjanTuru;
  /** Yonlendirme bu aciklamaya bakar. */
  aciklama: string;
  /** Ajanin kimligi ve calisma bicimi. Sistem istemine eklenir. */
  rolPromptu: string;
  /**
   * ARAC ALLOWLIST. Ajan yalnizca burada yazan araclari cagirabilir.
   * Bos dizi = hicbir arac (orkestra ajani gibi).
   */
  araclar: readonly string[];
  /** Ajanin uretmesi beklenen cikti. */
  ciktiSemasi: z.ZodType;
  limitler: AjanLimitleri;
  /** Gorebilecegi tablolar. Bos ise tablo erisimi yok. */
  tablolar: readonly string[];
  ornekler: readonly string[];
}

/** Yazma yapan araclar. Yalnizca "yurutme" ajani bunlari alabilir. */
export const YAZMA_ARACLARI: readonly string[] = ["bilet_ata", "bilet_asama_degistir"];

export class AjanTanimHatasi extends Error {
  constructor(mesaj: string) { super(mesaj); this.name = "AjanTanimHatasi"; }
}

/**
 * TEMEL KURAL: planlama ajanlarinin yazma yetkisi YOKTUR.
 *
 * Kural yorumda kalirsa bir gun biri allowlist'e yazma araci ekler ve
 * kimse fark etmez. Burada kod olarak zorlanir; tanimlar yuklenirken
 * calisir ve testle de dogrulanir.
 */
export function tanimlariDenetle(ajanlar: readonly AjanTanimi[]): void {
  const kodlar = new Set<string>();

  for (const a of ajanlar) {
    if (kodlar.has(a.kod)) throw new AjanTanimHatasi(`Ayni kod iki kez: ${a.kod}`);
    kodlar.add(a.kod);

    const yazmaAraclari = a.araclar.filter((t) => YAZMA_ARACLARI.includes(t));
    if (a.tur !== "yurutme" && yazmaAraclari.length) {
      throw new AjanTanimHatasi(
        `"${a.kod}" ajani "${a.tur}" turunde ama yazma araci tasiyor: ` +
        `${yazmaAraclari.join(", ")}. Yazma yalnizca "yurutme" ajaninda olabilir.`
      );
    }

    if (a.tur === "orkestra" && a.araclar.length) {
      throw new AjanTanimHatasi(`"${a.kod}" orkestra ajani; arac tasiyamaz.`);
    }

    if (a.limitler.azamiTur < 1 || a.limitler.azamiCagri < 1) {
      throw new AjanTanimHatasi(`"${a.kod}" limitleri gecersiz.`);
    }
  }

  const yurutenler = ajanlar.filter((a) => a.tur === "yurutme");
  if (yurutenler.length > 1) {
    throw new AjanTanimHatasi(
      `Yazma yetkisi TEK ajanda olmali; ${yurutenler.length} tane var: ` +
      yurutenler.map((a) => a.kod).join(", ")
    );
  }
}
