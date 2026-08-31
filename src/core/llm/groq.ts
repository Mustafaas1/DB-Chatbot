import OpenAI from "openai";
import type {
  AracCagrisi, BitisSebebi, KonusmaIstegi, Mesaj, Saglayici, SaglayiciYaniti,
} from "./tipler.js";
import { LlmHatasi } from "./tipler.js";

const TABAN_URL = "https://api.groq.com/openai/v1";

/** Saglayici-bagimsiz mesajlari OpenAI uyumlu bicime cevirir. */
function mesajlariCevir(mesajlar: Mesaj[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return mesajlar.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    switch (m.rol) {
      case "sistem":
        return { role: "system", content: m.metin };
      case "kullanici":
        return { role: "user", content: m.metin };
      case "asistan":
        return {
          role: "assistant",
          content: m.metin || null,
          ...(m.aracCagrilari?.length
            ? {
                tool_calls: m.aracCagrilari.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.ad, arguments: JSON.stringify(c.girdi ?? {}) },
                })),
              }
            : {}),
        };
      case "arac":
        return { role: "tool", tool_call_id: m.cagriId, content: m.icerik };
    }
  });
}

function hatayiCevir(e: unknown): LlmHatasi {
  const durum = (e as { status?: number })?.status;
  const mesaj = e instanceof Error ? e.message : String(e);
  if (durum === 429) return new LlmHatasi("Groq kotasi doldu: " + mesaj, "kota");
  if (durum === 401 || durum === 403) return new LlmHatasi("GROQ_API_KEY gecersiz.", "kimlik");
  if (durum === undefined && /fetch|ECONN|ENOTFOUND|timeout/i.test(mesaj)) {
    return new LlmHatasi("Groq'a baglanilamadi: " + mesaj, "baglanti");
  }
  return new LlmHatasi(mesaj, "bilinmeyen");
}

export class GroqSaglayici implements Saglayici {
  readonly ad = "groq";
  readonly #istemci: OpenAI;

  constructor(readonly model: string, apiAnahtari: string) {
    if (!apiAnahtari) throw new LlmHatasi("GROQ_API_KEY tanimli degil.", "kimlik");
    this.#istemci = new OpenAI({ apiKey: apiAnahtari, baseURL: TABAN_URL });
  }

  async konus(istek: KonusmaIstegi): Promise<SaglayiciYaniti> {
    let yanit: OpenAI.Chat.ChatCompletion;
    try {
      yanit = await this.#istemci.chat.completions.create({
        model: this.model,
        messages: mesajlariCevir(istek.mesajlar),
        max_completion_tokens: istek.azamiCiktiTokeni ?? 1200,
        ...(istek.akilYurutmeGayreti
          ? { reasoning_effort: istek.akilYurutmeGayreti }
          : {}),
        ...(istek.araclar?.length
          ? {
              tools: istek.araclar.map((a) => ({
                type: "function" as const,
                function: {
                  name: a.name,
                  description: a.description,
                  parameters: a.input_schema,
                },
              })),
            }
          : {}),
      });
    } catch (e) {
      throw hatayiCevir(e);
    }

    const secim = yanit.choices[0];
    if (!secim) throw new LlmHatasi("Groq bos yanit dondu.", "gecersiz_yanit");

    const aracCagrilari: AracCagrisi[] = (secim.message.tool_calls ?? []).flatMap((c) => {
      if (c.type !== "function") return [];
      let girdi: unknown = {};
      try {
        girdi = c.function.arguments ? JSON.parse(c.function.arguments) : {};
      } catch {
        // Bozuk JSON'u burada patlatmiyoruz: arac kaydi bunu
        // "gecersiz_girdi" olarak raporlar ve model duzeltme sansi bulur.
        girdi = { __bozukJson: c.function.arguments };
      }
      return [{ id: c.id, ad: c.function.name, girdi }];
    });

    const bitis: BitisSebebi =
      secim.finish_reason === "tool_calls" ? "arac_cagrisi"
      : secim.finish_reason === "length" ? "uzunluk"
      : secim.finish_reason === "stop" ? "tamamlandi"
      : "diger";

    return {
      metin: secim.message.content ?? "",
      aracCagrilari,
      bitisSebebi: bitis,
      model: yanit.model,
      kullanim: {
        girdiTokeni: yanit.usage?.prompt_tokens ?? 0,
        ciktiTokeni: yanit.usage?.completion_tokens ?? 0,
      },
    };
  }
}
