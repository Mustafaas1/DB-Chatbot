import { orchestrator } from "./orchestrator";
import { dataAnalyst } from "./data-analyst";
import { acquisition } from "./acquisition";
import { retention } from "./retention";
import { experience } from "./experience";
import { productPricing } from "./product-pricing";
import { delivery } from "./delivery";
import { people } from "./people";
import { opsExecutor } from "./ops-executor";
import { tanimlariDenetle, type AjanTanimi } from "./tipler";

/**
 * Ajan kaydi.
 *
 * Denetim MODUL YUKLENIRKEN calisir: yazma yetkisi planlama ajanina
 * sizmissa uygulama hic ayaga kalkmaz. Kuralin sessizce bozulmasindansa
 * gurultulu sekilde durmasi yeglenir.
 */
export const AJAN_TANIMLARI: readonly AjanTanimi[] = [
  orchestrator,
  dataAnalyst,
  acquisition,
  retention,
  experience,
  productPricing,
  delivery,
  people,
  opsExecutor,
];

tanimlariDenetle(AJAN_TANIMLARI);

/** Yalnizca veri sorgulayan ajanlar; olcumler bunlara dagitilir. */
export const PLANLAMA_AJANLARI = AJAN_TANIMLARI.filter((a) => a.tur === "planlama");

/** Yazma yetkisi olan TEK ajan. */
export const YURUTME_AJANI = AJAN_TANIMLARI.find((a) => a.tur === "yurutme")!;

export function ajanTanimiBul(kod: string): AjanTanimi | undefined {
  return AJAN_TANIMLARI.find((a) => a.kod === kod);
}

export * from "./tipler";
export {
  orchestrator, dataAnalyst, acquisition, retention,
  experience, productPricing, delivery, people, opsExecutor,
};
