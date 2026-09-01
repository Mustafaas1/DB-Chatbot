"use client";

import { useEffect, useState } from "react";

interface Degisiklik { kimlik: string; alan: string; onceki: string; sonraki: string; }
interface Prova { ozet: string; etkilenen: number; degisiklikler: Degisiklik[]; uyarilar: string[]; }
interface IslemBilgisi { kod: string; ad: string; aciklama: string; hedefTablo: string; }
interface Kayit {
  id: string; islemAdi: string; hedefTablo: string; durum: string;
  prova: Prova | null; onaylayan: string | null; hata: string | null; olusturma: string;
}
interface Oneri {
  kayitId: string; islemAdi: string; hedefTablo: string;
  prova: Prova; onaylanabilir: boolean; yalnizcaProva: boolean;
}

const DURUM_ETIKET: Record<string, string> = {
  oneri: "Onay bekliyor", onaylandi: "Onaylandı", uygulandi: "Uygulandı",
  reddedildi: "Reddedildi", geri_alindi: "Geri alındı", basarisiz: "Başarısız",
};

export function Islemler() {
  const [islemler, setIslemler] = useState<IslemBilgisi[]>([]);
  const [kayitlar, setKayitlar] = useState<Kayit[]>([]);
  const [yazmaAcik, setYazmaAcik] = useState(true);
  const [secili, setSecili] = useState("");
  const [biletNo, setBiletNo] = useState("");
  const [deger, setDeger] = useState("");
  const [oneri, setOneri] = useState<Oneri | null>(null);
  const [onaylayan, setOnaylayan] = useState("");
  const [hata, setHata] = useState("");
  const [mesgul, setMesgul] = useState(false);

  async function yukle() {
    const r = await fetch("/api/islem");
    const g = await r.json();
    setIslemler(g.islemler); setKayitlar(g.kayitlar); setYazmaAcik(g.yazmaAcik);
    if (!secili && g.islemler[0]) setSecili(g.islemler[0].kod);
  }
  useEffect(() => { void yukle(); }, []);

  async function gonder(govde: Record<string, unknown>) {
    setMesgul(true); setHata("");
    try {
      const r = await fetch("/api/islem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(govde),
      });
      const g = await r.json();
      if (!r.ok) { setHata(g.hata ?? "İstek başarısız."); return null; }
      return g;
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı."); return null;
    } finally { setMesgul(false); await yukle(); }
  }

  const asamaMi = secili === "bilet_asama_degistir";

  return (
    <div className="kart">
      <div className="bolum-baslik">Yazma işlemleri</div>

      {!yazmaAcik && (
        <div className="olcum-bos">
          Yazma yapılandırılmamış. Sistem şu an yalnızca <strong>prova</strong>
          {" "}yapabilir; hiçbir değişiklik uygulanmaz.
          {" "}<code>sql/f5_yazma.sql</code> çalıştırılmalı.
        </div>
      )}

      <p className="agac-aciklama">
        Yapay zeka SQL yazmaz. Yalnızca aşağıdaki tanımlı işlemleri önerebilir,
        her biri <strong>insan onayı</strong> ister ve geri alınabilir.
      </p>

      <div className="islem-form">
        <select value={secili} onChange={(e) => { setSecili(e.target.value); setOneri(null); }}>
          {islemler.map((i) => <option key={i.kod} value={i.kod}>{i.ad}</option>)}
        </select>
        <input type="text" placeholder="Bilet no"
          value={biletNo} onChange={(e) => setBiletNo(e.target.value)} />
        {asamaMi ? (
          <select value={deger} onChange={(e) => setDeger(e.target.value)}>
            <option value="">Aşama seçin…</option>
            <option value="Beklemede">Beklemede</option>
            <option value="İşlemde">İşlemde</option>
            <option value="Tamamlandı">Tamamlandı</option>
          </select>
        ) : (
          <input type="text" placeholder="Atanacak kişi"
            value={deger} onChange={(e) => setDeger(e.target.value)} />
        )}
        <button type="button" disabled={mesgul || !biletNo || !deger}
          onClick={async () => {
            const g = await gonder({
              eylem: "oner", islemKodu: secili,
              parametreler: asamaMi ? { biletNo, asama: deger } : { biletNo, kisi: deger },
            });
            if (g) setOneri(g);
          }}>Provayı gör</button>
      </div>

      {hata && <div className="kart hata">{hata}</div>}

      {oneri && (
        <div className="prova-kutu">
          <div className="prova-ozet">{oneri.prova.ozet}</div>
          {oneri.prova.uyarilar.map((u, i) => <div key={i} className="prova-uyari">{u}</div>)}

          {oneri.prova.degisiklikler.length > 0 && (
            <table className="prova-tablo">
              <thead><tr><th>Kayıt</th><th>Alan</th><th>Önceki</th><th>Sonraki</th></tr></thead>
              <tbody>{oneri.prova.degisiklikler.map((d, i) => (
                <tr key={i}>
                  <td>{d.kimlik}</td><td>{d.alan}</td>
                  <td className="onceki">{d.onceki}</td><td className="sonraki">{d.sonraki}</td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {oneri.onaylanabilir && (
            <div className="onay-satir">
              <input type="text" placeholder="Onaylayan (adınız)"
                value={onaylayan} onChange={(e) => setOnaylayan(e.target.value)} />
              <button type="button" className="onayla"
                disabled={mesgul || !onaylayan.trim() || oneri.yalnizcaProva}
                onClick={async () => {
                  if (await gonder({ eylem: "uygula", kayitId: oneri.kayitId, onaylayan })) setOneri(null);
                }}>Onayla ve uygula</button>
              <button type="button" disabled={mesgul || !onaylayan.trim()}
                onClick={async () => {
                  if (await gonder({ eylem: "reddet", kayitId: oneri.kayitId, onaylayan })) setOneri(null);
                }}>Reddet</button>
            </div>
          )}
        </div>
      )}

      <div className="bolum-baslik denetim-baslik">Denetim kaydı</div>
      {kayitlar.length === 0 ? (
        <div className="alt-bilgi">Henüz işlem yok.</div>
      ) : (
        <table className="denetim-tablo">
          <thead><tr>
            <th>Zaman</th><th>İşlem</th><th>Özet</th><th>Durum</th><th>Onaylayan</th><th></th>
          </tr></thead>
          <tbody>{kayitlar.map((k) => (
            <tr key={k.id}>
              <td>{new Date(k.olusturma).toLocaleString("tr-TR")}</td>
              <td>{k.islemAdi}</td>
              <td>{k.hata ?? k.prova?.ozet ?? "—"}</td>
              <td><span className={`durum d-${k.durum}`}>{DURUM_ETIKET[k.durum] ?? k.durum}</span></td>
              <td>{k.onaylayan ?? "—"}</td>
              <td>
                {k.durum === "uygulandi" && (
                  <button type="button" className="kucuk" disabled={mesgul || !onaylayan.trim()}
                    onClick={() => void gonder({ eylem: "geri_al", kayitId: k.id, onaylayan })}>
                    Geri al
                  </button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
