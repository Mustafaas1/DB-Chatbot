import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Saglayici } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { yapisalIste } from "../llm/yapisal";
import type { OlcumSonucu } from "../ajan/olcum";
import type { Teshis } from "./teshis";
import { Plan as PlanSemasi, planSkoru, type Action, type Plan } from "../../schemas/index";
import { aksiyonUret, islemKatalogu } from "../yaz/aksiyon";
import { olcumuDogrula } from "../hedef/dogrula";
import type { Tablo } from "../db/sema";
import type { KolonDegerleri } from "../db/degerler";
import { somutKayitlariGetir, somutKayitMetni } from "./somutKayit";

/**
 * S4 - PLAN
 *
 * Olcum + teshisten kanonik Plan uretir (spec bolum 5).
 *
 * Modelden ISTENMEYEN alanlar: id, skor, risk, reversible, requiresApproval,
 * dryRunSupported, rollback. Hepsi koddan turetiliyor. Modele sorulsa
 * "risk: low, requiresApproval: false" deyip gecebilir ve kimse fark etmez.
 */

/** Modelin dolduracagi alanlar. Digerleri kodda uretiliyor. */
const ModelPlani = z.object({
  title: z.string().min(1).max(160),
  rationale: z.string().default(""),
  impact: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  timeframe: z.string().default(""),
  kpi: z.string().default(""),
  actions: z.array(z.object({
    tool: z.string().default(""),
    params: z.record(z.string(), z.unknown()).default({}),
    title: z.string().default(""),
    expectedOutcome: z.string().default(""),
  })).default([]),
});

/** Gorunum icin ek alanlar; kanonik Plan bozulmuyor. */
export interface PlanGenis extends Plan {
  ajanAd: string;
  renk: string;
  /** KOD hesaplar: impact x confidence / effort. */
  skor: number;
  /** Bir aksiyon yurutulemez isaretlendiyse sebebi. */
  uyari: string;
}

function istem(katalog: ReturnType<typeof islemKatalogu>): string {
  return [
    "Bir is zekasi danismanisin. Sana bir OLCUM SONUCU ve ondan cikarilan",
    "TESHIS verilir. Gorevin uygulanabilir plan yazmak.",
    "",
    "KURALLAR",
    "- 2-3 plan yaz. Az ve isabetli olsun.",
    "- Her plan TESHISE dayanmali; genel gecer nasihat yazma.",
    "- impact 1-5, effort 1-5 (1 = cok kolay), confidence 0-1.",
    "- confidence: veriyi ne kadar destekliyor. Zayif kanit varsa dusuk ver.",
    "- timeframe: '2 hafta', 'bu ceyrek' gibi.",
    "- kpi: basarinin olculecegi gosterge.",
    "",
    "SISTEMIN UYGULAYABILECEGI ISLEMLER:",
    ...(katalog.length
      ? katalog.flatMap((k) => [
          `  ${k.tool} -- ${k.aciklama} (risk: ${k.risk})`,
          k.params ? `      params: ${k.params}` : "",
        ]).filter(Boolean)
      : ["  (yok)"]),
    "Plan bunlardan biriyle yapilabiliyorsa 'actions' dizisine",
    '{"tool":"...","params":{...},"expectedOutcome":"..."} ekle.',
    "Yapilamiyorsa actions BOS kalsin. Listede olmayan tool UYDURMA.",
    "Islemler TEK KAYIT uzerinde calisir; toplu aksiyon yazma. Asagida",
    "verilen ornek kayitlardan birini sec ve kimligini params'a koy.",
    "risk, reversible, requiresApproval alanlarini YAZMA; onlari sistem belirler.",
    "params degerlerini YUKARIDAKI listeden sec; baska deger UYDURMA.",
    "",
    "YALNIZCA JSON dondur:",
    '{"planlar":[{"title":"...","rationale":"...","impact":3,"effort":2,' +
      '"confidence":0.7,"timeframe":"","kpi":"","actions":[]}]}',
  ].join("\n");
}

function girdiMetni(
  sonuc: OlcumSonucu, teshis: Teshis, hedef: string, somutMetin?: string
): string {
  const satirlar = sonuc.satirlar.slice(0, 8)
    .map((r) => r.map((h) => (h === null || h === undefined ? "-" : String(h))).join(" | "));
  return [
    `ASIL HEDEF: ${hedef}`,
    `OLCUM: ${sonuc.baslik}`,
    `SORU: ${sonuc.soru}`,
    sonuc.kolonlar.length ? "VERI:" : "",
    sonuc.kolonlar.length ? sonuc.kolonlar.join(" | ") : "",
    ...satirlar,
    "",
    `TESHIS: ${teshis.bulgular.map((b) => b.metin).join(" ")}`,
    somutMetin ? "" : "",
    somutMetin ?? "",
  ].filter(Boolean).join("\n");
}

export interface PlanSonucu {
  planlar: PlanGenis[];
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
}

export async function planUret(
  saglayici: Saglayici,
  sonuc: OlcumSonucu,
  teshis: Teshis,
  hedef: string,
  dogrulama?: { tablolar: Tablo[]; degerler: KolonDegerleri[] }
): Promise<PlanSonucu> {
  const katalog = islemKatalogu();

  // Olcumun isaret ettigi SOMUT kayitlari cek. Model toplu aksiyon
  // onerdiginde parametreler bos kaliyor ve aksiyon dusuyordu; gercek
  // kimlikler verilince aksiyonlar baglanabiliyor.
  const somut = await somutKayitlariGetir(sonuc, teshis);
  const somutMetin = somut ? somutKayitMetni(somut) : undefined;
  const izinliDegerler = somut
    ? { biletNo: somut.kayitlar.map((k) => k.kimlik), kisi: somut.atananlar }
    : undefined;

  try {
    const { deger, kullanim } = await yapisalIste({
      saglayici,
      istek: {
        mesajlar: [
          { rol: "sistem", metin: istem(katalog) },
          { rol: "kullanici", metin: girdiMetni(sonuc, teshis, hedef, somutMetin) },
        ],
        akilYurutmeGayreti: "low",
        azamiCiktiTokeni: 900,
      },
      sema: z.union([
        z.array(ModelPlani).min(1).max(5),
        z.object({ planlar: z.array(ModelPlani).min(1).max(5) }).transform((o) => o.planlar),
      ]),
    });

    const planlar: PlanGenis[] = deger.map((p) => {
      const uyarilar: string[] = [];
      const actions: Action[] = [];

      for (const a of p.actions) {
        if (!a.tool) continue;
        try {
          // Izinli kimlikler KODDAN geliyor: model gercek kayitlar
          // verilse bile INC123456 gibi bilet ya da AutoResponderBot gibi
          // kisi uyduruyordu.
          actions.push(aksiyonUret(a, izinliDegerler));
        } catch (e) {
          // Model olmayan islem ya da gecersiz parametre onerdiyse aksiyon
          // dusurulur; plan kalir ama yurutulemez.
          uyarilar.push(e instanceof Error ? e.message : String(e));
        }
      }

      // Plan metni olmayan bir duruma atif yapiyorsa (Asama='Cozulmus')
      // aksiyonlari dusuruyoruz: F5 yordami zaten reddederdi ama arayuzun
      // tutamayacagi soz vermesi de dogru degil.
      if (actions.length && dogrulama) {
        const d = olcumuDogrula(`${p.title} ${p.rationale}`, dogrulama.tablolar, dogrulama.degerler);
        if (!d.gecerli) {
          uyarilar.push(...d.gecersizlikler.map((g) => g.mesaj));
          actions.length = 0;
        }
      }

      const kanonik = PlanSemasi.parse({
        id: randomUUID(),
        agent: sonuc.ajanKod,
        title: p.title,
        rationale: p.rationale,
        goalNodeIds: [sonuc.dugumId],
        impact: p.impact,
        effort: p.effort,
        confidence: p.confidence,
        timeframe: p.timeframe,
        kpi: p.kpi,
        actions,
      });

      return {
        ...kanonik,
        ajanAd: sonuc.ajanAd,
        renk: sonuc.renk,
        skor: planSkoru(kanonik),
        uyari: uyarilar.join(" "),
      };
    });

    planlar.sort((a, b) => b.skor - a.skor);
    return { planlar, kullanim };
  } catch (e) {
    if (e instanceof LlmHatasi && e.kod === "kota") throw e;
    return { planlar: [], kullanim: { girdiTokeni: 0, ciktiTokeni: 0 } };
  }
}

export { planSkoru };
