"use client";

import { useEffect, useState } from "react";

interface GBKayit {
  id: string;
  islemAdi: string;
  hedefTablo: string;
  parametreler: unknown;
  onaylayan: string | null;
  olusturma: string;
  guncelleme: string;
  provaOzet: string | null;
  onceVar: boolean;
  sonraVar: boolean;
  sonOlcum: string | null;
}

interface KolonEtkisi {
  kolon: string;
  onceki: number | null;
  sonraki: number | null;
  fark: number | null;
  yuzde: number | null;
  yon: "artis" | "azalis" | "ayni" | "belirsiz";
}

interface SatirKarsilastirma {
  anahtar: string;
  degisimler: {
    kolon: string;
    onceki: unknown;
    sonraki: unknown;
    fark: number | null;
    yuzde: number | null;
  }[];
}

interface EtkiRaporu {
  satirDegisimi: { onceki: number; sonraki: number; fark: number; yon: string };
  kolonEtkileri: KolonEtkisi[];
  satirKarsilastirmalari: SatirKarsilastirma[];
  onceZaman: string;
  sonraZaman: string;
  gercekOnceMi: boolean;
}

interface EtkiSonuc {
  dugumId: string;
  baslik: string;
  rapor: EtkiRaporu;
}

function YonSimge({ yon, deger }: { yon: string; deger?: number | null }) {
  if (yon === "artis") return <span className="gb-yon gb-artis">▲ {deger != null ? `+${deger}` : ""}</span>;
  if (yon === "azalis") return <span className="gb-yon gb-azalis">▼ {deger != null ? String(deger) : ""}</span>;
  return <span className="gb-yon gb-ayni">≈</span>;
}

function YuzdeBadge({ yuzde }: { yuzde: number | null }) {
  if (yuzde === null) return null;
  const cls = yuzde > 0 ? "gb-badge-artis" : yuzde < 0 ? "gb-badge-azalis" : "gb-badge-ayni";
  return <span className={`gb-badge ${cls}`}>{yuzde > 0 ? "+" : ""}{yuzde}%</span>;
}

function EtkiKarti({ sonuc }: { sonuc: EtkiSonuc }) {
  const { rapor, baslik } = sonuc;
  return (
    <div className="kart gb-etki-kart">
      <div className="gb-etki-baslik">{baslik}</div>

      {!rapor.gercekOnceMi && (
        <div className="gb-uyari">
          Bu ölçüm uygulama sonrasında yapıldı; önceki referans snapshot yok.
          Gösterilen karşılaştırma anlık durumdur.
        </div>
      )}

      {/* Nedensellik cekincesi HER raporda gorunur. Aksi halde kullanici
          "aksiyon bunu yapti" diye okur; oysa iki olcum arasinda baska
          her sey de olmus olabilir. */}
      <div className="gb-cekince">
        Bu fark <strong>nedensellik göstermez</strong>. İki ölçüm arasında
        başka işlemler de olmuş olabilir; değişim yalnızca bu aksiyonun
        sonucu sayılamaz.
      </div>

      {/* Satır sayısı değişimi */}
      <div className="gb-satir-ozet">
        <span>Satır sayısı:</span>
        <span className="gb-sayi">{rapor.satirDegisimi.onceki}</span>
        <span className="gb-ok">→</span>
        <span className="gb-sayi">{rapor.satirDegisimi.sonraki}</span>
        <YonSimge yon={rapor.satirDegisimi.yon} deger={rapor.satirDegisimi.fark} />
      </div>

      {/* Kolon etkileri */}
      {rapor.kolonEtkileri.length > 0 && (
        <>
          <div className="bolum-baslik gb-bolum">Kolon bazında etkiler</div>
          <div className="tablo-sarici">
            <table className="gb-tablo">
              <thead>
                <tr>
                  <th>Kolon</th>
                  <th className="sayi">Önce</th>
                  <th className="sayi">Sonra</th>
                  <th className="sayi">Fark</th>
                  <th className="sayi">Değişim</th>
                </tr>
              </thead>
              <tbody>
                {rapor.kolonEtkileri.map((ke) => (
                  <tr key={ke.kolon}>
                    <td>{ke.kolon}</td>
                    <td className="sayi gb-taban">
                      {ke.onceki != null ? ke.onceki.toLocaleString("tr-TR") : "—"}
                    </td>
                    <td className="sayi gb-taban">
                      {ke.sonraki != null ? ke.sonraki.toLocaleString("tr-TR") : "—"}
                    </td>
                    <td className="sayi"><YonSimge yon={ke.yon} deger={ke.fark} /></td>
                    <td className="sayi"><YuzdeBadge yuzde={ke.yuzde} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Satır karşılaştırmaları */}
      {rapor.satirKarsilastirmalari.length > 0 && (
        <>
          <div className="bolum-baslik gb-bolum">Satır bazında değişimler</div>
          <div className="tablo-sarici">
            <table className="gb-tablo">
              <thead>
                <tr>
                  <th>Anahtar</th>
                  <th>Kolon</th>
                  <th className="sayi">Önceki</th>
                  <th className="sayi">Sonraki</th>
                  <th className="sayi">Değişim</th>
                </tr>
              </thead>
              <tbody>
                {rapor.satirKarsilastirmalari.flatMap((sk) =>
                  sk.degisimler.length > 0
                    ? sk.degisimler.map((d, i) => (
                        <tr key={`${sk.anahtar}-${d.kolon}`}>
                          {i === 0 && (
                            <td rowSpan={sk.degisimler.length} className="gb-anahtar">
                              {sk.anahtar}
                            </td>
                          )}
                          <td>{d.kolon}</td>
                          <td className="sayi gb-onceki">
                            {d.onceki === null ? "—" : String(d.onceki)}
                          </td>
                          <td className="sayi gb-sonraki">
                            {d.sonraki === null ? "—" : String(d.sonraki)}
                          </td>
                          <td className="sayi"><YuzdeBadge yuzde={d.yuzde} /></td>
                        </tr>
                      ))
                    : [
                        <tr key={sk.anahtar}>
                          <td className="gb-anahtar">{sk.anahtar}</td>
                          <td colSpan={4} className="gb-yeni">
                            {sk.degisimler.length === 0 ? "Yeni eklenen / kaybolan satır" : ""}
                          </td>
                        </tr>,
                      ]
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rapor.kolonEtkileri.length === 0 && rapor.satirKarsilastirmalari.length === 0 && (
        <div className="alt-bilgi">Sayısal değişim tespit edilemedi.</div>
      )}

      <div className="alt-bilgi">
        Önceki: {new Date(rapor.onceZaman).toLocaleString("tr-TR")} ·
        Sonraki: {new Date(rapor.sonraZaman).toLocaleString("tr-TR")}
      </div>
    </div>
  );
}

export function GeriBesleme() {
  const [kayitlar, setKayitlar] = useState<GBKayit[]>([]);
  const [mesgul, setMesgul] = useState(false);
  const [calisan, setCalisan] = useState<string | null>(null);
  const [durum, setDurum] = useState("");
  const [sonuclar, setSonuclar] = useState<EtkiSonuc[]>([]);
  const [uyarilar, setUyarilar] = useState<string[]>([]);
  const [hata, setHata] = useState("");

  async function yukle() {
    try {
      const r = await fetch("/api/geribesleme");
      const g = await r.json();
      setKayitlar(g.kayitlar ?? []);
    } catch (e) {
      setHata("Kayıtlar yüklenemedi.");
    }
  }

  useEffect(() => { void yukle(); }, []);

  async function olc(denetimId: string) {
    setMesgul(true);
    setCalisan(denetimId);
    setDurum("Geri besleme döngüsü başlatılıyor…");
    setSonuclar([]);
    setUyarilar([]);
    setHata("");

    try {
      const r = await fetch("/api/geribesleme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denetimId }),
      });
      if (!r.ok || !r.body) { setHata("İstek başarısız."); return; }

      const okuyucu = r.body.getReader();
      const cozucu = new TextDecoder();
      let tampon = "";

      for (;;) {
        const { done, value } = await okuyucu.read();
        if (done) break;
        tampon += cozucu.decode(value, { stream: true });

        const parcalar = tampon.split("\n\n");
        tampon = parcalar.pop() ?? "";
        for (const p of parcalar) {
          const satir = p.trim();
          if (!satir.startsWith("data:")) continue;
          olayIsle(JSON.parse(satir.slice(5).trim()));
        }
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      setMesgul(false);
      setCalisan(null);
      setDurum("");
      void yukle();
    }
  }

  function olayIsle(k: any) {
    switch (k.tur) {
      case "basladi":
        setDurum(`"${k.islemAdi}" için ölçümler çalıştırılıyor…`);
        break;
      case "once_tamam":
        setDurum("Önceki snapshot hazır. Yeniden ölçüm yapılıyor…");
        break;
      case "sonra_basladi":
        setDurum(`${k.soru} — yeniden sorgulanıyor…`);
        break;
      case "sonra_tamam":
        setDurum("Sonraki snapshot hazır. Etki hesaplanıyor…");
        break;
      case "etki":
        setSonuclar((o) => [...o, { dugumId: k.dugumId, baslik: k.baslik, rapor: k.rapor }]);
        break;
      case "uyari":
        setUyarilar((o) => [...o, k.mesaj]);
        break;
      case "hata":
        setHata(k.mesaj);
        break;
      case "bitti":
        setDurum(`Tamamlandı (${Math.round(k.toplamSure / 1000)} sn)`);
        break;
    }
  }

  return (
    <div className="kart">
      <div className="bolum-baslik">Geri besleme döngüsü</div>
      <p className="agac-aciklama">
        Uygulanan aksiyonların KPI etkisini ölçer. Aynı ölçüm sorguları yeniden
        çalıştırılır, önceki ve sonraki değerler karşılaştırılır.
      </p>

      {hata && <div className="kart hata">{hata}</div>}
      {durum && <div className="kart bekliyor">{durum}</div>}

      {uyarilar.map((u, i) => (
        <div key={i} className="gb-uyari">{u}</div>
      ))}

      {kayitlar.length === 0 ? (
        <div className="alt-bilgi">
          Henüz uygulanmış işlem yok. İşlemler sekmesinden bir aksiyon uygulayın.
        </div>
      ) : (
        <table className="denetim-tablo">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>İşlem</th>
              <th>Özet</th>
              <th>Durum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {kayitlar.map((k) => (
              <tr key={k.id}>
                <td>{new Date(k.olusturma).toLocaleString("tr-TR")}</td>
                <td>{k.islemAdi}</td>
                <td>{k.provaOzet ?? "—"}</td>
                <td>
                  {k.sonraVar
                    ? <span className="durum d-uygulandi">Ölçüldü</span>
                    : k.onceVar
                    ? <span className="durum d-oneri">Referans var</span>
                    : <span className="durum gb-durum-yeni">Yeni</span>
                  }
                </td>
                <td>
                  <button
                    type="button"
                    className="kucuk gb-olc-btn"
                    disabled={mesgul}
                    onClick={() => void olc(k.id)}
                  >
                    {calisan === k.id ? "Çalışıyor…" : "Etkisini ölç"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sonuclar.map((s) => (
        <EtkiKarti key={s.dugumId} sonuc={s} />
      ))}
    </div>
  );
}
