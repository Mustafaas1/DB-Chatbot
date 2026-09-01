import { z } from "zod";
import type { Saglayici } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { yapisalIste } from "../llm/yapisal";

/**
 * S0 - INTENT
 *
 * Soruyu ayristirir: metrik, zaman araligi, segment ve ORTUK HEDEF.
 *
 * Ortuk hedef neden onemli: hedef agacinin KOKU bu olmali. Kullanici
 * "asamalarina gore acik biletler" diye sorar ama asil istedigi
 * "destek yukunu azaltmak"tir. Kok ham soru olursa agac bir raporlama
 * agacina donusuyor; ortuk hedef olursa gercekten kaldirac ariyor.
 */

export const NiyetSemasi = z.object({
  /** Olculecek ana buyukluk. */
  metrik: z.string().default(""),
  /** "son 30 gun", "bu ceyrek" gibi. Yoksa bos. */
  zamanAraligi: z.string().default(""),
  /** Kirilim/segment: "kanala gore", "kisi bazinda" gibi. */
  segment: z.string().default(""),
  /**
   * Kullanicinin ASIL amaci, tek cumle. Soruda yazmasa bile cikarilir.
   * Hedef agacinin koku budur.
   */
  ortukHedef: z.string().min(1),
  /** Soru dogrudan bir veri sorusu mu, yoksa acik uclu bir amac mi. */
  tur: z.enum(["veri_sorusu", "amac"]).default("veri_sorusu"),
});
export type Niyet = z.infer<typeof NiyetSemasi>;

const ISTEM = [
  "Bir is zekasi analistisin. Sana bir soru verilir; onu ayristirirsin.",
  "",
  "ORTUK HEDEF en onemli alan: kullanicinin soruyu NEDEN sordugu.",
  "Soruda yazmasa bile cikar. Tek cumle, eyleme donuk olsun.",
  "",
  "tur:",
  "  veri_sorusu -- belirli bir rakam/liste isteniyor",
  "  amac        -- acik uclu iyilestirme sorusu",
  "",
  "YALNIZCA JSON dondur:",
  '{"metrik":"...","zamanAraligi":"","segment":"","ortukHedef":"...","tur":"veri_sorusu"}',
].join("\n");

/** Ornekler kurallardan baskin; bu modelde ozellikle. */
const ORNEKLER: { soru: string; niyet: Niyet }[] = [
  {
    soru: "Asamalarina gore acik destek biletleri",
    niyet: {
      metrik: "acik destek bileti sayisi", zamanAraligi: "", segment: "asamaya gore",
      ortukHedef: "Acik biletlerin nerede biriktigini gorup destek yukunu azaltmak",
      tur: "veri_sorusu",
    },
  },
  {
    soru: "Satis performansimizi nasil artiririz?",
    niyet: {
      metrik: "kazanilan teklif sayisi ve tutari", zamanAraligi: "", segment: "",
      ortukHedef: "Teklif kazanma oranini yukselterek satis gelirini artirmak",
      tur: "amac",
    },
  },
  {
    soru: "Son 30 gunde kanala gore bilet sayisi",
    niyet: {
      metrik: "bilet sayisi", zamanAraligi: "son 30 gun", segment: "kanala gore",
      ortukHedef: "Hangi kanalin destek yukunu urettigini bulup o kanali iyilestirmek",
      tur: "veri_sorusu",
    },
  },
];

export interface NiyetSonucu {
  niyet: Niyet;
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
  /** LLM basarisiz olduysa true: ham soru kok olarak kullanildi. */
  geriDusuldu: boolean;
}

/**
 * Soruyu ayristirir.
 *
 * BASARISIZ OLURSA zinciri durdurmaz: ortuk hedef olarak ham soru
 * kullanilir ve geriDusuldu isaretlenir. S0 bir kolaylik katmani;
 * calismamasi butun boru hattini bosa cikarmamali.
 */
export async function niyetCikar(
  saglayici: Saglayici, soru: string
): Promise<NiyetSonucu> {
  const ornekMesajlari = ORNEKLER.flatMap((o) => [
    { rol: "kullanici" as const, metin: o.soru },
    { rol: "asistan" as const, metin: JSON.stringify(o.niyet) },
  ]);

  try {
    const { deger, kullanim } = await yapisalIste({
      saglayici,
      istek: {
        mesajlar: [
          { rol: "sistem", metin: ISTEM },
          ...ornekMesajlari,
          { rol: "kullanici", metin: soru },
        ],
        akilYurutmeGayreti: "low",
        azamiCiktiTokeni: 400,
      },
      sema: NiyetSemasi,
    });
    return { niyet: deger, kullanim, geriDusuldu: false };
  } catch (e) {
    if (e instanceof LlmHatasi && e.kod === "kota") throw e;
    return {
      niyet: {
        metrik: "", zamanAraligi: "", segment: "",
        ortukHedef: soru, tur: "veri_sorusu",
      },
      kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
      geriDusuldu: true,
    };
  }
}
