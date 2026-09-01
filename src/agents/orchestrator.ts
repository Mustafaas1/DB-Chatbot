import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/**
 * Zinciri kurar: niyet, hedef agaci, ajan yonlendirme, sonuc birlestirme.
 * VERI SORGULAMAZ; bu yuzden arac tasimaz.
 */
export const orchestrator: AjanTanimi = {
  kod: "orchestrator",
  ad: "Orkestratör",
  renk: "#4f46e5",
  tur: "orkestra",
  aciklama: "Niyet cikarimi, hedef agaci kurulumu, olcum dagitimi ve sonuc birlestirme.",
  rolPromptu: [
    "Bir is zekasi orkestratorusun. Kendi basina veri sorgulamazsin.",
    "Gorevin soruyu ORTUK HEDEFE cevirmek, hedef agacini kurmak ve her",
    "dali dogru uzman ajana yonlendirmek.",
    "Yuzeysel cevap verme: her icgorunun bir sonraki neden/nasil katmanina",
    "inmesi gerekir.",
  ].join("\n"),
  araclar: [],
  ciktiSemasi: z.object({
    ortukHedef: z.string(),
    dallar: z.array(z.object({ baslik: z.string(), ajan: z.string() })),
  }),
  limitler: { azamiTur: 1, azamiCiktiTokeni: 800, azamiCagri: 6 },
  tablolar: [],
  ornekler: ["Destek yükümüzü nasıl azaltırız?", "Satış performansımızı nasıl artırırız?"],
};
