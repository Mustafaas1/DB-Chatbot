import { z } from "zod";
import type { Saglayici } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { yapisalIste } from "../llm/yapisal";
import type { OlcumSonucu } from "../ajan/olcum";
import type { Teshis } from "./teshis";
import { ISLEMLER } from "../yaz/islemler";
import { olcumuDogrula } from "../hedef/dogrula";
import type { Tablo } from "../db/sema";
import type { KolonDegerleri } from "../db/degerler";

/**
 * S4 - PLAN
 *
 * Olcum + teshisten UYGULANABILIR aksiyon planlari uretir.
 *
 * Skorlama koda ait: modelden yalnizca impact/effort/confidence alinir,
 * siralama skorunu KOD hesaplar. Modele "skor ver" demek bu oturumda
 * tekrar tekrar tutarsiz cikti uretti; ayrica ayni formulle hesaplanan
 * skorlar planlar arasinda karsilastirilabilir oluyor.
 */

export const PlanSemasi = z.object({
  baslik: z.string().min(1).max(120),
  aciklama: z.string().default(""),
  /** 1-5: uygulanirsa hedefe etkisi. */
  etki: z.number().int().min(1).max(5),
  /** 1-5: uygulama zorlugu. 1 = cok kolay. */
  caba: z.number().int().min(1).max(5),
  /** 0-1: verinin bu plani ne kadar destekledigi. */
  guven: z.number().min(0).max(1),
  /** Varsa F5 beyaz listesindeki islem kodu; yoksa bos. */
  islemKodu: z.string().default(""),
});
export type HamPlan = z.infer<typeof PlanSemasi>;

export interface Plan extends HamPlan {
  id: string;
  dugumId: string;
  ajanKod: string;
  ajanAd: string;
  renk: string;
  /** KOD hesaplar: etki x guven / caba. Buyuk olan once. */
  skor: number;
  /** islemKodu beyaz listede var mi; arayuz "Uygula" gosterir. */
  yurutulebilir: boolean;
  /** Yurutulemez isaretlendiyse sebebi. */
  uyari: string;
}

/** Siralama skoru. Formul kodda sabit; planlar boylece karsilastirilabilir. */
export function skorHesapla(p: { etki: number; caba: number; guven: number }): number {
  return Math.round(((p.etki * p.guven) / p.caba) * 100) / 100;
}

function istem(islemKodlari: string[]): string {
  return [
    "Bir is zekasi danismanisin. Sana bir OLCUM SONUCU ve ondan cikarilan",
    "TESHIS verilir. Gorevin uygulanabilir aksiyon planlari yazmak.",
    "",
    "KURALLAR",
    "- 2-3 plan yaz. Az ve isabetli olsun.",
    "- Her plan TESHISE dayanmali; genel gecer nasihat yazma.",
    "- 'aciklama' tek cumle: ne yapilacak ve neden.",
    "- etki 1-5, caba 1-5 (1 = cok kolay), guven 0-1 arasi.",
    "- guven: veriyi ne kadar destekliyor. Zayif kanit varsa dusuk ver.",
    "",
    "SISTEMIN UYGULAYABILECEGI ISLEMLER:",
    ...(islemKodlari.length
      ? islemKodlari.map((k) => `  ${k}`)
      : ["  (yok)"]),
    "Plan bunlardan biriyle yapilabiliyorsa 'islemKodu' alanina yaz;",
    "yapilamiyorsa BOS birak. Listede olmayan kod UYDURMA.",
    "",
    "YALNIZCA JSON dizi dondur:",
    '[{"baslik":"...","aciklama":"...","etki":3,"caba":2,"guven":0.7,"islemKodu":""}]',
  ].join("\n");
}

function girdiMetni(sonuc: OlcumSonucu, teshis: Teshis, hedef: string): string {
  const satirlar = sonuc.satirlar.slice(0, 8)
    .map((r) => r.map((h) => (h === null || h === undefined ? "-" : String(h))).join(" | "));
  return [
    `ASIL HEDEF: ${hedef}`,
    `OLCUM: ${sonuc.baslik}`,
    `SORU: ${sonuc.soru}`,
    sonuc.kolonlar.length ? `VERI:` : "",
    sonuc.kolonlar.length ? sonuc.kolonlar.join(" | ") : "",
    ...satirlar,
    "",
    `TESHIS: ${teshis.bulgular.map((b) => b.metin).join(" ")}`,
  ].filter(Boolean).join("\n");
}

export interface PlanSonucu {
  planlar: Plan[];
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
}

/**
 * Bir olcum icin plan uretir.
 *
 * Basarisiz olursa BOS liste doner; zinciri durdurmaz. Plan bir ek
 * katman, olcum sonucunun kendisi zaten degerli.
 */
export async function planUret(
  saglayici: Saglayici,
  sonuc: OlcumSonucu,
  teshis: Teshis,
  hedef: string,
  /** Verilirse plan metni gercek degerlere karsi denetlenir. */
  dogrulama?: { tablolar: Tablo[]; degerler: KolonDegerleri[] }
): Promise<PlanSonucu> {
  const kodlar = ISLEMLER.map((i) => i.kod);
  const gecerliKodlar = new Set(kodlar);

  try {
    // Model JSON dizi dondurmesi gerekiyor ama response_format nesne
    // istiyor; diziyi "planlar" alaninda sariyoruz.
    const { deger, kullanim } = await yapisalIste({
      saglayici,
      istek: {
        mesajlar: [
          { rol: "sistem", metin: istem(kodlar) },
          { rol: "kullanici", metin: girdiMetni(sonuc, teshis, hedef) },
        ],
        akilYurutmeGayreti: "low",
        azamiCiktiTokeni: 800,
      },
      sema: z.union([
        z.array(PlanSemasi).min(1).max(5),
        z.object({ planlar: z.array(PlanSemasi).min(1).max(5) }).transform((o) => o.planlar),
      ]),
    });
    const ham = deger;
    const y = { kullanim };

    const planlar: Plan[] = ham.map((p, i) => {
      // Model olmayan islem kodu uydurabiliyor; beyaz listeye karsi
      // denetleniyor. Uydurulmussa plan kalir ama yurutulemez isaretlenir.
      let kod = gecerliKodlar.has(p.islemKodu) ? p.islemKodu : "";
      let uyari = "";

      // Plan olmayan bir duruma atif yapiyorsa (Asama='Çözülmüş' gibi)
      // YURUTULEBILIR sayilmaz. F5 yordami bunu zaten reddederdi, ama
      // arayuzun tutamayacagi bir soz vermesi de dogru degil.
      if (kod && dogrulama) {
        const d = olcumuDogrula(
          `${p.baslik} ${p.aciklama}`, dogrulama.tablolar, dogrulama.degerler
        );
        if (!d.gecerli) {
          uyari = d.gecersizlikler.map((g) => g.mesaj).join(" ");
          kod = "";
        }
      }

      return {
        ...p, islemKodu: kod, uyari,
        id: `${sonuc.dugumId}-${i}`,
        dugumId: sonuc.dugumId,
        ajanKod: sonuc.ajanKod, ajanAd: sonuc.ajanAd, renk: sonuc.renk,
        skor: skorHesapla(p),
        yurutulebilir: kod !== "",
      };
    });

    planlar.sort((a, b) => b.skor - a.skor);
    return { planlar, kullanim: y.kullanim };
  } catch (e) {
    if (e instanceof LlmHatasi && e.kod === "kota") throw e;
    return { planlar: [], kullanim: { girdiTokeni: 0, ciktiTokeni: 0 } };
  }
}
