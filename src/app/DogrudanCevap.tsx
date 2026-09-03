"use client";

import { Fragment, useState } from "react";
import type { OlcumSonucu } from "./AjanSekmeleri";
import { kolonEtiketi, type ListSummary } from "@/core/pipeline/ozet";
import { agIstegi } from "./istek";

/**
 * Kullanicinin LITERAL sorusuna cevap.
 *
 * Hedef agaci "neden" sorusunu isliyor; bu kart sorulan seyi cevapliyor.
 * Ozetteki sayilar modelden degil, donen satirlardan KODDA hesaplandi.
 */
interface DetayDurumu {
  yukleniyor: boolean;
  kolonlar?: string[];
  satirlar?: unknown[][];
  hata?: string;
}

/** Hucre degeri; bos deger "—" ile gosteriliyor. */
function hucre(h: unknown): string {
  if (h == null || h === "") return "Belirtilmemiş";
  if (typeof h === "number") {
    return h.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  }
  // Tarihler ISO dizgesi olarak geliyor; saat bilgisi gurultu.
  if (typeof h === "string" && /^\d{4}-\d{2}-\d{2}T/.test(h)) {
    const t = new Date(h);
    if (!Number.isNaN(t.getTime())) return t.toLocaleDateString("tr-TR");
  }
  return String(h);
}

/** Bir satirin acilan ayrinti tablosu. */
function Detay({ durum }: { durum: DetayDurumu | undefined }) {
  if (!durum || durum.yukleniyor) {
    return <div className="detay-bekle">Kayıtlar getiriliyor…</div>;
  }
  if (durum.hata) return <div className="eksik-boyut">{durum.hata}</div>;

  const kolonlar = durum.kolonlar ?? [];
  const satirlar = durum.satirlar ?? [];
  if (!satirlar.length) return <div className="detay-bekle">Kayıt bulunamadı.</div>;

  const sayisal = kolonlar.map((_, n) =>
    satirlar.every((r) => r[n] == null || typeof r[n] === "number")
  );

  return (
    <table className="detay-tablo">
      <thead>
        <tr>{kolonlar.map((k, i) => (
          <th key={i} className={sayisal[i] ? "sag" : ""}>{kolonEtiketi(k)}</th>
        ))}</tr>
      </thead>
      <tbody>
        {satirlar.map((r, i) => (
          <tr key={i}>
            {r.map((h, j) => (
              <td key={j} className={sayisal[j] ? "sag" : ""}>{hucre(h)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TABLO_ADLARI: Record<string, string> = {
  "Invoices": "Faturalar",
  "Teklifler": "Teklifler",
  "TicketRecords": "Destek Kayıtları",
  "Customers": "Müşteriler"
};

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
      const r = await agIstegi("/api/dogrudan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tablo: ad, soru, zamanAraligi }),
      });
      const d = await r.json();
      if (!r.ok) { setHata(d.hata ?? "Hesaplanamadı."); return; }
      setVeri({ sonuc: d.sonuc, ozet: d.ozet });
      setSecili(ad);
      // Tablo degisti: onceki tablonun ayrintilari artik gecersiz.
      setAcikSatir(null); setDetaylar({});
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      setMesgul(false);
    }
  }
  /**
   * Satir ayrintilari: hangi varlik acik ve o varligin kayitlari.
   *
   * Ozet tablosu varlik basina TEK satir gosteriyor ("3 teklif"); bir
   * sonraki soru hep ayni: "hangi 3 teklif?". Ayri bir soru sormaya
   * birakmak, cevabi zaten elimizde olan sey icin bir tur harcamak olurdu.
   *
   * Bir kez getirilen ayrinti SAKLANIYOR: ayni satiri tekrar acmak
   * sunucuya gitmiyor.
   */
  const [acikSatir, setAcikSatir] = useState<string | null>(null);
  const [detaylar, setDetaylar] = useState<Record<string, DetayDurumu>>({});

  async function detayAc(ad: string) {
    if (acikSatir === ad) { setAcikSatir(null); return; }
    setAcikSatir(ad);
    if (detaylar[ad]) return;

    setDetaylar((o) => ({ ...o, [ad]: { yukleniyor: true } }));
    try {
      const r = await agIstegi("/api/detay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tablo: secili, varlik: ad, zamanAraligi }),
      });
      const d = await r.json();
      setDetaylar((o) => ({
        ...o,
        [ad]: r.ok
          ? { yukleniyor: false, kolonlar: d.kolonlar, satirlar: d.satirlar }
          : { yukleniyor: false, hata: d.hata ?? "Ayrıntı getirilemedi." },
      }));
    } catch (e) {
      setDetaylar((o) => ({
        ...o,
        [ad]: {
          yukleniyor: false,
          hata: e instanceof Error ? e.message : "Sunucuya ulaşılamadı.",
        },
      }));
    }
  }

  // Gosterilen ilk 25 satirdaki bos hucreler; dipnotta aciklaniyor.
  const eksikHucre = sonuc.satirlar
    .slice(0, 25)
    .reduce((t, satir) => t + satir.filter((h) => h == null).length, 0);

  const sayisal = sonuc.kolonlar.map((_, n) =>
    sonuc.satirlar.length > 0 && sonuc.satirlar.every((s) =>
      typeof s[n] === "number" || s[n] === null || s[n] === undefined
    ) && sonuc.satirlar.some((s) => typeof s[n] === "number")
  );

  return (
    <div className="kart">
      <div className="bolum-baslik">
        Sorunun cevabı
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
            >{TABLO_ADLARI[ad] || ad}</button>
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
                <i>benzersiz {kolonEtiketi(ozet.entityColumn)}</i>
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
                <th key={i} className={sayisal[i] ? "sag" : ""}>{kolonEtiketi(k)}</th>
              ))}</tr>
            </thead>
            <tbody>
              {sonuc.satirlar.slice(0, 25).map((satir, i) => {
                const ad = String(satir[0] ?? "");
                const acik = acikSatir === ad;
                return (
                  <Fragment key={i}>
                    <tr
                      className={`tiklanir ${acik ? "acik" : ""}`}
                      onClick={() => void detayAc(ad)}
                      title="Kayıtları göster"
                    >
                      {satir.map((h, j) => (
                        <td key={j} className={sayisal[j] ? "sag" : ""}>
                          {j === 0 && <span className="satir-ok">{acik ? "▾" : "▸"}</span>}
                          {hucre(h)}
                        </td>
                      ))}
                    </tr>
                    {acik && (
                      <tr className="detay-satir">
                        <td colSpan={sonuc.kolonlar.length}>
                          <Detay durum={detaylar[ad]} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sonuc.satirlar.length > 25 && (
        <div className="alt-bilgi">İlk 25 satır gösteriliyor ({sonuc.satirlar.length} satır döndü).</div>
      )}

      {/* SQL GOSTERILMIYOR: canli destek botunda musteriye sorgu
          gostermek gurultu. Sorgu yine denetim kaydinda duruyor. */}
    </div>
  );
}
