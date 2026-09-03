"use client";

import { Sohbet } from "./Sohbet";

/**
 * Tek başına sayfa.
 *
 * Ürünün asıl yüzeyi artık portala gömülen widget (`/widget`). Bu sayfa
 * AYNI sohbeti tam ekran gösteriyor; ayrı bir arayüz tutmuyoruz. İki
 * render yolu olsaydı birinde yapılan düzeltme diğerine geçmezdi —
 * bu projede tam bu hata bir kez yaşandı (F6'da önce/sonra ölçümü).
 *
 * `genis` sabit true: burada panel dar değil, sekmeler hep görünür.
 */
export default function Sayfa() {
  return (
    <main className="tam-sayfa">
      <header className="tam-baslik">
        <span className="tam-rozet" aria-hidden="true">İZ</span>
        <div>
          <h1>İş Zekâsı Ajanı</h1>
          <p>Veriyi getirir, nedenini arar.</p>
        </div>
      </header>

      <div className="tam-govde">
        <Sohbet genis />
      </div>
    </main>
  );
}
