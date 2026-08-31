import type { Ajan } from "./ajanlar";
import { AJANLAR } from "./ajanlar";
import type { HedefDugumu } from "../hedef/tipler";

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

function puanla(ajan: Ajan, metin: string): number {
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

  return p;
}

export interface Atama {
  dugum: HedefDugumu;
  ajan: Ajan;
  /** 0 ise hicbir sinyal yok; varsayilan ajana dusuldu. */
  puan: number;
}

/** Varsayilan: hicbir ipucu yoksa destek (en kalabalik veri kumesi). */
const VARSAYILAN = AJANLAR.find((a) => a.kod === "destek") ?? AJANLAR[0]!;

export function dagit(dugumler: HedefDugumu[]): Atama[] {
  return dugumler.map((d) => {
    const metin = normalize(`${d.baslik} ${d.olcumSorusu ?? ""} ${d.gerekce}`);
    let enIyi = VARSAYILAN;
    let enYuksek = 0;

    for (const a of AJANLAR) {
      const p = puanla(a, metin);
      if (p > enYuksek) { enYuksek = p; enIyi = a; }
    }
    return { dugum: d, ajan: enIyi, puan: enYuksek };
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
