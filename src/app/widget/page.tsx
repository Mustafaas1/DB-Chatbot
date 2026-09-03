"use client";

import { Sohbet } from "../Sohbet";
import { useKabuk } from "./kabuk";

/**
 * Widget kabuğu: yuvarlak buton ve açılan panel.
 *
 * Bu dosya YALNIZCA kabuk: buton, başlık ve boyut. İçeriği `Sohbet`
 * veriyor ve onu tek başına sayfa da (`/`) kullanıyor — iki render yolu
 * tutmak, birinde yapılan düzeltmenin diğerine geçmemesi demekti.
 */

function SohbetIkonu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4.2-.9L3 20.5l1.6-4.4A8.3 8.3 0 0 1 3.6 11.5a8.4 8.4 0 0 1 8.4-8.4h.5a8.4 8.4 0 0 1 8.5 8.4z" />
    </svg>
  );
}

function Kapat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function Genislet({ acik }: { acik: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {acik
        ? <path d="M9 3v6H3M15 21v-6h6" />
        : <path d="M15 3h6v6M9 21H3v-6" />}
    </svg>
  );
}

export default function Widget() {
  const { durum, gomulu, ac, kapat, genisligiDegistir, genislet } = useKabuk();

  return (
    <div className="gk-kok">
      {durum === "kapali" ? (
        <button className="gk-fab" onClick={ac} aria-label="İş Zekâsı Ajanı'nı aç">
          <SohbetIkonu />
        </button>
      ) : (
        <div className="gk-panel" role="dialog" aria-label="İş Zekâsı Ajanı">
          <div className="gk-baslik">
            <span className="gk-rozet"><SohbetIkonu /></span>
            <div className="gk-baslik-metin">
              <div className="gk-baslik-ad">İş Zekâsı Ajanı</div>
              <div className="gk-baslik-alt">Veriyi getirir, nedenini arar</div>
            </div>

            <button
              className="gk-baslik-dugme gk-gizle-dar"
              onClick={genisligiDegistir}
              aria-label={durum === "genis" ? "Paneli daralt" : "Paneli genişlet"}
            >
              <Genislet acik={durum === "genis"} />
            </button>

            {/* Gömülü değilken kapatmak paneli yok ederdi ve geliştirme
                sırasında boş bir sayfa kalırdı; düğme yalnızca gömülüyken. */}
            {gomulu && (
              <button className="gk-baslik-dugme" onClick={kapat} aria-label="Kapat">
                <Kapat />
              </button>
            )}
          </div>

          <div className="gk-govde">
            {/* Hangi sekmeye gidileceğini `Sohbet` kendi tutuyor; kabuğa
                düşen tek iş paneli genişletmek. */}
            <Sohbet genis={durum === "genis"} genislet={genislet} />
          </div>
        </div>
      )}
    </div>
  );
}
