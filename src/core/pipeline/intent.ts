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

export const IntentSchema = z.object({
  /** Olculecek ana buyukluk. */
  metrik: z.string().default(""),
  /** "son 30 gun", "bu ceyrek" gibi. Yoksa bos. */
  zamanAraligi: z.string().default(""),
  /** Kirilim/segment: "kanala gore", "kisi bazinda" gibi. */
  segment: z.string().default(""),
  /**
   * Soruda ADI GECEN tek varlik: "Fellas", "MANTIS KABLO" gibi.
   *
   * Model burayi doldurur ama BAGLAYICI DEGIL: kod adi veritabaninda
   * arar ve bulamazsa varlik kartini hic kurmaz. Modelin yazdigi ada
   * guvenmek, uydurulmus musteri adini gercek gibi gostermek olurdu.
   */
  varlik: z.string().default(""),
  /**
   * Kullanicinin ASIL amaci, tek cumle. Soruda yazmasa bile cikarilir.
   * Hedef agacinin koku budur.
   */
  ortukHedef: z.string().min(1),
  /** Soru dogrudan bir veri sorusu mu, yoksa acik uclu bir amac mi. */
  tur: z.enum(["veri_sorusu", "amac"]).default("veri_sorusu"),
});
export type Intent = z.infer<typeof IntentSchema>;

const ISTEM = [
  "Bir is zekasi analistisin. Sana bir soru verilir; onu ayristirirsin.",
  "",
  "ORTUK HEDEF en onemli alan: kullanicinin soruyu NEDEN sordugu.",
  "Soruda yazmasa bile cikar. Tek cumle, eyleme donuk olsun.",
  "",
  "DIL: metin alanlarini DUZGUN TURKCE yaz ve Turkce karakterleri",
  "kullan (ç ğ ı ö ş ü). Bu metinler kullaniciya oldugu gibi",
  "gosteriliyor; 'satisi yukseltilmek' gibi devrik ya da ASCII'ye",
  "dusmus cumle kabul edilmez.",
  "",
  "varlik: soruda BIR TEK varligin adi geciyorsa yaz, yoksa bos birak.",
  "  Genel bir sozcugu (musteri, urun, bilet) varlik adi SAYMA.",
  "",
  "tur:",
  "  veri_sorusu -- belirli bir rakam/liste isteniyor",
  "  amac        -- acik uclu iyilestirme sorusu",
  "",
  "YALNIZCA JSON dondur:",
  '{"metrik":"...","zamanAraligi":"","segment":"","varlik":"",' +
  '"ortukHedef":"...","tur":"veri_sorusu"}',
].join("\n");

/** Ornekler kurallardan baskin; bu modelde ozellikle. */
const ORNEKLER: { soru: string; niyet: Intent }[] = [
  {
    soru: "Aşamalarına göre açık destek biletleri",
    niyet: {
      metrik: "açık destek bileti sayısı", zamanAraligi: "", segment: "aşamaya göre",
      varlik: "",
      ortukHedef: "Açık biletlerin nerede biriktiğini görüp destek yükünü azaltmak",
      tur: "veri_sorusu",
    },
  },
  {
    soru: "Satış performansımızı nasıl artırırız?",
    niyet: {
      metrik: "kazanılan teklif sayısı ve tutarı", zamanAraligi: "", segment: "",
      varlik: "",
      ortukHedef: "Teklif kazanma oranını yükselterek satış gelirini artırmak",
      tur: "amac",
    },
  },
  {
    soru: "Son 30 günde kanala göre bilet sayısı",
    niyet: {
      metrik: "bilet sayısı", zamanAraligi: "son 30 gün", segment: "kanala göre",
      varlik: "",
      ortukHedef: "Hangi kanalın destek yükünü ürettiğini bulup o kanalı iyileştirmek",
      tur: "veri_sorusu",
    },
  },
  {
    soru: "Fellas diye bir müşteriye bu ay kaç kere satış yaptık?",
    niyet: {
      metrik: "satış adedi", zamanAraligi: "bu ay", segment: "",
      varlik: "Fellas",
      ortukHedef: "Bu müşteriyle çalışma sıklığını görüp satışı artırmak",
      tur: "veri_sorusu",
    },
  },
];

export interface IntentResult {
  niyet: Intent;
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
  /** LLM basarisiz olduysa true: ham soru kok olarak kullanildi. */
  fellBack: boolean;
}

/**
 * Soruyu ayristirir.
 *
 * BASARISIZ OLURSA zinciri durdurmaz: ortuk hedef olarak ham soru
 * kullanilir ve geriDusuldu isaretlenir. S0 bir kolaylik katmani;
 * calismamasi butun boru hattini bosa cikarmamali.
 */
export async function extractIntent(
  saglayici: Saglayici, soru: string
): Promise<IntentResult> {
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
      sema: IntentSchema,
    });
    return { niyet: deger, kullanim, fellBack: false };
  } catch (e) {
    if (e instanceof LlmHatasi && e.kod === "kota") throw e;
    return {
      niyet: {
        metrik: "", zamanAraligi: "", segment: "", varlik: "",
        ortukHedef: soru, tur: "veri_sorusu",
      },
      kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
      fellBack: true,
    };
  }
}
