"use client";

import { useState } from "react";

export interface OlcumSonucu {
  dugumId: string;
  ajanKod: string;
  ajanAd: string;
  renk: string;
  baslik: string;
  soru: string;
  cevap: string;
  sql: string;
  kolonlar: string[];
  satirlar: unknown[][];
  bosMu: boolean;
  sureMs: number;
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
}

export interface CalisanOlcum {
  dugumId: string;
  ajanKod: string;
  ajanAd: string;
  renk: string;
  baslik: string;
}

export interface OlcumHatasi {
  dugumId: string;
  ajanKod: string;
  baslik: string;
  mesaj: string;
}

function sayisalKolonlar(kolonlar: string[], satirlar: unknown[][]): boolean[] {
  return kolonlar.map((_, n) =>
    satirlar.length > 0 && satirlar.every((s) => typeof s[n] === "number")
  );
}

function SonucKarti({ s }: { s: OlcumSonucu }) {
  const sayisal = sayisalKolonlar(s.kolonlar, s.satirlar);
  return (
    <div className="kart olcum-kart" style={{ borderLeftColor: s.renk }}>
      <div className="olcum-ust">
        <span className="olcum-baslik">{s.baslik}</span>
        <span className="alt-bilgi">{s.sureMs} ms</span>
      </div>
      <div className="olcum-soru">{s.soru}</div>

      {s.bosMu ? (
        <div className="olcum-bos">
          Bu ölçüm <strong>0 satır</strong> döndürdü — hedef ağacındaki bu dal
          veride karşılığı olmayan bir şeye işaret ediyor olabilir.
        </div>
      ) : (
        <>
          <div className="cevap olcum-cevap">{s.cevap}</div>
          {s.satirlar.length > 0 && (
            <div className="tablo-sarici">
              <table>
                <thead><tr>{s.kolonlar.map((k, n) => (
                  <th key={k + n} className={sayisal[n] ? "sayi" : undefined}>{k}</th>
                ))}</tr></thead>
                <tbody>{s.satirlar.slice(0, 12).map((r, i) => (
                  <tr key={i}>{r.map((h, n) => (
                    <td key={n} className={sayisal[n] ? "sayi" : undefined}>
                      {h === null || h === undefined ? "—" : String(h)}
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      {s.sql && <pre className="sql">{s.sql}</pre>}
    </div>
  );
}

export function AjanSekmeleri({
  sonuclar, calisanlar, hatalar,
}: {
  sonuclar: OlcumSonucu[];
  calisanlar: CalisanOlcum[];
  hatalar: OlcumHatasi[];
}) {
  const ajanlar = new Map<string, { ad: string; renk: string }>();
  for (const s of sonuclar) ajanlar.set(s.ajanKod, { ad: s.ajanAd, renk: s.renk });
  for (const c of calisanlar) if (!ajanlar.has(c.ajanKod)) ajanlar.set(c.ajanKod, { ad: c.ajanAd, renk: c.renk });

  const kodlar = [...ajanlar.keys()];
  const [aktif, setAktif] = useState<string | null>(null);
  const secili = aktif && kodlar.includes(aktif) ? aktif : kodlar[0] ?? null;

  if (!kodlar.length) return null;

  const bitenler = sonuclar.filter((s) => s.ajanKod === secili);
  const surenler = calisanlar.filter(
    (c) => c.ajanKod === secili && !sonuclar.some((s) => s.dugumId === c.dugumId)
      && !hatalar.some((h) => h.dugumId === c.dugumId)
  );
  const hatalilar = hatalar.filter((h) => h.ajanKod === secili);

  return (
    <>
      <div className="sekmeler ajan-sekmeler">
        {kodlar.map((k) => {
          const a = ajanlar.get(k)!;
          const adet = sonuclar.filter((s) => s.ajanKod === k).length;
          const suruyor = calisanlar.some(
            (c) => c.ajanKod === k && !sonuclar.some((s) => s.dugumId === c.dugumId)
          );
          return (
            <button key={k} type="button" className={secili === k ? "aktif" : ""}
              onClick={() => setAktif(k)}>
              <span className="ajan-nokta" style={{ background: a.renk }} />
              {a.ad}{adet > 0 ? ` (${adet})` : ""}{suruyor ? " …" : ""}
            </button>
          );
        })}
      </div>

      {surenler.map((c) => (
        <div key={c.dugumId} className="kart bekliyor">{c.ajanAd} çalışıyor: {c.baslik}</div>
      ))}
      {bitenler.map((s) => <SonucKarti key={s.dugumId} s={s} />)}
      {hatalilar.map((h) => (
        <div key={h.dugumId} className="kart hata">{h.baslik}: {h.mesaj}</div>
      ))}
    </>
  );
}
