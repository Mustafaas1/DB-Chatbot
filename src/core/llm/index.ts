import { config as envYukle } from "dotenv";
import { GroqSaglayici } from "./groq.js";
import type { Saglayici } from "./tipler.js";
import { LlmHatasi } from "./tipler.js";

envYukle();

/**
 * Aktif saglayiciyi LLM_PROVIDER'a gore secer.
 *
 * Anthropic su an KURULU DEGIL. Ucretli oldugu icin Groq ile basliyoruz;
 * gecis sirasi geldiginde buraya AnthropicSaglayici eklenecek, cagiran
 * katmanlarin hicbiri degismeyecek.
 */
export function saglayiciSec(): Saglayici {
  const secim = (process.env.LLM_PROVIDER ?? "groq").toLowerCase();

  if (secim === "groq") {
    return new GroqSaglayici(
      process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      process.env.GROQ_API_KEY ?? ""
    );
  }

  if (secim === "anthropic") {
    throw new LlmHatasi(
      "Anthropic saglayicisi henuz kurulmadi. LLM_PROVIDER=groq kullanin.",
      "kimlik"
    );
  }

  throw new LlmHatasi(`Bilinmeyen LLM_PROVIDER: ${secim}`, "kimlik");
}

export * from "./tipler.js";
