import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Saglayici } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { yapisalIste } from "../llm/yapisal";
import { dugumMetni, genisletmeIstemi, ornekler, sonrakiTur } from "./istem";
import type { Agac, AgacKullanimi, DugumTuru, HedefDugumu } from "./tipler";

const CocukSemasi = z.object({
  baslik: z.string().min(1).max(120),
  gerekce: z.string().default(""),
  olcumSorusu: z.string().default(""),
});
const CocukListesi = z.array(CocukSemasi).min(1).max(5);

export interface AgacSecenekleri {
  saglayici: Saglayici;
  soru: string;
  /** Kok 0. sayilir; 3 demek aksiyon katmanina kadar inmek demek. */
  azamiDerinlik?: number;
  /** Toplam LLM cagrisi tavani. Ucretsiz katmanda asil koruma bu. */
  azamiCagri?: number;
  /** Kompakt veri ozeti (bkz. veriOzeti.ts). Verilmezse model olmayan
   *  tablo ve kolonlar uyduruyor. */
  veriOzetiMetni?: string;
}

function dugumYap(
  baslik: string, tur: DugumTuru, gerekce: string, seviye: number, olcumSorusu?: string
): HedefDugumu {
  return {
    id: randomUUID(), baslik, tur, gerekce, seviye,
    cocuklar: [], durum: "bekliyor",
    ...(olcumSorusu ? { olcumSorusu } : {}),
  };
}

/**
 * Hedef agacini KATMAN KATMAN kurar.
 *
 * Tek seferde butun agaci istemek bu modelde yarim JSON uretiyordu.
 * Her genisletme ayri, kucuk ve sematiksiz bir cagri: agac kurmak icin
 * veritabani semasi gerekmiyor, bu da maliyeti dusuk tutuyor.
 */
export async function agacKur(s: AgacSecenekleri): Promise<Agac> {
  const azamiDerinlik = s.azamiDerinlik ?? 3;
  const azamiCagri = s.azamiCagri ?? 6;

  const kok = dugumYap(s.soru, "hedef", "", 0);
  const kullanim: AgacKullanimi = { girdiTokeni: 0, ciktiTokeni: 0, cagriSayisi: 0 };
  let genisletilmeyen = 0;

  // Genislikte arama: ust katmanlar once tamamlansin. Butce biterse
  // agac dar kalir ama DENGELI kalir; derinlemesine gidip tek dal
  // sismiyor.
  const kuyruk: HedefDugumu[] = [kok];

  while (kuyruk.length) {
    const dugum = kuyruk.shift()!;
    const cocukTuru = sonrakiTur(dugum.tur);

    if (!cocukTuru || dugum.seviye >= azamiDerinlik) continue;
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
        c.baslik, cocukTuru, c.gerekce, dugum.seviye + 1,
        cocukTuru === "olcum" ? c.olcumSorusu || c.baslik : undefined
      );
      dugum.cocuklar.push(yeni);
      kuyruk.push(yeni);
    }
  }

  return { kok, kullanim, genisletilmeyen };
}

async function genislet(
  saglayici: Saglayici,
  dugum: HedefDugumu,
  asilSoru: string,
  cocukTuru: DugumTuru,
  kullanim: AgacKullanimi,
  veriOzetiMetni?: string
): Promise<z.infer<typeof CocukListesi>> {
  const ornekMesajlari = ornekler(cocukTuru).flatMap((o) => [
    { rol: "kullanici" as const, metin: o.girdi },
    { rol: "asistan" as const, metin: o.cikti },
  ]);

  // Yapisal cikti + tek retry yapisalIste icinde; burada tekrar
  // uygulanmiyor ki iki katmanli retry olusmasin.
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


