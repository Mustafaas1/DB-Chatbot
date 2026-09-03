"use client";

import { useEffect, useRef, useState } from "react";
import "./sohbet.css";
import { useAkis, type Akis } from "./akis";
import { HedefAgaci } from "./HedefAgaci";
import { Islemler } from "./Islemler";
import { DogrudanCevap } from "./DogrudanCevap";
import { NedenAnalizi } from "./NedenAnalizi";
import { VarlikKarti } from "./VarlikKarti";

/**
 * SOHBET TRANSKRİPTİ.
 *
 * Boru hattı önce sayfada alt alta yığılıyordu. Canlı destek botunda doğru
 * karşılık bu değil: SSE olayları zaten SIRAYLA geliyor, yani akış doğal
 * olarak bir konuşma. Soru kullanıcı balonu, her aşama ajanın bir mesajı.
 *
 * Dar panelde (452px) plan kartları, sonuç tabloları ve hedef ağacı
 * sığmıyor. Sığmayanı küçültüp okunmaz hale getirmektense GENİŞ MOD var:
 * 912px'te üstte sekmeler çıkıyor. Dar moddayken de erişim kapanmıyor —
 * alttaki kısayollar paneli genişletip ilgili sekmeyi açıyor.
 */

const ORNEKLER = [
  "Son 1 ayda satın alım yapan müşterileri getir",
  "Destek yükümüzü nasıl azaltırız?",
  "Satış performansımızı nasıl artırırız?",
];

export type SohbetSekmesi = "sohbet" | "agac" | "islemler";

export interface SohbetProps {
  /** Geniş mi: sekmeler yalnızca genişken görünür. */
  genis: boolean;
  /**
   * Dar moddan bir sekmeye geçmek panelin genişlemesini gerektiriyor;
   * genişletme kararı kabuğun (`widget/page.tsx`), sohbetin değil.
   * Tek başına sayfada zaten hep geniş, bu yüzden isteğe bağlı.
   */
  genislet?: (sekme: SohbetSekmesi) => void;
}

export function Sohbet({ genis, genislet }: SohbetProps) {
  const akis = useAkis();
  const [taslak, setTaslak] = useState("");
  const [sekme, setSekme] = useState<SohbetSekmesi>("sohbet");

  // Dar moda dönülünce sohbete geri dön: sekmeler görünmezken başka bir
  // sekmede kalmak, kullanıcıyı çıkışı olmayan bir ekranda bırakırdı.
  useEffect(() => { if (!genis) setSekme("sohbet"); }, [genis]);

  function gonder(metin: string) {
    const s = metin.trim();
    if (!s || akis.calisiyor) return;
    setTaslak("");
    setSekme("sohbet");
    void akis.sor(s);
  }

  function sekmeyeGit(s: SohbetSekmesi) {
    if (genis) { setSekme(s); return; }
    // Dar panelde sekme yok; genişletip oraya götür.
    genislet?.(s);
    setSekme(s);
  }

  return (
    <div className="sh">
      {genis && (
        <div className="sh-sekmeler">
          <button className={sekme === "sohbet" ? "aktif" : ""}
            onClick={() => setSekme("sohbet")}>Sohbet</button>
          <button className={sekme === "agac" ? "aktif" : ""}
            disabled={!akis.agac} onClick={() => setSekme("agac")}>Hedef ağacı</button>
          <button className={sekme === "islemler" ? "aktif" : ""}
            onClick={() => setSekme("islemler")}>İşlemler</button>
        </div>
      )}

      <div className="sh-akis">
        {sekme === "islemler" && <Islemler />}
        {sekme === "agac" && akis.agac && (
          <HedefAgaci agac={akis.agac} planlar={akis.planlar} />
        )}
        {sekme === "sohbet" && (
          <Transkript akis={akis} genis={genis} sekmeyeGit={sekmeyeGit} gonder={gonder} />
        )}
      </div>

      <form
        className="sh-yazac"
        onSubmit={(e) => { e.preventDefault(); gonder(taslak); }}
      >
        <input
          type="text"
          value={taslak}
          placeholder="Bir soru yazın…"
          onChange={(e) => setTaslak(e.target.value)}
          disabled={akis.calisiyor}
          aria-label="Soru"
        />
        <button type="submit" disabled={akis.calisiyor || !taslak.trim()}
          aria-label="Gönder">
          {akis.calisiyor ? <Bekleme /> : <Gonder />}
        </button>
      </form>
    </div>
  );
}

/* ---------- Transkript ---------- */

function Transkript({
  akis, genis, sekmeyeGit, gonder,
}: {
  akis: Akis;
  genis: boolean;
  sekmeyeGit: (s: SohbetSekmesi) => void;
  gonder: (m: string) => void;
}) {
  const dip = useRef<HTMLDivElement>(null);

  // Yeni içerik geldikçe aşağı kaydır. Kullanıcı yukarı kaydırmışsa
  // zorla geri çekmek can sıkıcı olurdu; yalnızca dibe yakınsa kaydırıyoruz.
  useEffect(() => {
    const el = dip.current;
    if (!el) return;
    const kutu = el.parentElement;
    if (!kutu) return;
    const dibeUzaklik = kutu.scrollHeight - kutu.scrollTop - kutu.clientHeight;
    if (dibeUzaklik < 240) el.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [
    akis.asama, akis.sonuclar.length, akis.planlar.length,
    akis.dogrudan, akis.varlik, akis.analiz, akis.hata,
  ]);

  if (!akis.basladiMi) {
    return (
      <div className="sh-bos">
        <div className="sh-bos-baslik">Veriyi getirir, nedenini arar.</div>
        <p>
          Sorunuz doğrudan cevaplanmaz: hedef ağacına çevrilir, dalları bölüm
          ajanlarına dağıtılır, her ajan kendi verisini sorgular.
        </p>
        <div className="sh-ornekler">
          {ORNEKLER.map((o) => (
            <button key={o} type="button" onClick={() => gonder(o)}>{o}</button>
          ))}
        </div>
        <div ref={dip} />
      </div>
    );
  }

  return (
    <div className="sh-transkript">
      <div className="sh-balon sh-kullanici">{akis.soru}</div>

      {/* YALNIZCA koşu sürerken; asama metni gelene kadar. Cevap geldikten
          sonra ekranda kalması, sistem hala calisiyormus izlenimi veriyordu. */}
      {akis.calisiyor && !akis.asama && <DerinAnaliz />}

      {akis.hata && <div className="sh-mesaj sh-hata">{akis.hata}</div>}

      {/* Varlık kartı doğrudan cevabın ÜSTÜNDE: soru tek bir varlık
          hakkındaysa cevap odur, liste değil. */}
      {akis.varlik && (
        <Mesaj>
          <VarlikKarti icgoru={akis.varlik.icgoru} zamanAraligi={akis.varlik.zamanAraligi} />
        </Mesaj>
      )}

      {akis.dogrudan && (
        <Mesaj>
          <DogrudanCevap
            sonuc={akis.dogrudan.sonuc} ozet={akis.dogrudan.ozet}
            kaynak={akis.dogrudan.kaynak} tablo={akis.dogrudan.tablo}
            zamanAraligi={akis.dogrudan.zamanAraligi} adaylar={akis.dogrudan.adaylar}
            soru={akis.soru} eksikBoyut={akis.analiz ? null : akis.eksikBoyut}
          />
        </Mesaj>
      )}

      {akis.analiz && (
        <Mesaj>
          <NedenAnalizi analiz={akis.analiz} eksikBoyut={akis.eksikBoyut} />
        </Mesaj>
      )}

      {akis.butce && <ButceMesaji akis={akis} />}

      {akis.calisiyor && akis.asama && <Dusunuyor asama={akis.asama} />}

      {/* Dar panelde sekme çubuğu yok; erişim buradan sürüyor. */}
      {!genis && !akis.calisiyor && akis.basladiMi && (
        <div className="sh-kisayollar">
          {akis.agac && (
            <button type="button" onClick={() => sekmeyeGit("agac")}>
              Hedef ağacını gör
            </button>
          )}
          <button type="button" onClick={() => sekmeyeGit("islemler")}>
            İşlem kaydı
          </button>
        </div>
      )}

      <div ref={dip} />
    </div>
  );
}

/**
 * Koşunun İLK anı: henüz aşama metni gelmeden önce.
 *
 * Görsel dili `Dusunuyor` ile AYNI -- nokta animasyonu + düz metin.
 * Önceki sürüm burada niyeti (ortukHedef, metrik/zaman/varlık chip'leri)
 * detaylı bir kutuda gösteriyordu; bu "Anlaşılan hedef" gibi ayrı bir
 * bölüm hissi veriyordu. Kullanıcıya gösterilen tek şey durum: analiz
 * sürüyor. Cevap geldiğinde (ya da asama metni gelince) KAYBOLUR.
 */
function DerinAnaliz() {
  return (
    <div className="sh-mesaj">
      <span className="sh-avatar" aria-hidden="true">İZ</span>
      <div className="sh-icerik">
        <div className="sh-dusunuyor">
          <span className="sh-nokta" /><span className="sh-nokta" /><span className="sh-nokta" />
          <span className="sh-asama">Derin analiz yapılıyor…</span>
        </div>
      </div>
    </div>
  );
}

function Mesaj({ children }: { children: React.ReactNode }) {
  return (
    <div className="sh-mesaj">
      <span className="sh-avatar" aria-hidden="true">İZ</span>
      <div className="sh-icerik">{children}</div>
    </div>
  );
}


/**
 * Bütçe doldu.
 *
 * Sistem KENDILIGINDEN devam etmez; karar kullanıcının.
 */
function ButceMesaji({ akis }: { akis: Akis }) {
  const b = akis.butce!;
  return (
    <div className="sh-mesaj">
      <span className="sh-avatar" aria-hidden="true">İZ</span>
      <div className="sh-icerik">
        <div className="kart butce-uyari">
          <div className="bolum-baslik">Bütçe doldu</div>
          <p>
            {b.durum.reason}{" "}
            {b.kalan > 0
              ? `${b.kalan} ölçüm yapılmadan durduruldu.`
              : "Ölçümler tamamlanmıştı."}
          </p>
          <div className="butce-olcum">
            <span>
              <b>token</b> {b.durum.tokens.toLocaleString("tr-TR")} /{" "}
              {b.durum.tokenLimit.toLocaleString("tr-TR")}
            </span>
            <span><b>tur</b> {b.durum.turns} / {b.durum.turnLimit}</span>
          </div>
          {b.devam && b.kalan > 0 ? (
            <div className="butce-butonlar">
              <button
                disabled={akis.calisiyor}
                onClick={() => void akis.sor(akis.soru, {
                  ...b.devam!,
                  ekToken: b.durum.tokenLimit * 2,
                  ekTur: b.durum.turnLimit * 2,
                })}
              >Devam et ({b.kalan} ölçüm)</button>
              <button className="ikincil" onClick={akis.butceyiKapat}>Burada bırak</button>
            </div>
          ) : (
            <div className="butce-butonlar">
              <button className="ikincil" onClick={akis.butceyiKapat}>Tamam</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Boru hattının adımları.
 *
 * `esles` GERÇEK aşama metnine bakıyor. Önceki sürüm tanımadığı metinde
 * 3 saniyede bir adım ilerletiyordu; bu, olmamış ilerlemeyi olmuş gibi
 * göstermek olurdu. Tanınmayan metinde artık adım OLDUĞU YERDE kalıyor
 * ve metnin kendisi yazılıyor.
 */
const ADIMLAR: { ad: string; esles: RegExp }[] = [
  { ad: "Soru analiz ediliyor", esles: /soru analiz/i },
  { ad: "Hedef ağacı kuruluyor", esles: /hedef ağacı/i },
  { ad: "Ölçümler dağıtılıyor", esles: /dağıtıl|ölçüm bulundu/i },
  { ad: "Veri sorgulanıyor", esles: /çalışıyor|atlandı/i },
];

/** Yazıyor göstergesi: yalnızca gerçek aşamayı gösterir. */
function Dusunuyor({ asama }: { asama: string }) {
  const su = ADIMLAR.findIndex((a) => a.esles.test(asama));

  return (
    <div className="sh-mesaj">
      <span className="sh-avatar" aria-hidden="true">İZ</span>
      <div className="sh-icerik">
        <div className="sh-dusunuyor">
          <span className="sh-nokta" /><span className="sh-nokta" /><span className="sh-nokta" />
          <span className="sh-asama">{asama}</span>
        </div>
        {su >= 0 && (
          <div className="sh-adimlar">
            {ADIMLAR.map((a, i) => (
              <span key={a.ad}
                className={`sh-adim ${i < su ? "tamam" : i === su ? "aktif" : ""}`}>
                {i < su ? "✓ " : ""}{a.ad}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Gonder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function Bekleme() {
  return <span className="sh-bekleme" aria-hidden="true" />;
}
