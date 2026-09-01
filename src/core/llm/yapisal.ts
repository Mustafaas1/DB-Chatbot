import type { z } from "zod";
import type { KonusmaIstegi, Saglayici } from "./tipler";
import { LlmHatasi } from "./tipler";

/**
 * Yapisal cikti: iste, Zod ile dogrula, basarisizsa TEK retry.
 *
 * Spec sarti: "LLM ciktisini ASLA serbest metin olarak parse etme;
 * structured output + Zod validation + basarisizsa tek retry."
 *
 * Uc yerde ayni mantik tekrarlaniyordu (niyet, agac, plan) ve her biri
 * kendi jsonAyikla kopyasini tasiyordu. Tek yerde olunca davranis da
 * tekillesiyor.
 */

export class YapisalCiktiHatasi extends Error {
  constructor(mesaj: string, readonly hamCikti: string) {
    super(mesaj);
    this.name = "YapisalCiktiHatasi";
  }
}

/**
 * Model bazen JSON'u kod blogu icinde ya da aciklamayla birlikte
 * donduruyor. response_format destegi olsa bile bu geri dusus duruyor:
 * saglayici degistiginde (Anthropic) davranis farkli olabiliyor.
 */
function jsonAyikla(ham: string): unknown {
  const metin = ham.trim().replace(/^```[a-zA-Z]*/, "").replace(/```$/, "").trim();

  // Dogrudan parse: yapisal cikti calistiysa bu yol tutar.
  try { return JSON.parse(metin); } catch { /* geri dususe gec */ }

  // Geri dusus: ilk acilis ile son kapanis arasi.
  for (const [ac, kapa] of [["[", "]"], ["{", "}"]] as const) {
    const bas = metin.indexOf(ac);
    const son = metin.lastIndexOf(kapa);
    if (bas !== -1 && son > bas) {
      try { return JSON.parse(metin.slice(bas, son + 1)); } catch { /* dene */ }
    }
  }
  throw new YapisalCiktiHatasi("Cikti JSON olarak okunamadi", ham.slice(0, 200));
}

export interface YapisalSecenekler<T> {
  saglayici: Saglayici;
  istek: Omit<KonusmaIstegi, "jsonCikti">;
  sema: z.ZodType<T>;
  /** Retry'de cikti butcesi bu kadar artar; kirpik cikti en sik sebep. */
  retryButceCarpani?: number;
}

export interface YapisalSonuc<T> {
  deger: T;
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
  /** Ilk deneme basarisiz olup ikincisi tuttuysa true. */
  tekrarDenendi: boolean;
}

/**
 * Sema disi cikti REDDEDILIR. Tek retry hakki var; o da tutmazsa hata.
 */
export async function yapisalIste<T>(s: YapisalSecenekler<T>): Promise<YapisalSonuc<T>> {
  const carpan = s.retryButceCarpani ?? 1.6;
  const kullanim = { girdiTokeni: 0, ciktiTokeni: 0 };
  let sonHata = "";
  let sonCikti = "";

  for (let deneme = 0; deneme < 2; deneme++) {
    const butce = s.istek.azamiCiktiTokeni ?? 800;
    const yanit = await s.saglayici.konus({
      ...s.istek,
      jsonCikti: true,
      azamiCiktiTokeni: deneme === 0 ? butce : Math.round(butce * carpan),
    });

    kullanim.girdiTokeni += yanit.kullanim.girdiTokeni;
    kullanim.ciktiTokeni += yanit.kullanim.ciktiTokeni;
    sonCikti = yanit.metin;

    if (yanit.bitisSebebi === "uzunluk") {
      sonHata = "cikti kirpildi";
      continue;
    }

    try {
      return { deger: s.sema.parse(jsonAyikla(yanit.metin)), kullanim, tekrarDenendi: deneme > 0 };
    } catch (e) {
      sonHata = e instanceof Error ? e.message : String(e);
    }
  }

  throw new YapisalCiktiHatasi(`Sema disi cikti (tek retry sonrasi): ${sonHata}`, sonCikti);
}

export { LlmHatasi };
