"use client";

export interface Aksiyon {
  id: string;
  title: string;
  tool: string;
  risk: "low" | "medium" | "high";
  reversible: boolean;
  requiresApproval: boolean;
  dryRunSupported: boolean;
  expectedOutcome: string;
}

export interface Plan {
  id: string;
  agent: string;
  title: string;
  rationale: string;
  goalNodeIds: string[];
  impact: number;
  effort: number;
  confidence: number;
  timeframe: string;
  kpi: string;
  actions: Aksiyon[];
  /** Görünüm için ek alanlar. */
  ajanAd: string;
  renk: string;
  skor: number;
  uyari: string;
}

const RISK_ETIKET: Record<string, string> = {
  low: "düşük risk", medium: "orta risk", high: "yüksek risk",
};

/** 1-5 arasi degeri nokta dizisiyle gosterir; sayidan hizli okunuyor. */
function Olcek({ deger, ters }: { deger: number; ters?: boolean }) {
  return (
    <span className="olcek">
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= deger ? (ters ? "dolu ters" : "dolu") : ""} />
      ))}
    </span>
  );
}

export function Planlar({ planlar }: { planlar: Plan[] }) {
  if (!planlar.length) return null;

  // Skor koddan geliyor; burada yalnizca gosteriyoruz.
  const sirali = [...planlar].sort((a, b) => b.skor - a.skor);

  return (
    <div className="kart">
      <div className="bolum-baslik">Aksiyon planları</div>
      <p className="agac-aciklama">
        Ölçüm ve teşhisten türetildi. Sıralama <b>etki × güven ÷ çaba</b>
        {" "}formülüyle kodda hesaplanır; modelin verdiği bir sayı değildir.
      </p>

      {sirali.map((p) => (
        <div key={p.id} className="plan-kart" style={{ borderLeftColor: p.renk }}>
          <div className="plan-ust">
            <span className="plan-baslik">{p.title}</span>
            <span className="plan-skor" title="etki × güven ÷ çaba">{p.skor.toFixed(2)}</span>
          </div>
          {p.rationale && <div className="plan-aciklama">{p.rationale}</div>}

          <div className="plan-olcekler">
            <span><b>etki</b> <Olcek deger={p.impact} /></span>
            <span><b>çaba</b> <Olcek deger={p.effort} ters /></span>
            <span><b>güven</b> %{Math.round(p.confidence * 100)}</span>
            {p.timeframe && <span><b>süre</b> {p.timeframe}</span>}
            {p.kpi && <span><b>kpi</b> {p.kpi}</span>}
            <span className="plan-ajan">
              <i className="ajan-nokta" style={{ background: p.renk }} /> {p.ajanAd}
            </span>
          </div>

          {p.actions.length > 0 ? (
            <div className="plan-yurut">
              <div className="plan-aksiyon-baslik">
                {p.actions.length} uygulanabilir aksiyon
              </div>
              {p.actions.map((a) => (
                <div key={a.id} className="plan-aksiyon">
                  <code>{a.tool}</code> {a.title}
                  <span className={`risk r-${a.risk}`}>{RISK_ETIKET[a.risk]}</span>
                  {a.requiresApproval && <span className="onay-gerek">onay gerekir</span>}
                  {!a.reversible && <span className="geri-alinamaz">geri alınamaz</span>}
                </div>
              ))}
            </div>
          ) : p.uyari ? (
            <div className="plan-uyari">
              Uygulanabilir işaretlenmedi: {p.uyari}
            </div>
          ) : (
            <div className="plan-elle">Bu plan elle uygulanır; sistemde tanımlı bir işlemi yok.</div>
          )}
        </div>
      ))}
    </div>
  );
}
