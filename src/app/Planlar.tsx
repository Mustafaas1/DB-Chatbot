"use client";

export interface Plan {
  id: string;
  dugumId: string;
  ajanKod: string;
  ajanAd: string;
  renk: string;
  baslik: string;
  aciklama: string;
  etki: number;
  caba: number;
  guven: number;
  skor: number;
  islemKodu: string;
  yurutulebilir: boolean;
}

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
            <span className="plan-baslik">{p.baslik}</span>
            <span className="plan-skor" title="etki × güven ÷ çaba">{p.skor.toFixed(2)}</span>
          </div>
          {p.aciklama && <div className="plan-aciklama">{p.aciklama}</div>}

          <div className="plan-olcekler">
            <span><b>etki</b> <Olcek deger={p.etki} /></span>
            <span><b>çaba</b> <Olcek deger={p.caba} ters /></span>
            <span><b>güven</b> %{Math.round(p.guven * 100)}</span>
            <span className="plan-ajan">
              <i className="ajan-nokta" style={{ background: p.renk }} /> {p.ajanAd}
            </span>
          </div>

          {p.yurutulebilir ? (
            <div className="plan-yurut">
              Bu plan sistemde tanımlı bir işlemle uygulanabilir
              {" "}(<code>{p.islemKodu}</code>). İşlemler sekmesinden onaya sunun.
            </div>
          ) : (
            <div className="plan-elle">Bu plan elle uygulanır; sistemde tanımlı bir işlemi yok.</div>
          )}
        </div>
      ))}
    </div>
  );
}
