import type { Tablo } from "./sema";

/**
 * Soruya gore ILGILI tablolari secer.
 *
 * Neden gerekli: tum semayi (66 tablo, ~5.000 token) her istege koymak
 * Groq ucretsiz katmaninin 8.000 TPM sinirini tek soruda asiyordu
 * (413 Request too large). Secim bir optimizasyon degil, calisma sarti.
 *
 * Strateji "dizin + ayrinti":
 *   - TUM tablo adlari her zaman gonderilir (~250 token). Model neyin var
 *     oldugunu bilir; yanlis secim yapsak bile adini gorup isteyebilir.
 *   - Yalnizca ILGILI tablolarin kolonlari yazilir.
 */

/** Turkce sorularin tablo adlariyla eslesmesi icin sozluk. */
const ESLESTIRME: Record<string, string[]> = {
  bilet: ["ticket"], destek: ["ticket"], talep: ["ticket", "leave"],
  teklif: ["teklif", "opportunity"], firsat: ["opportunity"],
  musteri: ["contact", "customer", "cari"], kisi: ["contact"], ilgili: ["contact"],
  fatura: ["invoice"], odeme: ["invoice", "payment"], tutar: ["invoice", "teklif"],
  sozlesme: ["contract"], kontrat: ["contract"],
  proje: ["project", "kanban"], gorev: ["task", "kanban"], is: ["task", "project"],
  izin: ["leave"], calisan: ["employee", "personel", "attendance"],
  personel: ["employee", "personel", "attendance"], mesai: ["attendance"],
  devam: ["attendance"], vardiya: ["duty", "schedule"],
  takvim: ["calendar"], etkinlik: ["calendar", "event"], toplanti: ["calendar"],
  urun: ["product"], stok: ["product"],
};

function kelimeler(soru: string): string[] {
  return soru
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((k) => k.length >= 3);
}

/** Turkce ekleri kabaca atar: "biletleri" -> "bilet" ile eslessin. */
function kok(kelime: string): string {
  return kelime.length > 5 ? kelime.slice(0, Math.max(4, kelime.length - 3)) : kelime;
}

function puan(tablo: Tablo, sorguKelimeleri: string[]): number {
  const ad = tablo.ad.toLowerCase();
  let p = 0;

  for (const k of sorguKelimeleri) {
    const s = kok(k);
    if (ad.includes(s)) p += 10;

    for (const [tr, ingListesi] of Object.entries(ESLESTIRME)) {
      if (!tr.startsWith(s) && !s.startsWith(tr.slice(0, 4))) continue;
      for (const ing of ingListesi) if (ad.includes(ing)) p += 8;
    }
  }

  // Esitlikte buyuk tabloyu tercih et: bos yardimci tablolar geride kalsin.
  if (p > 0) p += Math.min(3, Math.log10(tablo.satirSayisi + 1));
  return p;
}

export interface KapsamSecimi {
  secilen: Tablo[];
  tumAdlar: string[];
}

export function kapsamSec(soru: string, tablolar: Tablo[], azami = 6): KapsamSecimi {
  const kelime = kelimeler(soru);
  const puanli = tablolar
    .map((t) => ({ t, p: puan(t, kelime) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p);

  // Hicbir sey eslesmezse en kalabalik tablolari ver: bos donmektense
  // modele calisilabilir bir baslangic sun.
  const secilen = puanli.length
    ? puanli.slice(0, azami).map((x) => x.t)
    : [...tablolar].sort((a, b) => b.satirSayisi - a.satirSayisi).slice(0, azami);

  return { secilen, tumAdlar: tablolar.map((t) => t.ad) };
}
