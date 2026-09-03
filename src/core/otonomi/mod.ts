/**
 * Otonomi sinirlari.
 *
 * Uc mod:
 *   manual   - her sey insan onayi ister
 *   assisted - yalnizca low riskli aksiyonlar kendiliginden calisir (VARSAYILAN)
 *   auto     - low + medium kendiliginden calisir
 *
 * MODDAN BAGIMSIZ, ASILMAYAN kural: risk=high ya da reversible=false olan
 * hicbir aksiyon onaysiz calismaz. "auto" bile bunu acamaz. Bu yuzden
 * kontrol modu okumadan ONCE yapiliyor -- yeni bir mod eklendiginde
 * kuralin disinda kalmasi mumkun olmasin.
 *
 * NOT (isimlendirme): tanimlayicilar Ingilizce; mod degerleri
 * ("manual"/"assisted"/"auto") .env'den okunuyor ve "otomatik:" oneki
 * denetim kaydinin `onaylayan` kolonunda SAKLI -- ikisi de degismedi.
 */

export const AUTONOMY_MODES = ["manual", "assisted", "auto"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const DEFAULT_MODE: AutonomyMode = "assisted";

/** Modun kendiliginden calistirabilecegi risk seviyeleri. */
const ALLOWED_RISKS: Record<AutonomyMode, readonly string[]> = {
  manual: [],
  assisted: ["low"],
  auto: ["low", "medium"],
};

/**
 * Denetim kaydinda otonomi kararini isaretleyen onek.
 *
 * DEGISTIRILEMEZ: mevcut denetim satirlarinin `onaylayan` kolonunda bu
 * degerle yazilmis kayitlar var; degisirse gecmis kayitlar insan onayli
 * gorunur.
 */
const AUTO_APPROVER_PREFIX = "otomatik:";

export interface AutonomyDecision {
  /** Insan onayi olmadan calistirilabilir mi. */
  automatic: boolean;
  /** Kararin gerekcesi; denetim kaydina ve arayuze yaziliyor. */
  reason: string;
}

/** Karara konu olan aksiyonun degerlendirilen ozellikleri. */
export interface ActionSummary {
  risk: "low" | "medium" | "high";
  reversible: boolean;
}

export function readMode(raw: string | undefined | null): AutonomyMode {
  const m = (raw ?? "").trim().toLowerCase();
  return (AUTONOMY_MODES as readonly string[]).includes(m)
    ? (m as AutonomyMode)
    : DEFAULT_MODE;
}

/** Yapilandirilmis mod. Taninmayan deger sessizce varsayilana duser. */
export function currentMode(): AutonomyMode {
  return readMode(process.env.OTONOMI_MODU);
}

/**
 * Bu aksiyon verilen modda onaysiz calisabilir mi?
 *
 * Cagiran taraf `automatic: false` gordugunde insan onayi ISTEMEK
 * zorundadir; sebebi kullaniciya gostermek icin donuyor.
 */
export function canRunAutomatically(
  a: ActionSummary,
  mode: AutonomyMode = currentMode()
): AutonomyDecision {
  // Once mutlak kural, sonra mod. Sirasi onemli.
  if (!a.reversible) {
    return { automatic: false, reason: "Aksiyon geri alinamiyor; her modda onay gerekir." };
  }
  if (a.risk === "high") {
    return { automatic: false, reason: "Risk yuksek; her modda onay gerekir." };
  }

  if (ALLOWED_RISKS[mode].includes(a.risk)) {
    return { automatic: true, reason: `Otonomi modu "${mode}" bu riski (${a.risk}) kapsiyor.` };
  }
  return {
    automatic: false,
    reason: mode === "manual"
      ? 'Otonomi modu "manual"; her aksiyon onay ister.'
      : `Otonomi modu "${mode}" ${a.risk} riski kapsamiyor.`,
  };
}

/** Denetim kaydina yazilacak onaylayan etiketi. */
export function autoApprover(mode: AutonomyMode): string {
  return `${AUTO_APPROVER_PREFIX}${mode}`;
}

/** Bu onaylayan bir insan mi, yoksa otonomi mi? */
export function isAutomatic(approver: string | null): boolean {
  return Boolean(approver?.startsWith(AUTO_APPROVER_PREFIX));
}
