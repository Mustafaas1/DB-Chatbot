"use client";

import { useState } from "react";

interface Adim { ad: string; sorgu: string; ok: boolean; sureMs: number; }
interface Tablo { kolonlar: string[]; satirlar: unknown[][]; }
interface Yanit {
  cevap: string;
  tablo: Tablo | null;
  adimlar: Adim[];
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
  tamamlandi: boolean;
}

const ORNEKLER = [
  "Aşamalarına göre açık destek biletleri",
  "Durumlarına göre teklif sayısı",
  "En çok bilet atanan 10 kişi",
  "Para birimine göre teklif tutarı",
];

/** Sayisal kolon: tum hucreleri sayi olan kolon saga yaslanir. */
function sayisalKolonlar(t: Tablo): boolean[] {
  return t.kolonlar.map((_, n) =>
    t.satirlar.length > 0 && t.satirlar.every((s) => typeof s[n] === "number")
  );
}

/** **kalin** isaretlerini gercek kalin yaziya cevirir. */
function kalinla(metin: string) {
  return metin.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

export default function Sayfa() {
  const [soru, setSoru] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const [yanit, setYanit] = useState<Yanit | null>(null);
  const [hata, setHata] = useState("");

  async function sor(metin: string) {
    const s = metin.trim();
    if (!s || bekliyor) return;
    setBekliyor(true); setHata(""); setYanit(null); setSoru(s);
    try {
      const r = await fetch("/api/sor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soru: s }),
      });
      const g = await r.json();
      if (!r.ok) setHata(g.hata ?? "İstek başarısız."); else setYanit(g);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      setBekliyor(false);
    }
  }

  const sayisal = yanit?.tablo ? sayisalKolonlar(yanit.tablo) : [];

  return (
    <main className="sarmal">
      <header>
        <h1>İş Zekâsı Ajanı</h1>
        <p>Sorunuzu gündelik Türkçe yazın; SQL bilmeniz gerekmiyor.</p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); void sor(soru); }}>
        <input
          type="text" value={soru} placeholder="Örn: aşamalarına göre açık destek biletleri"
          onChange={(e) => setSoru(e.target.value)} disabled={bekliyor}
        />
        <button type="submit" disabled={bekliyor || !soru.trim()}>
          {bekliyor ? "Çalışıyor…" : "Sor"}
        </button>
      </form>

      <div className="ornekler">
        {ORNEKLER.map((o) => (
          <button key={o} type="button" disabled={bekliyor} onClick={() => void sor(o)}>{o}</button>
        ))}
      </div>

      {bekliyor && <div className="kart bekliyor">Ajan çalışıyor, sorgu hazırlanıyor…</div>}
      {hata && <div className="kart hata">{hata}</div>}

      {yanit && (
        <>
          <div className="kart">
            <div className="cevap">{kalinla(yanit.cevap)}</div>
          </div>

          {yanit.tablo && yanit.tablo.satirlar.length > 0 && (
            <div className="kart">
              <div className="bolum-baslik">Veri</div>
              <div className="tablo-sarici">
                <table>
                  <thead>
                    <tr>{yanit.tablo.kolonlar.map((k, n) => (
                      <th key={k + n} className={sayisal[n] ? "sayi" : undefined}>{k}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {yanit.tablo.satirlar.map((s, i) => (
                      <tr key={i}>{s.map((h, n) => (
                        <td key={n} className={sayisal[n] ? "sayi" : undefined}>
                          {h === null || h === undefined ? "—" : String(h)}
                        </td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {yanit.adimlar.length > 0 && (
            <div className="kart">
              <div className="bolum-baslik">Çalıştırılan sorgu</div>
              {yanit.adimlar.map((a, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <pre className="sql">{a.sorgu || "(sorgu yok)"}</pre>
                  <div className="alt-bilgi">{a.ok ? "başarılı" : "hata"} · {a.sureMs} ms</div>
                </div>
              ))}
              <div className="alt-bilgi">
                {yanit.kullanim.girdiTokeni} girdi + {yanit.kullanim.ciktiTokeni} çıktı token
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
