"use client";

import type { CauseAnalysis } from "@/core/pipeline/nedenAnaliziCalistir";

/**
 * Neden analizi: dönem değişimi + türetilmiş segment.
 *
 * "Türetilmiş" etiketi ŞART: veritabanında segment kolonu yok, dilimleri
 * biz hesaplıyoruz. Kayıtlı bir alan gibi göstermek veriyi yanlış temsil
 * etmek olurdu.
 */
export function NedenAnalizi({
  analiz, eksikBoyut,
}: {
  analiz: CauseAnalysis;
  eksikBoyut: { segment: string; sebep: string } | null;
}) {
  // Ag sinirindan gelen veri: alanlarin varligina GUVENMIYORUZ. Tip
  // sozlesmesi sunucunun gonderdigini soyluyor ama eski bir sekme ya da
  // yarim yuklenmis bir yanit React agacini komple dusurmemeli.
  const { donem = [], segment, kirilimlar = [], yeniMevcut = null } = analiz ?? {};
  if (!segment) return null;
  if (!donem.length && !segment.tiers.length && !segment.withoutAmount
      && !kirilimlar.length && !yeniMevcut) return null;

  const sayi = (n: number) => n.toLocaleString("tr-TR");
  const yon = (y: number | null) =>
    y == null ? "" : y > 0 ? "artis" : y < 0 ? "azalis" : "sabit";

  return (
    <div className="kart">
      <div className="bolum-baslik">Neden analizi</div>

      {donem.length > 0 && (
        <>
          <div className="analiz-baslik">Geçen aya göre</div>
          {donem.map((d, i) => (
            <div key={i} className="donem-kutu">
              <div className="donem-ust">
                {d.oncekiAy} → {d.simdikiAy}
                {d.paraBirimi && <span className="donem-birim">{d.paraBirimi}</span>}
              </div>
              <table className="analiz-tablo">
                <tbody>
                  {[
                    { ad: "kayıt", v: d.kayit },
                    { ad: "müşteri", v: d.varlik },
                    ...(d.toplam ? [{ ad: "tutar", v: d.toplam }] : []),
                  ].map((s) => (
                    <tr key={s.ad}>
                      <td className="analiz-etiket">{s.ad}</td>
                      <td className="sag">{sayi(s.v.once)}</td>
                      <td className="analiz-ok">→</td>
                      <td className="sag">{sayi(s.v.sonra)}</td>
                      <td className={`sag fark ${yon(s.v.degisimYuzde)}`}>
                        {s.v.degisimYuzde == null
                          ? "—"
                          : `${s.v.degisimYuzde > 0 ? "+" : ""}%${s.v.degisimYuzde}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      <div className="analiz-baslik">
        Harcama dilimleri
      </div>

      {segment.tiers.length > 0 ? (
        <table className="analiz-tablo">
          <tbody>
            {segment.tiers.map((d) => (
              <tr key={d.ad}>
                <td className="analiz-etiket">{d.ad}</td>
                <td className="sag">{sayi(d.entityCount)} müşteri</td>
                <td className="sag">%{d.pay}</td>
                <td className="sag">
                  {sayi(d.toplam)}{segment.paraBirimi ? ` ${segment.paraBirimi}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="ozet-not">Dilimlenebilecek tutarlı kayıt yok.</div>
      )}

      {/* Tutarsiz kayitlar GIZLENMIYOR: sessizce "dusuk" saymak
          dilimlemenin tamamini yanlis yapardi. */}
      {segment.withoutAmount > 0 && (
        <div className="eksik-boyut">
          {segment.totalEntities} müşterinin <b>{segment.withoutAmount}</b> tanesinin
          tutarı boş; dilimlemeye katılmadılar. Bu bir veri eksiği, düşük
          harcama değil.
        </div>
      )}

      {/* YENI / MEVCUT: ilk kayit tarihinden turetiliyor. */}
      {yeniMevcut && (
        <>
          <div className="analiz-baslik">
            Yeni mi, mevcut mu
          </div>
          <div className="ozet-serit">
            <span className="ozet-kutu">
              <b>{sayi(yeniMevcut.neww)}</b><i>yeni müşteri</i>
            </span>
            <span className="ozet-kutu">
              <b>{sayi(yeniMevcut.returning)}</b><i>mevcut müşteri</i>
            </span>
            <span className="ozet-kutu">
              <b>%{yeniMevcut.newShare}</b><i>yeni oranı</i>
            </span>
          </div>
        </>
      )}

      {/* KIRILIMLAR: edinim kanali DEGIL; ne oldugu acikca yaziliyor. */}
      {kirilimlar.length > 0 && (
        <>
          <div className="analiz-baslik">Kırılımlar</div>
          {kirilimlar.map((k) => {
            const baslik = k.column === "SatisTemsilcisi" ? "Satış Temsilcisi" :
                           k.column === "UrunTipi" ? "Ürün Tipi" :
                           k.column.replace(/([A-Z])/g, ' $1').trim();
            return (
            <div key={k.column} className="donem-kutu">
              <div className="donem-ust">
                {baslik}
                <span className="donem-birim">
                  {k.kind === "attribution" ? "sorumlu kişi" : "kategori"}
                </span>
              </div>
              <table className="analiz-tablo">
                <tbody>
                  {k.rows.map((r) => (
                    <tr key={r.value}>
                      <td className="analiz-etiket">{r.value || "Belirtilmemiş"}</td>
                      <td className="sag">{sayi(r.entities)} müşteri</td>
                      <td className="sag">%{r.share}</td>
                      <td className="sag">{sayi(r.records)} kayıt</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )})}
        </>
      )}

      {/* Kriter 2'nin kanal parcasi: veri yok, uydurulmuyor. */}
      {eksikBoyut && (
        <div className="eksik-boyut">
          <b>“{eksikBoyut.segment}”</b> kırılımı üretilemedi: {eksikBoyut.sebep}
        </div>
      )}

      <div className="alt-bilgi">
        {analiz.tablo} · {analiz.sureMs} ms · model kullanılmadı
      </div>
    </div>
  );
}
