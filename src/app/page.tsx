"use client";

import { useState, useEffect } from "react";
import type { Diagnosis } from "@/core/pipeline/teshis";
import { HedefAgaci, type AgacYaniti } from "./HedefAgaci";
import {
  AjanSekmeleri, type CalisanOlcum, type OlcumHatasi, type OlcumSonucu,
} from "./AjanSekmeleri";
import { Islemler } from "./Islemler";
import { Planlar, type Plan } from "./Planlar";
import { DogrudanCevap } from "./DogrudanCevap";
import { NedenAnalizi } from "./NedenAnalizi";
import { VarlikKarti } from "./VarlikKarti";
import type { StreamEvent, ResumeInfo } from "@/core/pipeline/olaylar";
import type { ListSummary } from "@/core/pipeline/ozet";
import type { CauseAnalysis } from "@/core/pipeline/nedenAnaliziCalistir";
import type { EntityInsight } from "@/core/pipeline/varlikCalistir";
import type { BudgetState } from "@/core/butce/butce";

const AI_ADIMLARI = [
  { metin: "Soru analiz ediliyor…", simge: "🧠" },
  { metin: "Veritabanı yapısı inceleniyor…", simge: "🔍" },
  { metin: "Hedef ağacı kuruluyor…", simge: "🌳" },
  { metin: "Ölçümler ajanlara dağıtılıyor…", simge: "📊" },
  { metin: "Rapor hazırlanıyor…", simge: "📝" },
];

type Sekme = "ajanlar" | "agac" | "islemler";

export default function Sayfa() {
  const [soru, setSoru] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);
  const [durum, setDurum] = useState("");
  const [agac, setAgac] = useState<AgacYaniti | null>(null);
  const [sonuclar, setSonuclar] = useState<OlcumSonucu[]>([]);
  const [calisanlar, setCalisanlar] = useState<CalisanOlcum[]>([]);
  const [hatalar, setHatalar] = useState<OlcumHatasi[]>([]);
  const [atlananlar, setAtlananlar] = useState<{ baslik: string; sebep: string }[]>([]);
  const [gecersizler, setGecersizler] = useState<{ baslik: string; soru: string; sebepler: string[] }[]>([]);
  const [niyet, setNiyet] = useState<{ metrik: string; zamanAraligi: string; segment: string; varlik: string; ortukHedef: string; tur: string } | null>(null);
  const [planlar, setPlanlar] = useState<Plan[]>([]);
  const [teshisler, setTeshisler] = useState<Diagnosis[]>([]);
  const [hata, setHata] = useState("");
  /** Kriter 1: kullanicinin literal sorusuna dogrudan cevap + kod ozeti. */
  const [dogrudan, setDogrudan] = useState<{
    sonuc: OlcumSonucu; ozet: ListSummary; kaynak: "kod" | "ajan";
    tablo: string | null; zamanAraligi: string; adaylar: string[];
  } | null>(null);
  /** Soruda adi gecen tek varlik: gercek karti + tavsiye. */
  const [varlik, setVarlik] = useState<{
    icgoru: EntityInsight; zamanAraligi: string;
  } | null>(null);
  /** Kriter 2: istenen kirilimin veride karsiligi yoksa acikca soyle. */
  const [eksikBoyut, setEksikBoyut] = useState<{ segment: string; sebep: string } | null>(null);
  /** Kriter 2: donem degisimi + turetilmis segment. */
  const [analiz, setAnaliz] = useState<CauseAnalysis | null>(null);
  /** Butce dolduysa: ne kadar harcandi ve devam icin ne gerekiyor. */
  const [butce, setButce] = useState<{
    durum: BudgetState;
    kalan: number;
    devam: ResumeInfo | null;
  } | null>(null);
  const [sekme, setSekme] = useState<Sekme>("ajanlar");

  async function sor(metin: string, devamGovdesi?: unknown) {
    const s = metin.trim();
    if (!s || calisiyor) return;
    setCalisiyor(true); setSoru(s); setHata(""); setButce(null);
    // Devam turunda birikmis sonuclar KORUNUR: kullanici zaten harcanmis
    // butceyle elde edilmis olcumleri kaybetmemeli.
    if (!devamGovdesi) {
      setAgac(null); setSonuclar([]); setCalisanlar([]); setHatalar([]);
      setAtlananlar([]); setGecersizler([]);
      setNiyet(null); setTeshisler([]); setPlanlar([]);
      setDogrudan(null); setEksikBoyut(null); setAnaliz(null); setVarlik(null);
    }
    setDurum("Hedef ağacı kuruluyor…"); setSekme("ajanlar");

    try {
      const r = await fetch("/api/akis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(devamGovdesi ? { soru: s, devam: devamGovdesi } : { soru: s }),
      });
      if (!r.ok || !r.body) { setHata("İstek başarısız."); return; }

      // SSE'yi elle ayristiriyoruz: EventSource yalnizca GET destekliyor,
      // soruyu govdede gondermek gerekiyor.
      const okuyucu = r.body.getReader();
      const cozucu = new TextDecoder();
      let tampon = "";

      for (;;) {
        const { done, value } = await okuyucu.read();
        if (done) break;
        tampon += cozucu.decode(value, { stream: true });

        const parcalar = tampon.split("\n\n");
        tampon = parcalar.pop() ?? "";
        for (const p of parcalar) {
          const satir = p.trim();
          if (!satir.startsWith("data:")) continue;
          isle(JSON.parse(satir.slice(5).trim()));
        }
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      setCalisiyor(false); setDurum("");
    }
  }

  function isle(k: StreamEvent) {
    switch (k.tur) {
      case "niyet":
        setNiyet(k.niyet);
        setDurum("Hedef ağacı kuruluyor…");
        break;
      case "teshis":
        setTeshisler((o) => [...o, k.teshis]);
        break;
      case "planlar":
        setPlanlar((o) => [...o, ...k.planlar]);
        break;
      case "agac":
        setAgac(k.agac);
        setDurum("Ölçümler ajanlara dağıtılıyor…");
        break;
      case "plan":
        setDurum(`${k.atamalar.length} ölçüm bulundu`);
        break;
      case "basladi":
        setCalisanlar((o) => [...o, k]);
        setDurum(`${k.ajanAd} çalışıyor…`);
        break;
      // "bitti" iki olayda da var: olcum sonucu olan ve akisin sonu.
      // `sonuc` alaninin varligi ikisini ayiriyor.
      case "bitti":
        if ("sonuc" in k) setSonuclar((o) => [...o, k.sonuc]);
        else setDurum("");
        break;
      // "hata" da iki bicimde: olcume ait olan `dugumId` tasiyor.
      case "hata":
        if ("dugumId" in k) setHatalar((o) => [...o, k]);
        else setHata(k.mesaj);
        break;
      case "atlandi":
        setAtlananlar((o) => [...o, { baslik: k.baslik, sebep: k.sebep }]);
        break;
      case "gecersiz":
        setGecersizler((o) => [...o, { baslik: k.baslik, soru: k.soru, sebepler: k.sebepler }]);
        break;
      case "butce":
        // Kendiliginden devam ETMIYORUZ; karar kullanicinin.
        setButce({ durum: k.durum, kalan: k.kalan, devam: k.devam });
        setDurum("");
        break;
      case "dogrudanCevap":
        setDogrudan({
          sonuc: k.sonuc, ozet: k.ozet, kaynak: k.kaynak,
          tablo: k.tablo, zamanAraligi: k.zamanAraligi, adaylar: k.adaylar,
        });
        break;
      case "varlik":
        setVarlik({ icgoru: k.icgoru, zamanAraligi: k.zamanAraligi });
        break;
      case "nedenAnalizi":
        setAnaliz(k.analiz);
        break;
      case "eksikBoyut":
        setEksikBoyut({ segment: k.segment, sebep: k.sebep });
        break;
      case "devam":
        setDurum(`${k.olculen} ölçüm atlandı; kalanlar çalışıyor…`);
        break;
    }
  }

  const birSeyVar = agac || sonuclar.length || calisanlar.length;

  return (
    <main className="sarmal">
      <header>
        <h1>İş Zekâsı Ajanı</h1>
        <p>
          Soru doğrudan cevaplanmaz: hedef ağacına çevrilir, dalları bölüm
          ajanlarına dağıtılır, her ajan kendi verisini sorgular.
        </p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); void sor(soru); }}>
        <input type="text" value={soru} placeholder="Örn: destek yükümüzü nasıl azaltırız?"
          onChange={(e) => setSoru(e.target.value)} disabled={calisiyor} />
        <button type="submit" disabled={calisiyor || !soru.trim()}>
          {calisiyor ? "Çalışıyor…" : "Sor"}
        </button>
      </form>

      {hata && <div className="kart hata">{hata}</div>}

      {/* Butce doldu: sistem KENDILIGINDEN devam etmez, kullaniciya sorar. */}
      {butce && (
        <div className="kart butce-uyari">
          <div className="bolum-baslik">Bütçe doldu</div>
          <p>
            {butce.durum.reason}{" "}
            {butce.kalan > 0
              ? `${butce.kalan} ölçüm yapılmadan durduruldu.`
              : "Ölçümler tamamlanmıştı."}
          </p>
          <div className="butce-olcum">
            <span><b>token</b> {butce.durum.tokens.toLocaleString("tr-TR")} / {butce.durum.tokenLimit.toLocaleString("tr-TR")}</span>
            <span><b>tur</b> {butce.durum.turns} / {butce.durum.turnLimit}</span>
          </div>
          {butce.devam && butce.kalan > 0 ? (
            <div className="butce-butonlar">
              <button
                disabled={calisiyor}
                onClick={() => {
                  const d = butce.devam!;
                  void sor(soru, {
                    ...d,
                    ekToken: butce.durum.tokenLimit * 2,
                    ekTur: butce.durum.turnLimit * 2,
                  });
                }}
              >Devam et ({butce.kalan} ölçüm)</button>
              <button className="ikincil" onClick={() => setButce(null)}>Burada bırak</button>
            </div>
          ) : (
            <div className="butce-butonlar">
              <button className="ikincil" onClick={() => setButce(null)}>Tamam</button>
            </div>
          )}
        </div>
      )}
      {calisiyor && durum && <AiDusunuyor durum={durum} />}

      <div className="sekmeler">
        <button type="button" className={sekme === "ajanlar" ? "aktif" : ""}
          onClick={() => setSekme("ajanlar")}>Ajanlar</button>
        <button type="button" className={sekme === "agac" ? "aktif" : ""}
          disabled={!agac} onClick={() => setSekme("agac")}>Hedef ağacı</button>
        <button type="button" className={sekme === "islemler" ? "aktif" : ""}
          onClick={() => setSekme("islemler")}>İşlemler</button>
      </div>

      {sekme === "islemler" && <Islemler />}

      {sekme === "agac" && agac && <HedefAgaci agac={agac} planlar={planlar} />}

      {sekme === "ajanlar" && (
        <>
          <AjanSekmeleri sonuclar={sonuclar} calisanlar={calisanlar} hatalar={hatalar} />

          {/* Varlik karti dogrudan cevabin USTUNDE: soru tek bir varlik
              hakkindaysa cevap odur, liste degil. */}
          {varlik && (
            <VarlikKarti icgoru={varlik.icgoru} zamanAraligi={varlik.zamanAraligi} />
          )}

          {dogrudan && (
            <DogrudanCevap
              sonuc={dogrudan.sonuc} ozet={dogrudan.ozet} kaynak={dogrudan.kaynak}
              tablo={dogrudan.tablo} zamanAraligi={dogrudan.zamanAraligi}
              adaylar={dogrudan.adaylar} soru={soru}
              eksikBoyut={analiz ? null : eksikBoyut}
            />
          )}
          {analiz && <NedenAnalizi analiz={analiz} eksikBoyut={eksikBoyut} />}
          <Planlar planlar={planlar} olcumler={sonuclar} />

          {teshisler.length > 0 && (
            <div className="kart">
              <div className="bolum-baslik">Teşhis — veri neden böyle</div>
              {teshisler.map((t) => (
                <div key={t.dugumId} className="teshis-satir">
                  <div className="teshis-baslik">{t.baslik}</div>
                  {t.findings.map((b, i) => (
                    <div key={i} className={`teshis-bulgu b-${b.tur}`}>{b.metin}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {gecersizler.length > 0 && (
            <div className="kart gecersiz-kart">
              <div className="bolum-baslik">Çalıştırılmayan ölçümler — veriyle uyumsuz</div>
              <p className="agac-aciklama">
                Hedef ağacı bu ölçümleri üretti ama veride karşılıkları yok.
                Çalıştırılmadılar; boş sonuç için kota harcanmadı.
              </p>
              {gecersizler.map((g, i) => (
                <div key={i} className="gecersiz-satir">
                  <div className="gecersiz-baslik">{g.baslik}</div>
                  <div className="olcum-soru">{g.soru}</div>
                  {g.sebepler.map((s, j) => <div key={j} className="gecersiz-sebep">{s}</div>)}
                </div>
              ))}
            </div>
          )}

          {atlananlar.length > 0 && (
            <div className="kart atlanan">
              <div className="bolum-baslik">Çalıştırılmayan ölçümler</div>
              {atlananlar.map((a, i) => (
                <div key={i} className="atlanan-satir">
                  {a.baslik} <span>— {a.sebep}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

/* ---------- Yapay zekâ "düşünüyor" bileşeni ---------- */
function AiDusunuyor({ durum }: { durum: string }) {
  const [adim, setAdim] = useState(0);

  useEffect(() => {
    // Gerçek durum mesajına göre adımı belirle
    const idx = AI_ADIMLARI.findIndex((a) => durum.includes(a.metin.replace("…", "")));
    if (idx >= 0) { setAdim(idx); return; }

    // Durum mesajı tanınmıyorsa, adım adım ilerle (başa sarmadan son adımda kal)
    const t = setInterval(() => setAdim((o) => Math.min(o + 1, AI_ADIMLARI.length - 1)), 3000);
    return () => clearInterval(t);
  }, [durum]);

  const mevcutAdim = AI_ADIMLARI[adim] ?? AI_ADIMLARI[0]!;

  return (
    <div className="ai-dusunuyor">
      <div className="ai-dusunuyor-ust">
        <div className="ai-nabiz">
          <span className="ai-nokta" />
          <span className="ai-nokta" />
          <span className="ai-nokta" />
        </div>
        <span className="ai-dusunuyor-metin">
          {mevcutAdim.simge} {durum || mevcutAdim.metin}
        </span>
      </div>
      <div className="ai-adimlar">
        {AI_ADIMLARI.map((a, i) => (
          <div key={i} className={`ai-adim ${i < adim ? "tamam" : i === adim ? "aktif" : ""}`}>
            <span className="ai-adim-simge">{i < adim ? "✓" : a.simge}</span>
            <span className="ai-adim-metin">{a.metin.replace("…", "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
