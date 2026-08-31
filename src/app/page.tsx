"use client";

import { useState } from "react";
import { HedefAgaci, type AgacYaniti } from "./HedefAgaci";
import {
  AjanSekmeleri, type CalisanOlcum, type OlcumHatasi, type OlcumSonucu,
} from "./AjanSekmeleri";
import { Islemler } from "./Islemler";
import { Planlar, type Plan } from "./Planlar";
import { GeriBesleme } from "./GeriBesleme";

const ORNEKLER = [
  "Destek yükümüzü nasıl azaltırız?",
  "Satış performansımızı nasıl artırırız?",
  "Proje teslimlerini nasıl hızlandırırız?",
];

type Sekme = "ajanlar" | "agac" | "islemler" | "geribesleme";

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
  const [niyet, setNiyet] = useState<{ metrik: string; zamanAraligi: string; segment: string; ortukHedef: string; tur: string } | null>(null);
  const [planlar, setPlanlar] = useState<Plan[]>([]);
  const [teshisler, setTeshisler] = useState<{ dugumId: string; baslik: string; bulgular: { tur: string; metin: string }[] }[]>([]);
  const [hata, setHata] = useState("");
  const [sekme, setSekme] = useState<Sekme>("ajanlar");

  async function sor(metin: string) {
    const s = metin.trim();
    if (!s || calisiyor) return;
    setCalisiyor(true); setSoru(s); setHata("");
    setAgac(null); setSonuclar([]); setCalisanlar([]); setHatalar([]); setAtlananlar([]); setGecersizler([]);
    setNiyet(null); setTeshisler([]); setPlanlar([]);
    setDurum("Hedef ağacı kuruluyor…"); setSekme("ajanlar");

    try {
      const r = await fetch("/api/akis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soru: s }),
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

  function isle(k: any) {
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
      case "bitti":
        if (k.sonuc) setSonuclar((o) => [...o, k.sonuc]);
        else setDurum("");
        break;
      case "hata":
        if (k.dugumId) setHatalar((o) => [...o, k]);
        else setHata(k.mesaj);
        break;
      case "atlandi":
        setAtlananlar((o) => [...o, { baslik: k.baslik, sebep: k.sebep }]);
        break;
      case "gecersiz":
        setGecersizler((o) => [...o, { baslik: k.baslik, soru: k.soru, sebepler: k.sebepler }]);
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

      <div className="ornekler">
        {ORNEKLER.map((o) => (
          <button key={o} type="button" disabled={calisiyor} onClick={() => void sor(o)}>{o}</button>
        ))}
      </div>

      {niyet && (
        <div className="kart niyet-kart">
          <div className="bolum-baslik">Anlaşılan hedef</div>
          <div className="niyet-hedef">{niyet.ortukHedef}</div>
          <div className="niyet-alanlar">
            {niyet.metrik && <span><b>metrik</b> {niyet.metrik}</span>}
            {niyet.zamanAraligi && <span><b>zaman</b> {niyet.zamanAraligi}</span>}
            {niyet.segment && <span><b>kırılım</b> {niyet.segment}</span>}
          </div>
        </div>
      )}

      {hata && <div className="kart hata">{hata}</div>}
      {calisiyor && durum && <div className="kart bekliyor">{durum}</div>}

      <div className="sekmeler">
        <button type="button" className={sekme === "ajanlar" ? "aktif" : ""}
          onClick={() => setSekme("ajanlar")}>Ajanlar</button>
        <button type="button" className={sekme === "agac" ? "aktif" : ""}
          disabled={!agac} onClick={() => setSekme("agac")}>Hedef ağacı</button>
        <button type="button" className={sekme === "islemler" ? "aktif" : ""}
          onClick={() => setSekme("islemler")}>İşlemler</button>
        <button type="button" className={sekme === "geribesleme" ? "aktif" : ""}
          onClick={() => setSekme("geribesleme")}>Geri besleme</button>
      </div>

      {sekme === "islemler" && <Islemler />}

      {sekme === "geribesleme" && <GeriBesleme />}

      {sekme === "agac" && agac && <HedefAgaci agac={agac} />}

      {sekme === "ajanlar" && (
        <>
          <AjanSekmeleri sonuclar={sonuclar} calisanlar={calisanlar} hatalar={hatalar} />

          <Planlar planlar={planlar} />

          {teshisler.length > 0 && (
            <div className="kart">
              <div className="bolum-baslik">Teşhis — veri neden böyle</div>
              {teshisler.map((t) => (
                <div key={t.dugumId} className="teshis-satir">
                  <div className="teshis-baslik">{t.baslik}</div>
                  {t.bulgular.map((b, i) => (
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
