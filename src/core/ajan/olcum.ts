import type { AracKaydi } from "../tools/kayit";
import type { Saglayici } from "../llm/tipler";
import { donguCalistir } from "./dongu";
import { sistemIstemi } from "./istem";
import type { Atama } from "./dagitici";
import { olcumuDogrula } from "../hedef/dogrula";
import { semaSozlugu, zeminKontrol } from "../hedef/zemin";
import type { Tablo } from "../db/sema";
import type { KolonDegerleri } from "../db/degerler";

export interface OlcumSonucu {
  dugumId: string;
  ajanKod: string;
  ajanAd: string;
  renk: string;
  baslik: string;
  soru: string;
  cevap: string;
  sql: string;
  kolonlar: string[];
  satirlar: unknown[][];
  satirSayisi: number;
  /** 0 satir donduren olcum: dugum muhtemelen olmayan bir seye atif yapiyor. */
  bosMu: boolean;
  /** Yonlendirme tahmine dayaliysa true. */
  belirsiz: boolean;
  sureMs: number;
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
}

export type OlcumOlayi =
  | { tur: "basladi"; dugumId: string; ajanKod: string; ajanAd: string; renk: string; baslik: string; belirsiz: boolean }
  | { tur: "bitti"; sonuc: OlcumSonucu }
  | { tur: "hata"; dugumId: string; ajanKod: string; baslik: string; mesaj: string }
  | { tur: "atlandi"; dugumId: string; baslik: string; sebep: string }
  | { tur: "gecersiz"; dugumId: string; baslik: string; soru: string; sebepler: string[] };

export interface OlcumSecenekleri {
  saglayici: Saglayici;
  kayit: AracKaydi;
  atamalar: Atama[];
  /** Ayni anda kac olcum. Groq ucretsiz katmani 8.000 TPM; olcum basina
   *  ~3.000 token oldugu icin 2'nin ustu 429 uretiyor. */
  esZamanli?: number;
  /** Kac olcum calistirilacak. Agac 12 olcum uretebiliyor; hepsini
   *  calistirmak gunluk kotayi tek soruda bitirir. */
  azamiOlcum?: number;
  /** Dogrulama icin sema ve gercek durum degerleri. Verilmezse dogrulama
   *  atlanir (davranis eskisi gibi olur). */
  tablolar?: Tablo[];
  degerler?: KolonDegerleri[];
}

/**
 * Olcumleri SINIRLI paralellikle calistirir ve bittikce yayinlar.
 *
 * Tam paralel calistirmak ilk denemede 429 uretiyordu; sinir kotadan
 * geliyor, tasarimdan degil. Bittikce yayinlamak beklemeyi gizlemiyor
 * ama gorunur kiliyor: kullanici ilk sonucu digerleri surerken goruyor.
 */
export async function* olcumleriCalistir(
  s: OlcumSecenekleri
): AsyncGenerator<OlcumOlayi> {
  const esZamanli = Math.max(1, s.esZamanli ?? 2);
  const azami = s.azamiOlcum ?? 4;

  // ONCE DOGRULA, sonra butceyi harca. Model istemde gercek degerler
  // olmasina ragmen olmayan deger uretebiliyor (Asama='Kapalı',
  // Oncelik='Yuksek'); bunlar ~40 sn ve ~3.000 token harcayip bos
  // donuyordu. Calistirmadan once eleniyorlar.
  const gecerliler: Atama[] = [];
  const gecersizOlaylar: OlcumOlayi[] = [];

  const sozluk = s.tablolar?.length ? semaSozlugu(s.tablolar) : null;

  for (const a of s.atamalar) {
    if (!s.tablolar?.length) { gecerliler.push(a); continue; }
    const metin = `${a.dugum.baslik} ${a.dugum.olcumSorusu ?? ""}`;
    const sebepler: string[] = [];

    // 1) ZEMIN: veride hic karsiligi olmayan kavram var mi
    //    ("SSS makale", "chatbot"). Bunlar 22-34 sn harcayip anlamsiz
    //    donuyordu.
    if (sozluk) {
      const z = zeminKontrol(metin, sozluk);
      if (!z.zeminli) sebepler.push(z.sebep);
    }

    // 2) DEGER/TIP: olmayan durum degeri ya da sayisal kolon-metin
    //    karsilastirmasi.
    if (s.degerler?.length) {
      const d = olcumuDogrula(metin, s.tablolar, s.degerler);
      if (!d.gecerli) sebepler.push(...d.gecersizlikler.map((g) => g.mesaj));
    }

    if (!sebepler.length) gecerliler.push(a);
    else gecersizOlaylar.push({
      tur: "gecersiz", dugumId: a.dugum.id, baslik: a.dugum.baslik,
      soru: a.dugum.olcumSorusu ?? a.dugum.baslik,
      sebepler,
    });
  }
  for (const o of gecersizOlaylar) yield o;

  const calisacak = gecerliler.slice(0, azami);
  for (const atlanan of gecerliler.slice(azami)) {
    yield {
      tur: "atlandi",
      dugumId: atlanan.dugum.id,
      baslik: atlanan.dugum.baslik,
      sebep: `Butce: ilk ${azami} olcum calistirildi`,
    };
  }

  // Sonuclari BITEN SIRAYLA yayinlamak icin basit bir kuyruk: her is
  // bittiginde olayi bir tampona koyar, generator tampondan okur.
  const bekleyen: Promise<OlcumOlayi[]>[] = [];
  let sonraki = 0;

  const isBaslat = (): Promise<OlcumOlayi[]> | null => {
    if (sonraki >= calisacak.length) return null;
    const atama = calisacak[sonraki++]!;
    return tekOlcum(s, atama);
  };

  for (let i = 0; i < esZamanli; i++) {
    const p = isBaslat();
    if (p) bekleyen.push(p);
  }

  while (bekleyen.length) {
    // Ilk biteni al; sirasi degil BITISI onemli.
    const kazanan = await Promise.race(
      bekleyen.map((p, i) => p.then((o) => ({ i, o })))
    );
    bekleyen.splice(kazanan.i, 1);
    for (const olay of kazanan.o) yield olay;

    const yeni = isBaslat();
    if (yeni) bekleyen.push(yeni);
  }
}

async function tekOlcum(s: OlcumSecenekleri, atama: Atama): Promise<OlcumOlayi[]> {
  const { dugum, ajan } = atama;
  const soru = dugum.olcumSorusu || dugum.baslik;
  const baslangic: OlcumOlayi = {
    tur: "basladi", dugumId: dugum.id, ajanKod: ajan.kod,
    ajanAd: ajan.ad, renk: ajan.renk, baslik: dugum.baslik,
    belirsiz: atama.belirsiz,
  };

  const t0 = Date.now();
  try {
    const istem = await sistemIstemi(soru, ajan.tablolar);
    const sonuc = await donguCalistir({
      saglayici: s.saglayici,
      kayit: s.kayit,
      baglam: { izId: dugum.id, provaMi: false },
      sistemIstemi: istem,
      soru,
      azamiTur: 2,
    });

    const sonAdim = [...sonuc.adimlar].reverse().find((a) => a.ok);
    let kolonlar: string[] = [];
    let satirlar: unknown[][] = [];
    let sql = "";
    if (sonAdim) {
      sql = (sonAdim.girdi as { sorgu?: string })?.sorgu ?? "";
      try {
        const c = JSON.parse(sonAdim.ozet);
        if (Array.isArray(c?.kolonlar)) kolonlar = c.kolonlar;
        if (Array.isArray(c?.satirlar)) satirlar = c.satirlar;
      } catch { /* tablo yoksa sorun degil */ }
    }

    return [baslangic, {
      tur: "bitti",
      sonuc: {
        dugumId: dugum.id, ajanKod: ajan.kod, ajanAd: ajan.ad, renk: ajan.renk,
        baslik: dugum.baslik, soru, cevap: sonuc.cevap, sql,
        kolonlar, satirlar, satirSayisi: satirlar.length,
        bosMu: satirlar.length === 0,
        belirsiz: atama.belirsiz,
        sureMs: Date.now() - t0,
        kullanim: sonuc.kullanim,
      },
    }];
  } catch (e) {
    return [baslangic, {
      tur: "hata", dugumId: dugum.id, ajanKod: ajan.kod, baslik: dugum.baslik,
      mesaj: e instanceof Error ? e.message : String(e),
    }];
  }
}
