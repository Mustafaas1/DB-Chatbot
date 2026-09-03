/**
 * Soru basina token ve tur butcesi.
 *
 * Groq ucretsiz katmani gunde 200.000 token veriyor. Tek bir soru,
 * dallanan bir hedef agaciyla bu kotanin buyuk kismini sessizce
 * yiyebiliyor. Butce asildiginda calisma DURUR ve kullaniciya
 * "devam edeyim mi" diye sorulur -- kendiliginden devam etmez.
 *
 * Limitler ortam degiskeniyle ayarlanir; verilmezse muhafazakar
 * varsayilanlar kullanilir.
 */

export const DEFAULT_TOKEN_LIMIT = 60_000;
export const DEFAULT_TURN_LIMIT = 24;

export interface BudgetState {
  tokens: number;
  tokenLimit: number;
  turns: number;
  turnLimit: number;
  exceeded: boolean;
  /** Hangi limitin asildigi; asilmadiysa null. */
  reason: string | null;
}

function readNumber(ham: string | undefined, fallback: number): number {
  const n = Number(ham);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export class Budget {
  private tokens = 0;
  private turns = 0;

  constructor(
    private readonly tokenLimit: number = readNumber(process.env.BUTCE_TOKEN, DEFAULT_TOKEN_LIMIT),
    private readonly turnLimit: number = readNumber(process.env.BUTCE_TUR, DEFAULT_TURN_LIMIT)
  ) {}

  /**
   * Harcamayi kaydeder.
   *
   * Once harcayip sonra kontrol ediyoruz: cagri zaten yapildi, tokeni
   * saymamak butceyi yalanci kilardi.
   */
  spend(usage: { girdiTokeni?: number; ciktiTokeni?: number; cagriSayisi?: number }): void {
    this.tokens += (usage.girdiTokeni ?? 0) + (usage.ciktiTokeni ?? 0);
    this.turns += usage.cagriSayisi ?? 1;
  }

  state(): BudgetState {
    const tokenExceeded = this.tokens >= this.tokenLimit;
    const turnExceeded = this.turns >= this.turnLimit;
    return {
      tokens: this.tokens,
      tokenLimit: this.tokenLimit,
      turns: this.turns,
      turnLimit: this.turnLimit,
      exceeded: tokenExceeded || turnExceeded,
      reason: tokenExceeded
        ? `Token butcesi doldu (${this.tokens} / ${this.tokenLimit}).`
        : turnExceeded
          ? `Ajan turu butcesi doldu (${this.turns} / ${this.turnLimit}).`
          : null,
    };
  }

  isExceeded(): boolean {
    return this.state().exceeded;
  }
}
