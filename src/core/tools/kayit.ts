import { z } from "zod";
import type { AracHataKodu, AracSonucu, AracTanimi, Baglam } from "./tipler.js";

/** Anthropic tool-use bicimindeki arac semasi. */
export interface AnthropicArac {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Araclarin tek kayit defteri.
 *
 * Yerel araclar ve MCP'den gelenler AYNI kayda girer; cagiran taraf
 * arasindaki farki bilmek zorunda kalmaz.
 */
export class AracKaydi {
  readonly #araclar = new Map<string, AracTanimi<any, any>>();

  kaydet<G, C>(arac: AracTanimi<G, C>): void {
    if (this.#araclar.has(arac.ad)) {
      throw new Error(`Ayni adla iki arac kaydedilemez: ${arac.ad}`);
    }
    this.#araclar.set(arac.ad, arac);
  }

  getir(ad: string): AracTanimi<any, any> | undefined {
    return this.#araclar.get(ad);
  }

  liste(): AracTanimi<any, any>[] {
    return [...this.#araclar.values()].sort((a, b) => a.ad.localeCompare(b.ad));
  }

  /** Yalnizca okuma yapan araclar. F5 oncesi tum sistem bunlarla calisir. */
  okumaAraclari(): AracTanimi<any, any>[] {
    return this.liste().filter((a) => a.yanEtki === "okuma");
  }

  /** LLM'e gonderilecek sema listesi. */
  anthropicSemalari(): AnthropicArac[] {
    return this.liste().map((a) => ({
      name: a.ad,
      description: a.aciklama,
      input_schema: z.toJSONSchema(a.girdiSemasi, { io: "input" }) as Record<string, unknown>,
    }));
  }

  /**
   * Araci dogrulayip calistirir.
   *
   * Girdi ONCE Zod ile dogrulanir: LLM'den gelen ham JSON'un araca
   * dogrudan girmesine izin verilmez.
   */
  async calistir(ad: string, hamGirdi: unknown, baglam: Baglam): Promise<AracSonucu> {
    const t0 = Date.now();
    const basarisiz = (kod: AracHataKodu, hata: string): AracSonucu => ({
      ok: false, kod, hata, sureMs: Date.now() - t0,
    });

    const arac = this.#araclar.get(ad);
    if (!arac) return basarisiz("bilinmeyen_arac", `Boyle bir arac yok: ${ad}`);

    const dogrulama = arac.girdiSemasi.safeParse(hamGirdi);
    if (!dogrulama.success) {
      const ayrinti = dogrulama.error.issues
        .map((i) => `${i.path.join(".") || "(kok)"}: ${i.message}`)
        .join("; ");
      return basarisiz("gecersiz_girdi", ayrinti);
    }

    // Yazma araclari prova disinda onay kapisindan gecmek zorunda.
    // Onay katmani F5'te geliyor; o gelene kadar KAPALI kaliyor ki
    // yarim kalmis bir yol sessizce acik kalmasin.
    if (arac.yanEtki === "yazma" && !baglam.provaMi) {
      return basarisiz("onay_gerekli", `"${ad}" yazma yapiyor; onay katmani (F5) henuz yok.`);
    }

    try {
      const deger = await arac.calistir(dogrulama.data, baglam);
      return { ok: true, deger, sureMs: Date.now() - t0 };
    } catch (e) {
      return basarisiz("calistirma_hatasi", e instanceof Error ? e.message : String(e));
    }
  }
}
