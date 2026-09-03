"use client";

/**
 * Olcum sonucunun tipi KANONIK kaynaktan geliyor.
 *
 * Burada elle yazilmis bir kopya vardi ve sessizce AYRISMISTI: `satirSayisi`
 * hic yoktu, `sorguCalisti` eklenince de derleyici sunucu tarafini gecirip
 * arayuzde patladi. Tip tek yerde durunca sunucu bir alan ekledigi anda
 * arayuz de haberdar oluyor.
 *
 * `export type` calisma zamaninda silinir; sunucu modulu istemciye inmez.
 */
export type { OlcumSonucu } from "@/core/ajan/olcum";
import type { OlcumSonucu } from "@/core/ajan/olcum";

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
    satirlar.length > 0 && satirlar.every((s) =>
      typeof s[n] === "number" || s[n] === null || s[n] === undefined
    ) && satirlar.some((s) => typeof s[n] === "number")
  );
}

function hucreDegeri(h: unknown, sayiMi: boolean): string {
  if (h === null || h === undefined) return "—";
  if (sayiMi && typeof h === "number") {
    return h.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  }
  return String(h);
}

function SonucKarti({ s }: { s: OlcumSonucu }) {
  const sayisal = sayisalKolonlar(s.kolonlar, s.satirlar);
  return (
    <div className="kart olcum-kart" style={{ borderLeftColor: "#0891b2" }}>
      <div className="olcum-ust">
        <span className="olcum-baslik">{s.baslik}</span>
      </div>
      <div className="olcum-soru">{s.soru}</div>

      {s.belirsiz && (
        <div className="olcum-belirsiz">
          Bu ölçüm hangi bölüme ait olduğu <strong>anlaşılamadığı için</strong>
          {" "}varsayılan ajana verildi; sonuç yanlış kapsamda olabilir.
        </div>
      )}

      {/* BOS OLMANIN IKI SEBEBI VAR ve ayni cumleyle anlatilamaz.
          Kota dolduğunda ajanın cevabı "Yapay zeka kotası doldu" oluyor
          ama ekranda "Kriterlere uygun veri bulunamadı" yazıyordu --
          kullanıcı veride kayıt yok sanıyordu. */}
      {s.bosMu ? (
        s.sorguCalisti ? (
          <div className="olcum-bos">
            Sorgu çalıştı; kriterlere uygun kayıt bulunamadı.
          </div>
        ) : (
          <div className="olcum-bos olcum-yapilmadi">
            <b>Ölçüm yapılamadı.</b>{" "}
            {s.durmaSebebi === "kota"
              ? "Yapay zeka kotası doldu; bir süre sonra tekrar deneyin."
              : s.durmaSebebi === "tur_siniri"
              ? "Ajan izin verilen araç çağrısı sayısını aştı; soruyu daraltın."
              : s.durmaSebebi === "hata"
              ? "Yapay zekaya ulaşılamadı."
              : s.cevap || "Ajan sorgu yazmadı."}
          </div>
        )
      ) : (
        <>
          <div className="cevap olcum-cevap">{s.cevap}</div>
          {s.satirlar.length > 0 && (
            <div className="tablo-sarici olcum-tablo-sarici">
              <table className="premium-tablo">
                <thead><tr>{s.kolonlar.map((k, n) => (
                  <th key={k + n} className={sayisal[n] ? "sayi" : undefined}>{k}</th>
                ))}</tr></thead>
                <tbody>{s.satirlar.slice(0, 12).map((r, i) => (
                  <tr key={i}>{r.map((h, n) => (
                    <td key={n} className={sayisal[n] ? "sayi" : undefined}>
                      {hucreDegeri(h, sayisal[n]!)}
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table>
              {s.satirlar.length > 12 && (
                <div className="tablo-devam">
                  İlk 12 satır gösteriliyor ({s.satirlar.length} satır döndü).
                </div>
              )}
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
