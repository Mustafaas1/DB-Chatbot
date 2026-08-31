"use client";

import { useState } from "react";
import { HedefAgaci, type AgacYaniti } from "./HedefAgaci";
import {
  AjanSekmeleri, type CalisanOlcum, type OlcumHatasi, type OlcumSonucu,
} from "./AjanSekmeleri";
import { Islemler } from "./Islemler";

const ORNEKLER = [
  "Destek yükümüzü nasıl azaltırız?",
  "Satış performansımızı nasıl artırırız?",
  "Proje teslimlerini nasıl hızlandırırız?",
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
  const [hata, setHata] = useState("");
  const [sekme, setSekme] = useState<Sekme>("ajanlar");

  async function sor(metin: string) {
    const s = metin.trim();
    if (!s || calisiyor) return;
    setCalisiyor(true); setSoru(s); setHata("");
    setAgac(null); setSonuclar([]); setCalisanlar([]); setHatalar([]); setAtlananlar([]);
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

      {hata && <div className="kart hata">{hata}</div>}
      {calisiyor && durum && <div className="kart bekliyor">{durum}</div>}

      <div className="sekmeler">
        <button type="button" className={sekme === "ajanlar" ? "aktif" : ""}
          onClick={() => setSekme("ajanlar")}>Ajanlar</button>
        <button type="button" className={sekme === "agac" ? "aktif" : ""}
          disabled={!agac} onClick={() => setSekme("agac")}>Hedef ağacı</button>
        <button type="button" className={sekme === "islemler" ? "aktif" : ""}
          onClick={() => setSekme("islemler")}>İşlemler</button>
      </div>

      {sekme === "islemler" && <Islemler />}

      {sekme === "agac" && agac && <HedefAgaci agac={agac} />}

      {sekme === "ajanlar" && (
        <>
          <AjanSekmeleri sonuclar={sonuclar} calisanlar={calisanlar} hatalar={hatalar} />
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
