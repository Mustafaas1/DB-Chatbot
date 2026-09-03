"use client";

import { useEffect, useState } from "react";
import type { OlcumSonucu } from "./AjanSekmeleri";
import type { DenetimKaydi } from "@/core/yaz/tipler";

export interface Aksiyon {
  id: string;
  title: string;
  tool: string;
  params: Record<string, unknown>;
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

interface Prova {
  ozet: string;
  etkilenen: number;
  uyarilar: string[];
  degisiklikler: { kimlik: string; kolon: string; onceki: unknown; sonraki: unknown }[];
}

interface Oneri {
  kayitId: string;
  islemAdi: string;
  hedefTablo: string;
  prova: Prova;
  onaylanabilir: boolean;
  yalnizcaProva: boolean;
}

type AdimDurumu = "calisiyor" | "ok" | "hata" | "atlandi";

interface Adim {
  metin: string;
  durum: AdimDurumu;
  an: string;
  ayrinti?: string;
}

interface Oturum {
  plan: Plan;
  /** "simule": yalnizca prova. "uygula": prova + onay + yazma. */
  mod: "simule" | "uygula";
  adimlar: Adim[];
  oneriler: (Oneri | null)[];
  /** Onay verildi mi; verilmeden yazma cagrisi yapilmaz. */
  onaylandi: boolean;
  bitti: boolean;
  hata: string;
}

const RISK_ETIKET: Record<string, string> = {
  low: "düşük risk", medium: "orta risk", high: "yüksek risk",
};

function saat(): string {
  return new Date().toLocaleTimeString("tr-TR", { hour12: false });
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

/** Cagiran taraf donen bicimi belirtir; her uc farkli sey donuyor. */
async function istek<T>(govde: unknown): Promise<T> {
  const r = await fetch("/api/islem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  const veri = (await r.json()) as T & { hata?: string };
  if (!r.ok) throw new Error(veri.hata ?? "İstek başarısız.");
  return veri;
}

export function Planlar({
  planlar, olcumler = [],
}: { planlar: Plan[]; olcumler?: OlcumSonucu[] }) {
  const [acik, setAcik] = useState<Record<string, boolean>>({});
  const [redAcik, setRedAcik] = useState<string | null>(null);
  const [redSebep, setRedSebep] = useState("");
  const [reddedilen, setReddedilen] = useState<Record<string, string>>({});
  const [oturum, setOturum] = useState<Oturum | null>(null);
  const [onaylayan, setOnaylayan] = useState("");
  const [mesgul, setMesgul] = useState(false);

  // Sekme degisince bu bilesen sokuluyor ve yerel durum sifirlaniyor.
  // Red sunucuda kayitli; isareti oradan geri okuyoruz.
  useEffect(() => {
    let iptal = false;
    void (async () => {
      try {
        const r = await fetch("/api/plan");
        if (!r.ok || iptal) return;
        const { redler } = (await r.json()) as {
          redler: { ajan: string; planBasligi: string; sebep: string }[];
        };
        const eslesme: Record<string, string> = {};
        for (const p of planlar) {
          const red = redler.find((x) => x.ajan === p.agent && x.planBasligi === p.title);
          if (red) eslesme[p.id] = red.sebep;
        }
        if (Object.keys(eslesme).length) setReddedilen((o) => ({ ...eslesme, ...o }));
      } catch { /* red gecmisi yoksa kart normal gorunur */ }
    })();
    return () => { iptal = true; };
  }, [planlar]);

  if (!planlar.length) return null;

  // Skor koddan geliyor; burada yalnizca gosteriyoruz.
  const sirali = [...planlar].sort((a, b) => b.skor - a.skor);

  /**
   * Planin dogdugu olcumler. F6 geri beslemesi bunlari uygulamadan once
   * ve sonra yeniden calistirip etkiyi olcuyor; verilmezse etki raporu
   * "olcum baglami bulunamadi" der.
   *
   * Kaynak CALISTIRILMIS olcum sonuclari; agac dugumu DEGIL. Dugumdeki
   * measurementQuery dogal dilde bir soru, SQL degil: onu gonderdigimizde
   * "once" goruntusu sessizce alinamiyordu.
   */
  function olcumBaglamlari(p: Plan) {
    return p.goalNodeIds
      .map((id) => olcumler.find((o) => o.dugumId === id))
      .filter((o): o is OlcumSonucu => Boolean(o?.sql))
      .map((o) => ({
        dugumId: o.dugumId,
        ajanKod: o.ajanKod,
        soru: o.baslik,
        sql: o.sql,
        tablolar: [] as string[], // sunucu ajan tanimindan dolduruyor
      }));
  }

  function yeniAdim(metin: string) {
    setOturum((o) => o && {
      ...o, adimlar: [...o.adimlar, { metin, durum: "calisiyor" as AdimDurumu, an: saat() }],
    });
  }

  /** Son adimin durumunu gunceller; her cagri icin yeni satir acmiyoruz. */
  function sonAdim(durum: AdimDurumu, ayrinti?: string) {
    setOturum((o) => {
      if (!o) return o;
      const adimlar = [...o.adimlar];
      const son = adimlar.length - 1;
      const onceki = adimlar[son];
      if (onceki) {
        adimlar[son] = ayrinti === undefined
          ? { ...onceki, durum }
          : { ...onceki, durum, ayrinti };
      }
      return { ...o, adimlar };
    });
  }

  /** Prova asamasi: HICBIR SEY DEGISTIRMEZ. Iki mod da bundan baslar. */
  async function baslat(plan: Plan, mod: "simule" | "uygula") {
    const baglamlar = olcumBaglamlari(plan);
    setOturum({
      plan, mod, adimlar: [], oneriler: [], onaylandi: false, bitti: false, hata: "",
    });
    setMesgul(true);

    const oneriler: (Oneri | null)[] = [];
    try {
      for (const a of plan.actions) {
        yeniAdim(`Prova: ${a.title}`);
        const o = await istek<Oneri>({
          eylem: "oner", islemKodu: a.tool, parametreler: a.params,
          olcumBaglamlari: baglamlar,
        });
        oneriler.push(o);
        sonAdim(o.prova.etkilenen > 0 ? "ok" : "atlandi", o.prova.ozet);
      }
      setOturum((s) => s && { ...s, oneriler, bitti: mod === "simule" });
    } catch (e) {
      sonAdim("hata", e instanceof Error ? e.message : String(e));
      setOturum((s) => s && { ...s, oneriler, bitti: true, hata: "Prova başarısız." });
    } finally {
      setMesgul(false);
    }
  }

  /** Yazma asamasi. Yalnizca insan onayindan SONRA cagrilir. */
  async function uygulaHepsi() {
    if (!oturum || !onaylayan.trim()) return;
    setMesgul(true);
    setOturum((s) => s && { ...s, onaylandi: true });
    try {
      for (let i = 0; i < oturum.oneriler.length; i++) {
        const o = oturum.oneriler[i];
        const a = oturum.plan.actions[i];
        if (!o || !a) continue;
        if (!o.onaylanabilir || o.yalnizcaProva) {
          yeniAdim(`Atlandı: ${a.title}`);
          sonAdim("atlandi", o.yalnizcaProva
            ? "Yazma yapılandırılmamış; yalnızca prova görülebilir."
            : "Prova hiçbir kaydı etkilemiyor.");
          continue;
        }
        yeniAdim(`Uygulanıyor: ${a.title}`);
        const kayit = await istek<DenetimKaydi>({
          eylem: "uygula", kayitId: o.kayitId, onaylayan,
        });
        sonAdim("ok", `${kayit.prova?.etkilenen ?? 0} kayıt · denetim ${String(kayit.id ?? "").slice(0, 8)}`);
      }
      setOturum((s) => s && { ...s, bitti: true });
    } catch (e) {
      sonAdim("hata", e instanceof Error ? e.message : String(e));
      setOturum((s) => s && { ...s, bitti: true, hata: "Uygulama yarıda kesildi." });
    } finally {
      setMesgul(false);
    }
  }

  async function reddet(plan: Plan) {
    const sebep = redSebep.trim();
    if (!sebep) return;
    setMesgul(true);
    try {
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ajan: plan.agent, planBasligi: plan.title, sebep,
          reddeden: onaylayan || "arayuz",
        }),
      });
      if (r.ok) {
        setReddedilen((o) => ({ ...o, [plan.id]: sebep }));
        setRedAcik(null); setRedSebep("");
      }
    } finally {
      setMesgul(false);
    }
  }

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

          {acik[p.id] && (
            <div className="plan-detay">
              <div className="plan-detay-baslik">Ne çalıştırılacak</div>
              {p.actions.length === 0 ? (
                <div className="plan-detay-bos">Bu planın çalıştırılabilir bir işlemi yok.</div>
              ) : p.actions.map((a) => (
                <div key={a.id} className="plan-detay-satir">
                  <div><b>araç</b> <code>{a.tool}</code></div>
                  <div><b>parametre</b> <code>{JSON.stringify(a.params)}</code></div>
                  <div><b>beklenen</b> {a.expectedOutcome}</div>
                  <div>
                    <b>geri alınabilir</b> {a.reversible ? "evet" : "hayır"}
                    {" · "}<b>prova</b> {a.dryRunSupported ? "var" : "yok"}
                  </div>
                </div>
              ))}

              <div className="plan-detay-baslik">Bağlı ölçümler</div>
              {olcumBaglamlari(p).length === 0 ? (
                <div className="plan-detay-bos">
                  Çalıştırılmış ölçüm bağlanmadı; uygulandıktan sonra etki raporu üretilemez.
                </div>
              ) : olcumBaglamlari(p).map((b) => (
                <div key={b.dugumId} className="plan-detay-olcum">{b.soru}</div>
              ))}
            </div>
          )}

          {reddedilen[p.id] ? (
            <div className="plan-reddedildi">
              Reddedildi: {reddedilen[p.id]}
              <span className="plan-red-not">
                Bu gerekçe kaydedildi; aynı ajan sonraki turda görecek.
              </span>
            </div>
          ) : redAcik === p.id ? (
            <form
              className="plan-red-form"
              onSubmit={(e) => { e.preventDefault(); void reddet(p); }}
            >
              <input
                autoFocus
                placeholder="Neden reddediyorsunuz? (ajana bağlam olarak verilecek)"
                value={redSebep}
                onChange={(e) => setRedSebep(e.target.value)}
              />
              <button type="submit" disabled={mesgul || !redSebep.trim()}>Kaydet</button>
              <button
                type="button"
                className="ikincil"
                onClick={() => { setRedAcik(null); setRedSebep(""); }}
              >Vazgeç</button>
            </form>
          ) : (
            <div className="plan-butonlar">
              <button
                className="ikincil"
                disabled={mesgul || !p.actions.length}
                title={p.actions.length ? "Hiçbir şey değiştirmeden provayı çalıştırır" : "Çalıştırılabilir işlem yok"}
                onClick={() => void baslat(p, "simule")}
              >Simüle Et</button>
              <button
                disabled={mesgul || !p.actions.length}
                title={p.actions.length ? "Prova → onay → uygulama" : "Çalıştırılabilir işlem yok"}
                onClick={() => void baslat(p, "uygula")}
              >Uygula</button>
              <button className="ikincil" onClick={() => setAcik((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                {acik[p.id] ? "Gizle" : "Detaylandır"}
              </button>
              <button className="ikincil" onClick={() => setRedAcik(p.id)}>Reddet</button>
            </div>
          )}
        </div>
      ))}

      {oturum && (
        <OnayModali
          oturum={oturum}
          onaylayan={onaylayan}
          setOnaylayan={setOnaylayan}
          mesgul={mesgul}
          onUygula={() => void uygulaHepsi()}
          onKapat={() => setOturum(null)}
        />
      )}
    </div>
  );
}

function OnayModali({
  oturum, onaylayan, setOnaylayan, mesgul, onUygula, onKapat,
}: {
  oturum: Oturum;
  onaylayan: string;
  setOnaylayan: (s: string) => void;
  mesgul: boolean;
  onUygula: () => void;
  onKapat: () => void;
}) {
  const { plan, mod, adimlar, oneriler, onaylandi, bitti, hata } = oturum;
  const provalarHazir = oneriler.length === plan.actions.length && oneriler.length > 0;
  const uygulanabilir = provalarHazir && oneriler.some((o) => o?.onaylanabilir && !o.yalnizcaProva);
  const toplamEtki = oneriler.reduce((t, o) => t + (o?.prova.etkilenen ?? 0), 0);

  return (
    <div
      className="modal-arka"
      onClick={(e) => { if (e.target === e.currentTarget && !mesgul) onKapat(); }}
    >
      <div className="modal">
        <div className="modal-ust">
          <span>{mod === "simule" ? "Simülasyon" : "Uygulama onayı"}</span>
          <button className="modal-kapat" disabled={mesgul} onClick={onKapat}>×</button>
        </div>
        <div className="modal-plan">{plan.title}</div>

        {/* NE yapilacak: arac, parametre, geri alinabilirlik. */}
        <div className="modal-baslik">Ne yapılacak</div>
        <table className="modal-tablo">
          <tbody>
            {plan.actions.map((a, i) => (
              <tr key={a.id}>
                <td><code>{a.tool}</code></td>
                <td><code className="modal-param">{JSON.stringify(a.params)}</code></td>
                <td>{a.reversible ? "geri alınabilir" : "geri ALINAMAZ"}</td>
                <td className="modal-etki">
                  {oneriler[i] ? `${oneriler[i]?.prova.etkilenen} kayıt` : "…"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {provalarHazir && oneriler.map((o, i) => o && o.prova.uyarilar.length > 0 && (
          <div key={i} className="modal-uyarilar">
            {o.prova.uyarilar.map((u, j) => <div key={j} className="prova-uyari">{u}</div>)}
          </div>
        ))}

        {/* Adim adim yurutme zaman cizelgesi. */}
        <div className="modal-baslik">Yürütme</div>
        <ul className="zaman-cizelgesi">
          {adimlar.map((a, i) => (
            <li key={i} className={`zc-${a.durum}`}>
              <span className="zc-an">{a.an}</span>
              <span className="zc-metin">{a.metin}</span>
              {a.ayrinti && <span className="zc-ayrinti">{a.ayrinti}</span>}
            </li>
          ))}
          {!adimlar.length && (
            <li className="zc-calisiyor"><span className="zc-metin">Başlıyor…</span></li>
          )}
        </ul>

        {mod === "uygula" && provalarHazir && !onaylandi && (
          <div className="modal-onay">
            <label>
              Onaylayan
              <input
                value={onaylayan}
                onChange={(e) => setOnaylayan(e.target.value)}
                placeholder="adınız"
              />
            </label>
            <button
              className="tehlike"
              disabled={mesgul || !onaylayan.trim() || !uygulanabilir}
              onClick={onUygula}
            >
              {toplamEtki} kaydı değiştir
            </button>
            <button className="ikincil" disabled={mesgul} onClick={onKapat}>Vazgeç</button>
            {!uygulanabilir && (
              <div className="modal-not">
                Uygulanabilir işlem yok: prova hiçbir kaydı etkilemiyor ya da yazma kapalı.
              </div>
            )}
          </div>
        )}

        {/* Sonuc raporu. */}
        {bitti && (
          <div className={`modal-sonuc ${hata ? "basarisiz" : ""}`}>
            {hata ? hata : mod === "simule"
              ? `Simülasyon tamam: ${toplamEtki} kayıt etkilenirdi. Hiçbir şey değişmedi.`
              : "Uygulandı."}
            <button className="ikincil" onClick={onKapat}>Kapat</button>
          </div>
        )}
      </div>
    </div>
  );
}
