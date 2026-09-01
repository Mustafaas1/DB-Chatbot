import { z } from "zod";

/**
 * KANONIK VERI SEMALARI.
 *
 * Tum ajan ciktilari bunlara uymak zorunda. Sema disi cikti REDDEDILIR.
 *
 * Neden tek dosyada: sema sozlesmedir. Uretici ve tuketici ayni tanimi
 * gormezse "gecerli" tanimi taraflara gore degisir.
 */

// ---------------------------------------------------------------------------
// Evidence -- kanit ve kaynagi
// ---------------------------------------------------------------------------

/**
 * Bir degerin NEREDEN geldigi.
 *
 * Bu oturumun en pahali dersi: model gordugunu kullanip gormedigini
 * uyduruyor ve ikisi ciktida ayni gorunuyor. Kaynak isaretlenince
 * "veritabanindan okundu" ile "model boyle tahmin etti" ayirt edilebiliyor.
 */
export const KaynakTuru = z.enum(["db", "api", "mcp", "llm-inference"]);
export type KaynakTuru = z.infer<typeof KaynakTuru>;

export const Evidence = z.object({
  source: KaynakTuru,
  /** db/mcp icin calistirilan sorgu; llm-inference icin bos. */
  query: z.string().optional(),
  value: z.unknown(),
  /** 0-1. llm-inference kaynaklarda dusuk tutulmali. */
  confidence: z.number().min(0).max(1),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------------------------------------------------------------------------
// GoalNode -- hedef agaci dugumu
// ---------------------------------------------------------------------------

/**
 * Dugum turleri.
 *   goal     kullanicinin ortuk hedefi (kok)
 *   metric   olculebilir buyukluk
 *   lever    hedefi hareket ettiren kaldirac
 *   resource kaldiraci kullanmak icin gereken kaynak/kisit
 *   action   somut, uygulanabilir aksiyon
 */
export const DugumTuru = z.enum(["goal", "metric", "lever", "resource", "action"]);
export type DugumTuru = z.infer<typeof DugumTuru>;

/**
 * Agac DUZ tutulur: cocuklar id listesi, ic ice nesne degil.
 *
 * Ic ice yapida ayni dugume iki yerden atif yapilamiyor ve kismi
 * guncelleme butun agaci dolasmayi gerektiriyor. Duz yapida dugum
 * kimligiyle adreslenir; F6 geri beslemesi de dugume id ile baglanir.
 */
export const GoalNode = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  /** Dugumun ifadesi. Tek cumle. */
  statement: z.string().min(1).max(200),
  type: DugumTuru,
  /** Olculduyse mevcut deger. */
  currentValue: z.number().nullable().optional(),
  /** Hedeflenen deger; bilinmiyorsa bos. */
  targetValue: z.number().nullable().optional(),
  evidence: z.array(Evidence).default([]),
  children: z.array(z.string()).default([]),
});
export type GoalNode = z.infer<typeof GoalNode>;

/**
 * Calisma zamani alanlariyla genisletilmis dugum.
 *
 * Kanonik GoalNode BOZULMADAN kaliyor; bunlar acikca EK alanlar:
 *
 *   rationale         Dugumun ust dugumden NEDEN turedigi. Spec'te yok ama
 *                     zihinsel modelin merkezi: "her icgoru bir sonraki
 *                     neden/nasil katmanina inmek zorunda". Bu alan
 *                     olmadan agac bir baslik listesine donuyor.
 *   measurementQuery  Olculmeden once veriye sorulacak soru. Olculdukten
 *                     sonra evidence[].query'ye de yaziliyor; ama oncesinde
 *                     kanit olmadigi icin ayri bir yere ihtiyac var.
 *   status            Olcum durumu. Sema degil surec bilgisi.
 */
export const DugumDurumu = z.enum(["pending", "measuring", "measured", "failed"]);
export type DugumDurumu = z.infer<typeof DugumDurumu>;

export const GoalNodeGenis = GoalNode.extend({
  rationale: z.string().default(""),
  measurementQuery: z.string().optional(),
  status: DugumDurumu.default("pending"),
});
export type GoalNodeGenis = z.infer<typeof GoalNodeGenis>;

/** Duz agac: kimlik -> dugum. */
export type Agac = GoalNodeGenis[];

/** Kok dugum: parentId'si null olan. */
export function kokDugum(agac: Agac): GoalNodeGenis | undefined {
  return agac.find((d) => d.parentId === null);
}

/** Olculebilir dugumler; olcum sorusu olanlar. */
export function olcumDugumleri(agac: Agac): GoalNodeGenis[] {
  return agac.filter((d) => d.type === "metric" && d.measurementQuery);
}

/** Dugumu kokten baslayarak derinlik sirasiyla gezer. */
export function derinlikSirasi(agac: Agac): { dugum: GoalNodeGenis; derinlik: number }[] {
  const harita = new Map(agac.map((d) => [d.id, d]));
  const cikti: { dugum: GoalNodeGenis; derinlik: number }[] = [];

  const gez = (id: string, derinlik: number, gorulen: Set<string>) => {
    if (gorulen.has(id)) return;   // dongu korumasi
    gorulen.add(id);
    const d = harita.get(id);
    if (!d) return;
    cikti.push({ dugum: d, derinlik });
    for (const c of d.children) gez(c, derinlik + 1, gorulen);
  };

  const kok = kokDugum(agac);
  if (kok) gez(kok.id, 0, new Set());
  return cikti;
}

// ---------------------------------------------------------------------------
// Action -- yurutulebilir aksiyon
// ---------------------------------------------------------------------------

export const RiskSeviyesi = z.enum(["low", "medium", "high"]);
export type RiskSeviyesi = z.infer<typeof RiskSeviyesi>;

export const Action = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  description: z.string().default(""),
  /** Beyaz listedeki arac/islem kodu. */
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  risk: RiskSeviyesi,
  /** Geri alinabilir mi. Geri alinamayan aksiyon her zaman onay ister. */
  reversible: z.boolean(),
  requiresApproval: z.boolean(),
  dryRunSupported: z.boolean(),
  expectedOutcome: z.string().default(""),
  rollback: z.object({
    tool: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  }).optional(),
});
export type Action = z.infer<typeof Action>;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const Plan = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  title: z.string().min(1).max(160),
  rationale: z.string().default(""),
  /** Bu planin dayandigi agac dugumleri. */
  goalNodeIds: z.array(z.string()).default([]),
  impact: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  /** "2 hafta", "bu ceyrek" gibi. */
  timeframe: z.string().default(""),
  /** Basarinin olculecegi gosterge. */
  kpi: z.string().default(""),
  actions: z.array(Action).default([]),
});
export type Plan = z.infer<typeof Plan>;

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

/** Siralama skoru. Modelden alinmaz; kod hesaplar ki planlar kiyaslanabilsin. */
export function planSkoru(p: Pick<Plan, "impact" | "effort" | "confidence">): number {
  return Math.round(((p.impact * p.confidence) / p.effort) * 100) / 100;
}

/**
 * Geri alinamayan ya da yuksek riskli aksiyon MUTLAKA onay ister.
 *
 * Modelin requiresApproval alanina guvenmek yeterli degil: "false" yazip
 * gecmesi mumkun. Kod bu invaryanti zorluyor.
 */
export function onayZorunlulugunuUygula(a: Action): Action {
  const zorunlu = !a.reversible || a.risk === "high";
  return zorunlu ? { ...a, requiresApproval: true } : a;
}

/** Duz agactan bir dugumun cocuklarini getirir. */
export function cocuklariGetir(agac: readonly GoalNode[], id: string): GoalNode[] {
  const harita = new Map(agac.map((d) => [d.id, d]));
  return (harita.get(id)?.children ?? [])
    .map((c) => harita.get(c))
    .filter((d): d is GoalNode => Boolean(d));
}

/** Kanit yalnizca llm-inference ise deger DOGRULANMAMIS demektir. */
export function dogrulanmisMi(dugum: GoalNode): boolean {
  return dugum.evidence.some((e) => e.source !== "llm-inference");
}
