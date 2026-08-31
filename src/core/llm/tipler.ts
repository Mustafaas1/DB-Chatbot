/**
 * Saglayicidan BAGIMSIZ LLM tipleri.
 *
 * Groq (OpenAI uyumlu) ile Anthropic'in arac cagrisi bicimleri farkli:
 * biri message.tool_calls[], digeri tool_use icerik bloklari. Bu katman
 * ikisini de ayni sekle indirger; ust katmanlar farki hic gormez.
 * Boylece Claude'a gecis kod degisikligi degil ayar degisikligi olur.
 */

export type Rol = "sistem" | "kullanici" | "asistan" | "arac";

export interface AracCagrisi {
  id: string;
  ad: string;
  /** Ham girdi; dogrulama arac kaydinda yapilir. */
  girdi: unknown;
}

export type Mesaj =
  | { rol: "sistem"; metin: string }
  | { rol: "kullanici"; metin: string }
  | { rol: "asistan"; metin: string; aracCagrilari?: AracCagrisi[] }
  | { rol: "arac"; cagriId: string; ad: string; icerik: string };

export interface AracSemasi {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface KonusmaIstegi {
  mesajlar: Mesaj[];
  araclar?: AracSemasi[];
  azamiCiktiTokeni?: number;
  /** gpt-oss modellerinde dusuk tutmak yapisal cikti icin belirgin fark yaratiyor. */
  akilYurutmeGayreti?: "low" | "medium" | "high";
}

export interface Kullanim {
  girdiTokeni: number;
  ciktiTokeni: number;
}

export type BitisSebebi = "tamamlandi" | "arac_cagrisi" | "uzunluk" | "diger";

export interface SaglayiciYaniti {
  metin: string;
  aracCagrilari: AracCagrisi[];
  kullanim: Kullanim;
  bitisSebebi: BitisSebebi;
  model: string;
}

export interface Saglayici {
  readonly ad: string;
  readonly model: string;
  konus(istek: KonusmaIstegi): Promise<SaglayiciYaniti>;
}

/** LLM cagrisi basarisiz oldu. Kod, ust katmanin ne yapacagini belirler. */
export class LlmHatasi extends Error {
  constructor(
    mesaj: string,
    readonly kod: "kota" | "kimlik" | "baglanti" | "gecersiz_yanit" | "bilinmeyen"
  ) {
    super(mesaj);
    this.name = "LlmHatasi";
  }
}
