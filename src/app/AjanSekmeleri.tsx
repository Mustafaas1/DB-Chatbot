"use client";

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
  belirsiz: boolean;
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
    <div className="kart olcum-kart" style={{ borderLeftColor: "#0891b2" }}>
      <div className="olcum-ust">
        <span className="olcum-baslik">{s.baslik}</span>
        <span className="alt-bilgi">{s.sureMs} ms</span>
      </div>
      <div className="olcum-soru">{s.soru}</div>

      {s.belirsiz && (
        <div className="olcum-belirsiz">
          Bu ölçüm hangi bölüme ait olduğu <strong>anlaşılamadığı için</strong>
          {" "}varsayılan ajana verildi; sonuç yanlış kapsamda olabilir.
        </div>
      )}

      {s.bosMu ? (
        <div className="olcum-bos">
          Kriterlere uygun veri bulunamadı.
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
  const surenler = calisanlar.filter(
    (c) => !sonuclar.some((s) => s.dugumId === c.dugumId)
      && !hatalar.some((h) => h.dugumId === c.dugumId)
  );

  if (!sonuclar.length && !surenler.length && !hatalar.length) return null;

  return (
    <>
      <div className="kart veri-analisti-baslik">
        <div className="bolum-baslik">
          <span className="ajan-nokta" style={{ background: "#0891b2", marginRight: 8 }} />
          Veri Analisti
          {sonuclar.length > 0 && <span className="veri-analisti-adet"> — {sonuclar.length} ölçüm</span>}
        </div>
      </div>

      {surenler.map((c) => (
        <div key={c.dugumId} className="kart bekliyor">Analiz ediliyor: {c.baslik}</div>
      ))}
      {sonuclar.map((s) => <SonucKarti key={s.dugumId} s={s} />)}
      {hatalar.map((h) => (
        <div key={h.dugumId} className="kart hata">{h.baslik}: {h.mesaj}</div>
      ))}
    </>
  );
}
