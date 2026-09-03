import { randomUUID } from "node:crypto";
import { z } from "zod";
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

/**
 * Parametre adi -> izinli degerler.
 *
 * Model gercek kayitlar verilse bile kimlik uyduruyor (INC123456 gibi bir
 * bilet numarasi, AutoResponderBot gibi bir kisi). Istem bunu engellemiyor;
 * kod engelliyor.
 */
export type IzinliDegerler = Record<string, readonly string[]>;

export function aksiyonUret(oneri: AksiyonOnerisi, izinli?: IzinliDegerler): Action {
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

  const p = dogrulama.data as Record<string, unknown>;

  // KIMLIK ZORUNLU DOGRULANIR.
  //
  // Onceden yalnizca `izinli` verildiginde bakiliyordu; verilmediginde
  // kontrol tamamen atlaniyordu ve model uydurdugu kimlikle aksiyon
  // uretebiliyordu ("EXAMPLE_TEklif_001", "AliYilmaz"). Gercek kayda
  // baglanamiyorsa aksiyon URETILMEZ; plan "elle uygulanir" olarak kalir.
  const kimlikAdi = islem.kimlikParametresi;
  const kimlikIzinli = izinli?.[kimlikAdi];
  if (!kimlikIzinli?.length) {
    throw new AksiyonHatasi(
      `${kimlikAdi} gercek bir kayda baglanamadi: bu olcum ${islem.hedefTablo} ` +
      "tablosundan somut kayit uretmiyor. Aksiyon onerilmedi."
    );
  }

  // Kimlik dogrulamasi: model gercek kayitlar verilse bile uydurabiliyor.
  if (izinli) {
    for (const [ad, degerler] of Object.entries(izinli)) {
      if (!degerler.length || !(ad in p)) continue;
      const deger = String(p[ad]);
      if (!degerler.some((d) => d.toLowerCase() === deger.toLowerCase())) {
        throw new AksiyonHatasi(
          `${ad} = "${deger}" gecerli degil. Izinli degerler: ` +
          degerler.slice(0, 5).join(", ") + (degerler.length > 5 ? " ..." : "")
        );
      }
    }
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

/**
 * Islemin parametrelerini modele anlatan kompakt metin.
 *
 * Bunsuz model gecerli olmayan degerler oneriyordu
 * (asama: "Kapalı" gibi -- oyle bir asama yok). Zod semasindan JSON
 * Schema uretip izinli degerleri okuyoruz; elle yazilan bir liste
 * semayla ayrisabilirdi.
 */
function parametreMetni(sema: z.ZodType): string {
  let js: Record<string, any>;
  try { js = z.toJSONSchema(sema, { io: "input" }) as Record<string, any>; }
  catch { return ""; }

  const ozellikler = js.properties ?? {};
  const parcalar: string[] = [];

  for (const [ad, tanim] of Object.entries(ozellikler) as [string, any][]) {
    if (Array.isArray(tanim.enum)) {
      parcalar.push(`${ad}: ${tanim.enum.map((v: unknown) => `"${v}"`).join(" | ")}`);
    } else {
      parcalar.push(`${ad}: ${tanim.type ?? "deger"}`);
    }
  }
  return parcalar.join(", ");
}

/** Beyaz listedeki islemleri modele anlatmak icin kompakt liste. */
export function islemKatalogu(): {
  tool: string; ad: string; aciklama: string; risk: string; params: string;
}[] {
  return ISLEMLER.map((i) => ({
    tool: i.kod, ad: i.ad, aciklama: i.aciklama, risk: i.risk,
    params: parametreMetni(i.parametreSemasi),
  }));
}
