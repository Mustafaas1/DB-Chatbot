"use client";

import { useState } from "react";
import type { OlcumSonucu } from "./AjanSekmeleri";
import type { ListSummary } from "@/core/pipeline/ozet";

/**
 * Kullanicinin LITERAL sorusuna cevap.
 *
 * Hedef agaci "neden" sorusunu isliyor; bu kart sorulan seyi cevapliyor.
 * Ozetteki sayilar modelden degil, donen satirlardan KODDA hesaplandi.
 */
export function DogrudanCevap({
  sonuc: ilkSonuc, ozet: ilkOzet, kaynak, tablo, zamanAraligi, adaylar, soru,
  eksikBoyut,
}: {
  sonuc: OlcumSonucu;
  ozet: ListSummary;
  /** Sorguyu kim yazdı; kullanıcı hangi yolun kullanıldığını görmeli. */
  kaynak: "kod" | "ajan";
  /** Hangi tablodan hesaplandı; ajan yolunda bilinmiyor. */
  tablo: string | null;
  zamanAraligi: string;
  /** Kullanıcının geçebileceği diğer tablolar. */
  adaylar: string[];
  soru: string;
  eksikBoyut: { segment: string; sebep: string } | null;
}) {
  // Kullanici tablo degistirdiginde YEREL olarak degisir; akis yeniden
  // calismaz. Sorgu kodda uretildigi icin maliyeti sifir.
  const [secili, setSecili] = useState(tablo);
  const [veri, setVeri] = useState({ sonuc: ilkSonuc, ozet: ilkOzet });
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState("");

  const sonuc = veri.sonuc;
  const ozet = veri.ozet;

  async function tabloDegistir(ad: string) {
    if (ad === secili || mesgul) return;
    setMesgul(true); setHata("");
    try {
      const r = await fetch("/api/dogrudan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tablo: ad, soru, zamanAraligi }),
      });
      const d = await r.json();
      if (!r.ok) { setHata(d.hata ?? "Hesaplanamadı."); return; }
      setVeri({ sonuc: d.sonuc, ozet: d.ozet });
      setSecili(ad);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      setMesgul(false);
    }
  }
  const sayisal = sonuc.kolonlar.map((_, n) =>
    sonuc.satirlar.length > 0 && sonuc.satirlar.every((s) => typeof s[n] === "number")
  );

  return (
    <div className="kart">
      <div className="bolum-baslik">
        Sorunun cevabı
        <span className={`kaynak-rozet ${kaynak}`}>
          {kaynak === "kod" ? "sorgu kodda üretildi" : "sorguyu ajan yazdı"}
        </span>
      </div>

      {/* Hangi tablodan hesaplandigi GIZLENMIYOR: "satin alim" hem
          Teklifler hem Invoices olarak yorumlanabiliyor. */}
      {secili && (
        <div className="tablo-secim">
          <span className="tablo-secim-etiket">kaynak tablo</span>
          {adaylar.map((ad) => (
            <button
              key={ad}
              className={`tablo-dugme ${ad === secili ? "secili" : ""}`}
              disabled={mesgul}
              onClick={() => void tabloDegistir(ad)}
            >{ad}</button>
          ))}
          {mesgul && <span className="tablo-secim-etiket">hesaplanıyor…</span>}
        </div>
      )}
      {hata && <div className="eksik-boyut">{hata}</div>}

      {ozet.rowCount > 0 ? (
        <>
          <div className="ozet-serit">
            <span className="ozet-kutu">
              <b>{ozet.rowCount.toLocaleString("tr-TR")}</b>
              <i>satır</i>
            </span>
            {ozet.entityColumn && (
              <span className="ozet-kutu">
                <b>{ozet.uniqueEntities.toLocaleString("tr-TR")}</b>
                <i>benzersiz {ozet.entityColumn}</i>
              </span>
            )}
            {ozet.repeatRate != null && (
              <span className="ozet-kutu">
                <b>%{ozet.repeatRate}</b>
                <i>tekrar oranı ({ozet.repeating})</i>
              </span>
            )}
            {ozet.measures.map((m, i) => (
              <span key={i} className="ozet-kutu">
                <b>{m.deger.toLocaleString("tr-TR")}</b>
                <i>{m.etiket}{m.kirilim ? ` (${m.kirilim})` : ""}</i>
              </span>
            ))}
          </div>
          <p className="ozet-not">
            Bu sayılar dönen satırlardan kodda hesaplandı; model tarafından
            üretilmedi.
            {kaynak === "ajan" && " Sorgunun kendisi ajan tarafından yazıldı; " +
              "koşudan koşuya değişebilir."}
          </p>
        </>
      ) : (
        <p className="ozet-not">{sonuc.cevap || "Sonuç boş."}</p>
      )}

      {/* Istenen kirilimin veride karsiligi yoksa sessizce atlamiyoruz. */}
      {eksikBoyut && (
        <div className="eksik-boyut">
          <b>“{eksikBoyut.segment}”</b> kırılımı üretilemedi: {eksikBoyut.sebep}
        </div>
      )}

      {sonuc.satirlar.length > 0 && (
        <div className="tablo-sar">
          <table className="sonuc-tablo">
            <thead>
              <tr>{sonuc.kolonlar.map((k, i) => (
                <th key={i} className={sayisal[i] ? "sag" : ""}>{k}</th>
              ))}</tr>
            </thead>
            <tbody>
              {sonuc.satirlar.slice(0, 25).map((satir, i) => (
                <tr key={i}>
                  {satir.map((h, j) => (
                    <td key={j} className={sayisal[j] ? "sag" : ""}>
                      {h == null ? "—" : typeof h === "number" ? h.toLocaleString("tr-TR") : String(h)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sonuc.satirlar.length > 25 && (
        <div className="alt-bilgi">İlk 25 satır gösteriliyor ({sonuc.satirlar.length} satır döndü).</div>
      )}
      {sonuc.sql && <div className="dugum-olcum"><span>sorgu:</span> {sonuc.sql}</div>}
    </div>
  );
}
