import { z } from "zod";
import type { AracHataKodu, AracSonucu, AracTanimi, Baglam } from "./tipler";
import * as idem from "./idempotency";
import { IdempotencyCakismasi } from "./idempotency";

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
  /** Arac adi -> son cagri zamanlari. Hiz siniri icin. */
  readonly #cagriZamanlari = new Map<string, number[]>();

  /** Pencere icindeki cagri sayisi sinirin altinda mi. */
  #hizSiniriUygun(arac: AracTanimi<any, any>): boolean {
    const s = arac.hizSiniri;
    if (!s) return true;
    const simdi = Date.now();
    const gecmis = (this.#cagriZamanlari.get(arac.ad) ?? []).filter((t) => simdi - t < s.pencereMs);
    this.#cagriZamanlari.set(arac.ad, gecmis);
    return gecmis.length < s.azamiCagri;
  }

  #cagriKaydet(ad: string): void {
    this.#cagriZamanlari.set(ad, [...(this.#cagriZamanlari.get(ad) ?? []), Date.now()]);
  }

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

  /**
   * Yalnizca verilen adlari tasiyan yeni bir kayit dondurur.
   *
   * Ajan allowlist'i icin: ajan tanimda yazmayan bir araci GOREMEZ,
   * dolayisiyla cagiramaz. Filtrelemeyi cagri aninda yapmak yerine
   * kaydi daraltmak daha guvenli: arac semalari da LLM'e gitmez.
   */
  altKume(adlar: readonly string[]): AracKaydi {
    const yeni = new AracKaydi();
    for (const ad of adlar) {
      const arac = this.#araclar.get(ad);
      if (arac) yeni.kaydet(arac);
    }
    return yeni;
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

    if (!this.#hizSiniriUygun(arac)) {
      const s = arac.hizSiniri!;
      return basarisiz(
        "hiz_siniri",
        `"${ad}" icin hiz siniri asildi: ${s.pencereMs / 1000} saniyede ${s.azamiCagri} cagri.`
      );
    }

    // Yan etkili araclar ONAY olmadan calistirilamaz. F5'teki yurutucu
    // de ayni sarti koyuyor; burada tekrar zorlanmasi savunma derinligi.
    if (arac.yanEtki === "yazma" && !baglam.provaMi && !baglam.onaylayan?.trim()) {
      return basarisiz(
        "onay_gerekli",
        `"${ad}" yan etkili bir arac; onaylayan belirtilmeden calistirilamaz.`
      );
    }

    // Yan etkili araclar IDEMPOTENCY ANAHTARI olmadan calistirilamaz.
    // Zorunlu tutmazsak "gecen sefer unutulmus" bir cagri iki kez
    // uygulanir ve kimse fark etmez.
    if (arac.yanEtki === "yazma" && !baglam.provaMi && !baglam.idempotencyAnahtari) {
      return basarisiz(
        "idempotency_gerekli",
        `"${ad}" yan etkili bir arac; idempotency anahtari olmadan calistirilamaz.`
      );
    }

    // Prova yolu: yan etki yok, tekrar korumasi da gerekmiyor.
    if (baglam.provaMi && arac.prova) {
      try {
        const deger = await arac.prova(dogrulama.data, baglam);
        return { ok: true, deger, sureMs: Date.now() - t0 };
      } catch (e) {
        return basarisiz("calistirma_hatasi", e instanceof Error ? e.message : String(e));
      }
    }

    const anahtar =
      arac.yanEtki === "yazma" && !baglam.provaMi ? baglam.idempotencyAnahtari! : null;

    if (anahtar) {
      let onceki: idem.OncekiCagri | null;
      try {
        onceki = idem.baslat(anahtar, ad, dogrulama.data);
      } catch (e) {
        if (e instanceof IdempotencyCakismasi) {
          return basarisiz("gecersiz_girdi", e.message);
        }
        throw e;
      }

      // Ayni anahtarla ikinci cagri: arac TEKRAR CALISTIRILMAZ.
      if (onceki) {
        return {
          ok: true, deger: onceki.sonuc, sureMs: Date.now() - t0, tekrarMi: true,
        };
      }
    }

    this.#cagriKaydet(ad);

    try {
      const deger = await arac.calistir(dogrulama.data, baglam);
      if (anahtar) idem.tamamla(anahtar, deger);
      return { ok: true, deger, sureMs: Date.now() - t0 };
    } catch (e) {
      // Basarisiz cagri kayittan DUSURULUR: gecici bir hatadan sonra
      // aksiyonun bir daha hic denenememesi olmaz.
      if (anahtar) idem.basarisiz(anahtar);
      return basarisiz("calistirma_hatasi", e instanceof Error ? e.message : String(e));
    }
  }
}
