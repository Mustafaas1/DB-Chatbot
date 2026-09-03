import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Saglayici } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { yapisalIste } from "../llm/yapisal";
import type { OlcumSonucu } from "../ajan/olcum";
import type { Diagnosis } from "./teshis";
import { Plan as PlanSemasi, planSkoru, type Action, type Plan } from "../../schemas/index";
import { aksiyonUret, islemKatalogu } from "../yaz/aksiyon";
import { validateMeasurement } from "../hedef/dogrula";
import type { Tablo } from "../db/sema";
import type { KolonDegerleri } from "../db/degerler";
import { fetchConcreteRecords, concreteRecordsText } from "./somutKayit";
import { ISLEMLER } from "../yaz/islemler";
import { baglamMetni as redBaglami } from "../plan/red";

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
const ModelPlan = z.object({
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
export interface PlanView extends Plan {
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

function inputText(
  sonuc: OlcumSonucu, teshis: Diagnosis, hedef: string, somutMetin?: string
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
    `TESHIS: ${teshis.findings.map((b) => b.metin).join(" ")}`,
    somutMetin ? "" : "",
    somutMetin ?? "",
  ].filter(Boolean).join("\n");
}

export interface PlanResult {
  planlar: PlanView[];
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
}

/** Kolon adlarini karsilastirmak icin sadelestirir: "Teklif No" -> "teklifno". */
function columnKey(ad: string): string {
  return ad.toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Olcum sonucundaki kimlik degerleri.
 *
 * Ajan kolonlara Turkce takma ad veriyor ("TeklifNo" -> "Teklif No"),
 * o yuzden karsilastirma sadelestirilmis adla yapiliyor.
 */
function identifiersFromMeasurement(sonuc: OlcumSonucu, kimlikKolonu: string): string[] {
  const hedef = columnKey(kimlikKolonu);
  const i = sonuc.kolonlar.findIndex((k) => columnKey(k) === hedef);
  if (i < 0) return [];
  return sonuc.satirlar
    .map((r) => r[i])
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export async function buildPlans(
  saglayici: Saglayici,
  sonuc: OlcumSonucu,
  teshis: Diagnosis,
  hedef: string,
  dogrulama?: { tablolar: Tablo[]; degerler: KolonDegerleri[] }
): Promise<PlanResult> {
  const katalog = islemKatalogu();

  // Olcumun isaret ettigi SOMUT kayitlari cek. Model toplu aksiyon
  // onerdiginde parametreler bos kaliyor ve aksiyon dusuyordu; gercek
  // kimlikler verilince aksiyonlar baglanabiliyor.
  const somut = await fetchConcreteRecords(sonuc, teshis);
  const somutMetin = somut ? concreteRecordsText(somut) : undefined;
  // Izinli degerler ISLEMIN KENDI parametre adlariyla kuruluyor.
  //
  // Onceden anahtarlar "biletNo"/"kisi" olarak SABIT yazilmisti; teklif ve
  // fatura islemleri "teklifNo"/"faturaId" kullandigi icin dogrulama
  // sessizce atlaniyor ve uydurma kimlikler geciyordu.
  //
  // Izinli kimlikler IKI KAYNAKTAN birlesiyor:
  //   1. somutKayitlariGetir'in ayri sorgusu,
  //   2. OLCUMUN KENDI satirlari.
  // Ikisi ayni kayitlar olmayabiliyor. Model, istemde gordugu olcum
  // ciktisindaki teklif numarasini kullaniyor ama dogrulama yalnizca (1)
  // ile yapiliyordu; gercek bir numara "gecerli degil" diye reddediliyordu.
  // Iki kume de veritabanindan geldigi icin birlesim guvenli.
  const allowedValues = somut
    ? Object.fromEntries(
        ISLEMLER
          .filter((i) => i.hedefTablo.toLowerCase() === somut.tablo.toLowerCase())
          .flatMap((i) => {
            const c: [string, readonly string[]][] = [
              [i.kimlikParametresi, [...new Set([
                ...somut.kayitlar.map((k) => k.kimlik),
                ...identifiersFromMeasurement(sonuc, i.kimlikKolonu),
              ])]],
            ];
            if (i.kisiParametresi && somut.atananlar.length) {
              c.push([i.kisiParametresi, somut.atananlar]);
            }
            return c;
          })
      )
    : undefined;

  // Daha once reddedilen planlar. Sistemin ogrenen tek parcasi: ayni
  // oneriyi tekrar tekrar uretmesin.
  const red = redBaglami(sonuc.ajanKod);

  try {
    const { deger, kullanim } = await yapisalIste({
      saglayici,
      istek: {
        mesajlar: [
          { rol: "sistem", metin: istem(katalog) },
          ...(red ? [{ rol: "sistem" as const, metin: red }] : []),
          { rol: "kullanici", metin: inputText(sonuc, teshis, hedef, somutMetin) },
        ],
        akilYurutmeGayreti: "low",
        azamiCiktiTokeni: 900,
      },
      sema: z.union([
        z.array(ModelPlan).min(1).max(5),
        z.object({ planlar: z.array(ModelPlan).min(1).max(5) }).transform((o) => o.planlar),
      ]),
    });

    const planlar: PlanView[] = deger.map((p) => {
      const uyarilar: string[] = [];
      const actions: Action[] = [];

      for (const a of p.actions) {
        if (!a.tool) continue;
        try {
          // Izinli kimlikler KODDAN geliyor: model gercek kayitlar
          // verilse bile INC123456 gibi bilet ya da AutoResponderBot gibi
          // kisi uyduruyordu.
          actions.push(aksiyonUret(a, allowedValues));
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
        const d = validateMeasurement(`${p.title} ${p.rationale}`, dogrulama.tablolar, dogrulama.degerler);
        if (!d.valid) {
          uyarilar.push(...d.invalidities.map((g) => g.mesaj));
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
