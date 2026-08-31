/**
 * Etki hesaplama motoru.
 *
 * LLM KULLANMAZ — tamamen deterministik. Iki OlcumSnapshot'i
 * karsilastirir ve EtkiRaporu uretir.
 *
 * Sayisal kolonlar icin fark ve yuzde degisim, kategorik kolonlar
 * icin eklenen/kaybolan degerler hesaplanir.
 */

import type { EtkiRaporu, KolonEtkisi, OlcumSnapshot, SatirKarsilastirma } from "./tipler";

/** Bir deger sayisal mi? */
function sayisalMi(d: unknown): d is number {
  return typeof d === "number" && Number.isFinite(d);
}

/** Kolon indekslerinin hangilerinin sayisal oldugunu belirler. */
function sayisalKolonlar(satirlar: unknown[][], kolonSayisi: number): boolean[] {
  const sonuc = Array.from({ length: kolonSayisi }, () => true);
  for (const satir of satirlar) {
    for (let i = 0; i < kolonSayisi; i++) {
      if (!sayisalMi(satir[i])) sonuc[i] = false;
    }
  }
  return sonuc;
}

/** Kolon bazinda toplamlar. */
function kolonToplamlari(satirlar: unknown[][], kolonSayisi: number): (number | null)[] {
  const toplamlar: (number | null)[] = Array.from({ length: kolonSayisi }, () => null);
  for (const satir of satirlar) {
    for (let i = 0; i < kolonSayisi; i++) {
      const d = satir[i];
      if (sayisalMi(d)) {
        toplamlar[i] = (toplamlar[i] ?? 0) + d;
      }
    }
  }
  return toplamlar;
}

function yon(fark: number): "artis" | "azalis" | "ayni" {
  if (fark > 0) return "artis";
  if (fark < 0) return "azalis";
  return "ayni";
}

function yuzdeHesapla(onceki: number, sonraki: number): number | null {
  if (onceki === 0) return sonraki === 0 ? 0 : null;
  return Math.round(((sonraki - onceki) / Math.abs(onceki)) * 10000) / 100;
}

/**
 * Iki snapshot arasindaki kolon bazli etkileri hesaplar.
 *
 * Yalnizca HER IKI tarafta da var olan ve SAYISAL olan kolonlara bakar.
 * Kolon adlari eslesmelidir; sirasi farkli olabilir.
 */
function kolonEtkileriHesapla(
  onceKolonlar: string[],
  onceToplamlar: (number | null)[],
  sonraKolonlar: string[],
  sonraToplamlar: (number | null)[]
): KolonEtkisi[] {
  const etkiler: KolonEtkisi[] = [];

  for (let i = 0; i < onceKolonlar.length; i++) {
    const kolon = onceKolonlar[i]!;
    const j = sonraKolonlar.indexOf(kolon);
    if (j === -1) continue;

    const o = onceToplamlar[i];
    const s = sonraToplamlar[j];

    if (o === null && s === null) continue;

    const onceDeger = o ?? 0;
    const sonraDeger = s ?? 0;
    const fark = Math.round((sonraDeger - onceDeger) * 100) / 100;
    const yuzde = yuzdeHesapla(onceDeger, sonraDeger);

    etkiler.push({
      kolon,
      onceki: o ?? null,
      sonraki: s ?? null,
      fark,
      yuzde,
      yon: fark !== 0 ? yon(fark) : "ayni",
    });
  }

  return etkiler;
}

/**
 * Satir bazinda karsilastirma.
 *
 * Ilk kolonu anahtar olarak kullanir (genelde kategori/durum kolonu).
 * Her iki tarafta ayni anahtar olan satirlari eslestirir.
 */
function satirKarsilastir(
  onceKolonlar: string[],
  onceSatirlar: unknown[][],
  sonraKolonlar: string[],
  sonraSatirlar: unknown[][]
): SatirKarsilastirma[] {
  if (!onceKolonlar.length || !sonraKolonlar.length) return [];

  // Ilk kolon anahtar
  const onceHarita = new Map<string, unknown[]>();
  for (const satir of onceSatirlar) {
    const anahtar = String(satir[0] ?? "");
    if (anahtar) onceHarita.set(anahtar, satir);
  }

  const sonraHarita = new Map<string, unknown[]>();
  for (const satir of sonraSatirlar) {
    const anahtar = String(satir[0] ?? "");
    if (anahtar) sonraHarita.set(anahtar, satir);
  }

  const tumAnahtarlar = new Set([...onceHarita.keys(), ...sonraHarita.keys()]);
  const karsilastirmalar: SatirKarsilastirma[] = [];

  for (const anahtar of tumAnahtarlar) {
    const onceSatir = onceHarita.get(anahtar);
    const sonraSatir = sonraHarita.get(anahtar);

    const degisimler: SatirKarsilastirma["degisimler"] = [];

    // Anahtar kolonu (ilk kolon) atla, kalanları karşılaştır
    for (let i = 1; i < Math.max(onceKolonlar.length, sonraKolonlar.length); i++) {
      const kolon = onceKolonlar[i] ?? sonraKolonlar[i];
      if (!kolon) continue;

      const onceki = onceSatir?.[i] ?? null;
      const sonraki = sonraSatir?.[i] ?? null;

      let fark: number | null = null;
      let yuzde: number | null = null;

      if (sayisalMi(onceki) && sayisalMi(sonraki)) {
        fark = Math.round((sonraki - onceki) * 100) / 100;
        yuzde = yuzdeHesapla(onceki, sonraki);
      } else if (sayisalMi(sonraki) && onceki === null) {
        fark = sonraki;
      } else if (sayisalMi(onceki) && sonraki === null) {
        fark = -onceki;
      }

      // Yalnizca degisen satirlari goster
      if (onceki !== sonraki) {
        degisimler.push({ kolon, onceki, sonraki, fark, yuzde });
      }
    }

    if (degisimler.length > 0 || !onceSatir || !sonraSatir) {
      karsilastirmalar.push({ anahtar, degisimler });
    }
  }

  return karsilastirmalar.slice(0, 20);
}

/**
 * Iki snapshot arasindaki tam etki raporunu uretir.
 */
export function etkiHesapla(
  once: OlcumSnapshot,
  sonra: OlcumSnapshot,
  gercekOnceMi: boolean
): EtkiRaporu {
  const satirDegisimi = {
    onceki: once.satirSayisi,
    sonraki: sonra.satirSayisi,
    fark: sonra.satirSayisi - once.satirSayisi,
    yon: yon(sonra.satirSayisi - once.satirSayisi),
  };

  const onceSayisal = sayisalKolonlar(once.satirlar, once.kolonlar.length);
  const sonraSayisal = sayisalKolonlar(sonra.satirlar, sonra.kolonlar.length);

  const onceToplamlar = kolonToplamlari(once.satirlar, once.kolonlar.length);
  const sonraToplamlar = kolonToplamlari(sonra.satirlar, sonra.kolonlar.length);

  // Yalnizca sayisal kolonlari filtrele
  const onceKolonlarFiltreli = once.kolonlar.filter((_, i) => onceSayisal[i]);
  const onceToplamlarFiltreli = onceToplamlar.filter((_, i) => onceSayisal[i]);
  const sonraKolonlarFiltreli = sonra.kolonlar.filter((_, i) => sonraSayisal[i]);
  const sonraToplamlarFiltreli = sonraToplamlar.filter((_, i) => sonraSayisal[i]);

  const kolonEtkileri = kolonEtkileriHesapla(
    onceKolonlarFiltreli, onceToplamlarFiltreli,
    sonraKolonlarFiltreli, sonraToplamlarFiltreli
  );

  const satirKarsilastirmalari = satirKarsilastir(
    once.kolonlar, once.satirlar,
    sonra.kolonlar, sonra.satirlar
  );

  return {
    satirDegisimi,
    kolonEtkileri,
    satirKarsilastirmalari,
    onceZaman: once.olusturma,
    sonraZaman: sonra.olusturma,
    gercekOnceMi,
  };
}
