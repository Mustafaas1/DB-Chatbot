import type { Ajan } from "./ajanlar";
import { AJANLAR } from "./ajanlar";
import type { HedefDugumu } from "../hedef/tipler";
import type { Tablo } from "../db/sema";

/**
 * Olcum dugumlerini bolum ajanlarina dagitir.
 *
 * LLM'e sormuyoruz: dagitim metinden deterministik olarak cikarilabilir ve
 * her cagri ucretsiz katmanda degerli. Bu oturumun tekrar eden dersi --
 * belirleyici olmasi gereken sey koda ait.
 */

/** Turkce terimleri ajan koduna baglar. */
const IPUCLARI: Record<string, string[]> = {
  satis: ["teklif", "firsat", "musteri", "urun", "satis", "kazan", "kaybed", "temsilci"],
  destek: ["bilet", "destek", "ticket", "asama", "kanal", "cozum suresi", "atanan"],
  finans: ["fatura", "tutar", "para birimi", "ciro", "gelir", "sozlesme", "odeme", "maliyet"],
  proje: ["proje", "gorev", "kanban", "is paketi", "teslim", "milestone"],
  ik: ["izin", "personel", "calisan", "mesai", "devam", "vardiya", "takvim", "egitim"],
};

function normalize(metin: string): string {
  return metin
    .toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");
}

function puanla(ajan: Ajan, metin: string, kolonlar?: Map<string, string[]>): number {
  let p = 0;

  // 1) Tablo adi dogrudan geciyorsa en guclu sinyal: olcum sorusu cogu
  //    zaman tabloyu adiyla aniyor ("TicketRecords tablosunda ...").
  for (const t of ajan.tablolar) {
    if (metin.includes(normalize(t))) p += 12;
  }

  // 2) Terim ipuclari.
  for (const ip of IPUCLARI[ajan.kod] ?? []) {
    if (metin.includes(ip)) p += 5;
  }

  // 3) Ajanin tablolarindaki KOLON adlari. Olcumlerin cogu tablo adini
  //    anmiyor ama kolon adini aniyor ("Kanal bazinda", "AtananKisi").
  //    Bu olmadan olcumlerin cogu puan=0 alip sessizce varsayilana
  //    dusuyordu.
  for (const k of kolonlar?.get(ajan.kod) ?? []) {
    if (metin.includes(k)) p += 3;
  }

  return p;
}

/** Ajan kodu -> o ajanin tablolarindaki ayirt edici kolon adlari. */
function kolonSozlugu(tablolar: Tablo[]): Map<string, string[]> {
  const tabloHarita = new Map(tablolar.map((t) => [t.ad, t]));
  const harita = new Map<string, string[]>();

  // Birden fazla ajanda gecen kolonlar ayirt edici degil (Id, Durum...).
  const sayac = new Map<string, number>();
  for (const a of AJANLAR) {
    const kume = new Set<string>();
    for (const ad of a.tablolar) {
      for (const k of tabloHarita.get(ad)?.kolonlar ?? []) {
        const n = normalize(k.ad);
        if (n.length >= 5) kume.add(n);
      }
    }
    for (const k of kume) sayac.set(k, (sayac.get(k) ?? 0) + 1);
  }

  for (const a of AJANLAR) {
    const kume = new Set<string>();
    for (const ad of a.tablolar) {
      for (const k of tabloHarita.get(ad)?.kolonlar ?? []) {
        const n = normalize(k.ad);
        if (n.length >= 5 && sayac.get(n) === 1) kume.add(n);
      }
    }
    harita.set(a.kod, [...kume]);
  }
  return harita;
}

export interface Atama {
  dugum: HedefDugumu;
  ajan: Ajan;
  /** 0 ise hicbir sinyal yok; varsayilan ajana dusuldu. */
  puan: number;
  /**
   * Yonlendirme tahmine dayali mi.
   *
   * Sessizce varsayilana dusmek belirsizligi gizliyordu: kullanici
   * olcumun o ajana AIT oldugunu saniyor. Artik arayuzde isaretli.
   */
  belirsiz: boolean;
}

/** Varsayilan: hicbir ipucu yoksa destek (en kalabalik veri kumesi). */
const VARSAYILAN = AJANLAR.find((a) => a.kod === "destek") ?? AJANLAR[0]!;

export function dagit(dugumler: HedefDugumu[], tablolar?: Tablo[]): Atama[] {
  const kolonlar = tablolar?.length ? kolonSozlugu(tablolar) : undefined;

  return dugumler.map((d) => {
    // GEREKCE YONLENDIRMEYE KATILMAZ.
    // Gerekce "neden bu olcume bakiyoruz" diye UST dugumun alanini
    // anlatiyor; yonlendirmeyi yanlis ajana cekiyordu. Ornek: destek
    // biletiyle ilgili bir olcum, gerekcesinde "teklif kazanma orani"
    // gectigi icin Satis Ajanina gidiyordu.
    const metin = normalize(`${d.baslik} ${d.olcumSorusu ?? ""}`);
    let enIyi = VARSAYILAN;
    let enYuksek = 0;

    for (const a of AJANLAR) {
      const p = puanla(a, metin, kolonlar);
      if (p > enYuksek) { enYuksek = p; enIyi = a; }
    }
    return { dugum: d, ajan: enIyi, puan: enYuksek, belirsiz: enYuksek === 0 };
  });
}

/** Atamalari ajana gore gruplar; sekmeli arayuz bunu kullanir. */
export function ajanaGoreGrupla(atamalar: Atama[]): Map<string, Atama[]> {
  const harita = new Map<string, Atama[]>();
  for (const a of atamalar) {
    const mevcut = harita.get(a.ajan.kod);
    if (mevcut) mevcut.push(a);
    else harita.set(a.ajan.kod, [a]);
  }
  return harita;
}
