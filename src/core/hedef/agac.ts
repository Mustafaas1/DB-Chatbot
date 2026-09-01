import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Saglayici } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { yapisalIste } from "../llm/yapisal";
import { dugumMetni, genisletmeIstemi, ornekler, sonrakiTur } from "./istem";
import type { Agac, AgacKullanimi, AgacSonucu, GoalNodeGenis } from "./tipler";
import { GoalNodeGenis as GoalNodeGenisSemasi, type DugumTuru } from "../../schemas/index";

const CocukSemasi = z.object({
  baslik: z.string().min(1).max(200),
  gerekce: z.string().default(""),
  olcumSorusu: z.string().default(""),
});
const CocukListesi = z.array(CocukSemasi).min(1).max(5);

export interface AgacSecenekleri {
  saglayici: Saglayici;
  soru: string;
  /** Kok 0. sayilir. */
  azamiDerinlik?: number;
  /** Toplam LLM cagrisi tavani. Ucretsiz katmanda asil koruma bu. */
  azamiCagri?: number;
  /** Olcum katmanini gercek veriye baglar. */
  veriOzetiMetni?: string;
}

function dugumYap(
  statement: string, type: DugumTuru, rationale: string,
  parentId: string | null, measurementQuery?: string
): GoalNodeGenis {
  return GoalNodeGenisSemasi.parse({
    id: randomUUID(),
    parentId,
    statement,
    type,
    rationale,
    ...(measurementQuery ? { measurementQuery } : {}),
    evidence: [],
    children: [],
    status: "pending",
  });
}

/**
 * Hedef agacini KATMAN KATMAN kurar ve DUZ liste dondurur.
 *
 * Tek seferde butun agaci istemek bu modelde yarim JSON uretiyordu. Her
 * genisletme ayri, kucuk ve sematiksiz bir cagri: agac kurmak icin
 * veritabani semasi gerekmiyor, bu da maliyeti dusuk tutuyor.
 */
export async function agacKur(s: AgacSecenekleri): Promise<AgacSonucu> {
  const azamiDerinlik = s.azamiDerinlik ?? 3;
  const azamiCagri = s.azamiCagri ?? 6;

  const kok = dugumYap(s.soru, "goal", "", null);
  const dugumler: Agac = [kok];
  const derinlik = new Map<string, number>([[kok.id, 0]]);

  const kullanim: AgacKullanimi = { girdiTokeni: 0, ciktiTokeni: 0, cagriSayisi: 0 };
  let genisletilmeyen = 0;

  // Genislikte arama: butce biterse agac dar kalir ama DENGELI kalir;
  // derinlemesine gidip tek dal sismiyor.
  const kuyruk: GoalNodeGenis[] = [kok];

  while (kuyruk.length) {
    const dugum = kuyruk.shift()!;
    const cocukTuru = sonrakiTur(dugum.type);
    const d = derinlik.get(dugum.id) ?? 0;

    if (!cocukTuru || d >= azamiDerinlik) continue;
    if (kullanim.cagriSayisi >= azamiCagri) { genisletilmeyen++; continue; }

    let cocuklar: z.infer<typeof CocukListesi>;
    try {
      cocuklar = await genislet(s.saglayici, dugum, s.soru, cocukTuru, kullanim, s.veriOzetiMetni);
    } catch (e) {
      if (e instanceof LlmHatasi && e.kod === "kota") { genisletilmeyen++; break; }
      genisletilmeyen++;
      continue;
    }

    for (const c of cocuklar) {
      const yeni = dugumYap(
        c.baslik, cocukTuru, c.gerekce, dugum.id,
        cocukTuru === "metric" ? c.olcumSorusu || c.baslik : undefined
      );
      dugumler.push(yeni);
      dugum.children.push(yeni.id);
      derinlik.set(yeni.id, d + 1);
      kuyruk.push(yeni);
    }
  }

  return { dugumler, kullanim, genisletilmeyen };
}

async function genislet(
  saglayici: Saglayici,
  dugum: GoalNodeGenis,
  asilSoru: string,
  cocukTuru: DugumTuru,
  kullanim: AgacKullanimi,
  veriOzetiMetni?: string
): Promise<z.infer<typeof CocukListesi>> {
  const ornekMesajlari = ornekler(cocukTuru).flatMap((o) => [
    { rol: "kullanici" as const, metin: o.girdi },
    { rol: "asistan" as const, metin: o.cikti },
  ]);

  // Yapisal cikti + tek retry yapisalIste icinde.
  const { deger, kullanim: k } = await yapisalIste({
    saglayici,
    istek: {
      mesajlar: [
        { rol: "sistem", metin: genisletmeIstemi(cocukTuru, veriOzetiMetni) },
        ...ornekMesajlari,
        { rol: "kullanici", metin: dugumMetni(dugum, asilSoru) },
      ],
      akilYurutmeGayreti: "low",
      azamiCiktiTokeni: 700,
    },
    sema: z.union([
      CocukListesi,
      z.object({ cocuklar: CocukListesi }).transform((o) => o.cocuklar),
    ]),
  });

  kullanim.girdiTokeni += k.girdiTokeni;
  kullanim.ciktiTokeni += k.ciktiTokeni;
  kullanim.cagriSayisi += 1;
  return deger;
}
