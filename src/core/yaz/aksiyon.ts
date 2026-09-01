import { randomUUID } from "node:crypto";
import { Action, onayZorunlulugunuUygula } from "../../schemas/index";
import { ISLEMLER, islemBul } from "./islemler";

/**
 * Beyaz listedeki bir islemden kanonik Action uretir.
 *
 * risk / reversible / dryRunSupported / rollback MODELE SORULMAZ:
 * bunlar islemin kendi ozellikleri. Modele sorulsa "risk: low, reversible:
 * true" deyip gecmesi mumkun ve kimse fark etmez. Kod turetiyor:
 *
 *   reversible       islemin geriAl() fonksiyonu var mi
 *   dryRunSupported  prova() fonksiyonu var mi
 *   risk             islem tanimindaki sabit
 *   rollback         geri alinabiliyorsa ayni islem, onceki degerle
 *
 * Modelden yalnizca NE yapilacagi (tool + params) ve NEDEN (expectedOutcome)
 * aliniyor.
 */
export interface AksiyonOnerisi {
  tool: string;
  params: Record<string, unknown>;
  title?: string;
  description?: string;
  expectedOutcome?: string;
}

export class AksiyonHatasi extends Error {
  constructor(mesaj: string) { super(mesaj); this.name = "AksiyonHatasi"; }
}

export function aksiyonUret(oneri: AksiyonOnerisi): Action {
  const islem = islemBul(oneri.tool);
  if (!islem) {
    throw new AksiyonHatasi(`Tanimsiz islem: ${oneri.tool}. Beyaz listede yok.`);
  }

  // Parametreler islemin KENDI semasiyla dogrulanir; modelin uydurdugu
  // alanlar burada elenir.
  const dogrulama = islem.parametreSemasi.safeParse(oneri.params);
  if (!dogrulama.success) {
    const ayrinti = dogrulama.error.issues
      .map((i) => `${i.path.join(".") || "(kok)"}: ${i.message}`).join("; ");
    throw new AksiyonHatasi(`Gecersiz parametre: ${ayrinti}`);
  }

  const reversible = typeof islem.geriAl === "function";

  const ham = Action.parse({
    id: randomUUID(),
    title: oneri.title?.trim() || islem.ad,
    description: oneri.description ?? islem.aciklama,
    tool: islem.kod,
    params: dogrulama.data as Record<string, unknown>,
    risk: islem.risk,
    reversible,
    // Bu alan asagida onayZorunlulugunuUygula ile yeniden degerlendiriliyor.
    requiresApproval: true,
    dryRunSupported: typeof islem.prova === "function",
    expectedOutcome: oneri.expectedOutcome ?? "",
    ...(reversible
      ? { rollback: { tool: islem.kod, params: {} } }
      : {}),
  });

  return onayZorunlulugunuUygula(ham);
}

/** Beyaz listedeki islemleri modele anlatmak icin kompakt liste. */
export function islemKatalogu(): { tool: string; ad: string; aciklama: string; risk: string }[] {
  return ISLEMLER.map((i) => ({
    tool: i.kod, ad: i.ad, aciklama: i.aciklama, risk: i.risk,
  }));
}
