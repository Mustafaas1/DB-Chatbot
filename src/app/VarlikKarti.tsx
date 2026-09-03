"use client";

import { useState } from "react";
import type { EntityInsight } from "@/core/pipeline/varlikCalistir";
import type { EntityProfile, Signal } from "@/core/pipeline/varlikProfili";
import type { Advice } from "@/core/pipeline/tavsiye";

/**
 * Tek varlık hakkındaki cevap: sayı + bağlam + tavsiye.
 *
 * Tasarımın merkezi şu: TAVSİYENİN DAYANDIĞI GERÇEKLER ayrıca gösterilir.
 * Model cümleyi kurduğunda kullanıcı neye dayandığını görebilmeli;
 * göremediği bir çıkarım denetlenemez.
 *
 * Cümleyi kimin kurduğu da rozetle yazılıyor. Model bir sayı uydurduysa
 * metin reddedilip kod cümlesine düşülüyor ve bu SAKLANMIYOR.
 */

interface Icgoru {
  profile: EntityProfile | null;
  signals: Signal[];
  facts: string[];
  advice: Advice | null;
}

const SINYAL_ETIKETI: Record<Signal["kind"], string> = {
  overdue: "gecikme",
  dormant: "hareketsiz",
  declining: "düşüş",
  growing: "artış",
  topTier: "üst dilim",
  belowAverage: "ortalama altı",
  new: "yeni",
};

function sayi(n: number): string {
  return n.toLocaleString("tr-TR");
}

export function VarlikKarti({
  icgoru: ilk, zamanAraligi,
}: {
  icgoru: EntityInsight;
  zamanAraligi: string;
}) {
  // Kullanici belirsizligi cozdugunde YEREL olarak degisiyor; akis
  // bastan calismiyor.
  const [veri, setVeri] = useState<Icgoru>(ilk);
  const [mesgul, setMesgul] = useState("");
  const [hata, setHata] = useState("");

  const { resolution } = ilk;
  const { profile: p, signals, facts, advice } = veri;

  async function varlikSec(ad: string) {
    if (mesgul) return;
    setMesgul(ad); setHata("");
    try {
      const r = await fetch("/api/varlik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tablo: resolution.table, varlik: ad, zamanAraligi }),
      });
      const d = await r.json();
      if (!r.ok) { setHata(d.hata ?? "Profil kurulamadı."); return; }
      setVeri({ profile: d.profile, signals: d.signals, facts: d.facts, advice: d.advice });
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      setMesgul("");
    }
  }

  return (
    <div className="kart">
      <div className="bolum-baslik">
        Aradığınız kayıt
        <span className="kaynak-rozet kod">ölçümler kodda üretildi</span>
      </div>

      {/* Hangi ada karsilik hangi kayit bulundugu GIZLENMIYOR: soruda
          "Fellas" yaziyor, veritabaninda tam unvan var. */}
      <p className="ozet-not">
        “{resolution.query}” araması <b>{resolution.table}.{resolution.column}</b>{" "}
        üzerinde yapıldı; {resolution.matches.length} kayıt eşleşti.
      </p>

      {resolution.matches.length === 0 && (
        <div className="eksik-boyut">
          Bu adda bir kayıt bulunamadı. Adın veritabanındaki yazımı farklı
          olabilir; yakın bir yazımla tekrar sorun.
        </div>
      )}

      {/* Belirsizlik KULLANICIYA birakiliyor: "ADA" iki musteriye uyuyor
          ve birini secip digerini gizlemek yanlis cevap uretirdi. */}
      {resolution.matches.length > 1 && (
        <div className="tablo-secim">
          <span className="tablo-secim-etiket">hangisi</span>
          {resolution.matches.map((m) => (
            <button
              key={m.value}
              className={`tablo-dugme ${p?.entity === m.value ? "secili" : ""}`}
              disabled={!!mesgul}
              onClick={() => void varlikSec(m.value)}
            >{m.value} ({sayi(m.records)})</button>
          ))}
          {mesgul && <span className="tablo-secim-etiket">hesaplanıyor…</span>}
        </div>
      )}
      {hata && <div className="eksik-boyut">{hata}</div>}

      {p && (
        <>
          <div className="varlik-ad">{p.entity}</div>

          <div className="ozet-serit">
            <span className="ozet-kutu">
              <b>{sayi(p.current)}</b><i>{p.rangeLabel}</i>
            </span>
            <span className="ozet-kutu">
              <b>{sayi(p.previous)}</b><i>{p.previousRangeLabel}</i>
            </span>
            {p.changePercent != null && (
              <span className="ozet-kutu">
                <b className={p.changePercent >= 0 ? "artis" : "azalis"}>
                  {p.changePercent > 0 ? "+" : ""}%{p.changePercent}
                </b>
                <i>dönem farkı</i>
              </span>
            )}
            {p.currentAmount != null && (
              <span className="ozet-kutu">
                <b>{sayi(p.currentAmount)}</b>
                <i>tutar{p.currency ? ` (${p.currency})` : ""}</i>
              </span>
            )}
            <span className="ozet-kutu">
              <b>{sayi(p.allTime)}</b><i>tüm zamanlar</i>
            </span>
            {p.daysSinceLast != null && (
              <span className="ozet-kutu">
                <b>{sayi(p.daysSinceLast)}</b><i>gün önce son kayıt</i>
              </span>
            )}
            {p.averageIntervalDays != null && (
              <span className="ozet-kutu">
                <b>{sayi(p.averageIntervalDays)}</b><i>gün ortalama aralık</i>
              </span>
            )}
            {p.peers && (
              <span className="ozet-kutu">
                <b>%{p.peers.percentile}</b>
                <i>dilim ({sayi(p.peers.total)} varlık içinde)</i>
              </span>
            )}
          </div>

          {/* Tutar kolonu var ama hic deger girilmemisse SIFIR demiyoruz. */}
          {p.currentAmount == null && (
            <p className="ozet-not">
              Bu dönemde tutarı kaydedilmiş kayıt yok; tutar toplamı
              hesaplanmadı. Bu bir veri eksiği, sıfır ciro değil.
            </p>
          )}

          {advice && (
            <div className={`tavsiye ${advice.kaynak}`}>
              <div className="tavsiye-baslik">
                Yorum
                <span className={`kaynak-rozet ${advice.kaynak === "model" ? "ajan" : "kod"}`}>
                  {advice.kaynak === "model" ? "cümleyi model kurdu" : "cümle kodda kuruldu"}
                </span>
              </div>
              <p className="tavsiye-metin">{advice.text}</p>

              {/* Dogrulama calistiginda GORUNSUN: sessizce geri dusmek,
                  denetimin varligini gizlemek olurdu. */}
              {advice.reddedilenSayilar.length > 0 && (
                <div className="eksik-boyut">
                  Modelin yorumu <b>reddedildi</b>: verilmeyen sayı(lar)
                  kullandı — {advice.reddedilenSayilar.join(", ")}. Yukarıdaki
                  cümle kod tarafından kuruldu.
                  {/* Reddedilen taslak GÖRÜNÜR ama katlı: denetimin neyi
                      elediğini görmeden ona güvenmek için sebep yok. */}
                  {advice.reddedilenMetin && (
                    <details className="reddedilen">
                      <summary>Reddedilen taslağı göster</summary>
                      <p>{advice.reddedilenMetin}</p>
                      <span>
                        Bu metin <b>kullanılmadı</b>; içindeki sayılar veriden
                        gelmiyor.
                      </span>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {signals.length > 0 && (
            <div className="sinyaller">
              {signals.map((s) => (
                <div key={s.kind} className={`sinyal s-${s.kind}`}>
                  <span className="sinyal-etiket">{SINYAL_ETIKETI[s.kind]}</span>
                  {s.text}
                </div>
              ))}
            </div>
          )}

          {/* Tavsiyenin DAYANDIGI gercekler; model yalnizca bunlari gordu. */}
          {facts.length > 0 && (
            <details className="gercekler">
              <summary>Yorumun dayandığı gerçekler ({facts.length})</summary>
              <ul>{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
              <p className="ozet-not">
                Modele yalnızca bu satırlar verildi ve ürettiği metindeki her
                sayı bunlara karşı doğrulandı.
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
