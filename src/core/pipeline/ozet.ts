/**
 * Liste sonucundan OZET cikarir.
 *
 * Kabul senaryosu "musteri listesi + ozet (adet, ciro, ortalama sepet,
 * tekrar orani)" istiyor. Bu sayilari modele HESAPLATMIYORUZ: satirlar
 * elimizde, aritmetik kodda yapiliyor. Modelin toplam/ortalama uydurdugu
 * bu projede defalarca goruldu.
 *
 * Kolonlar isme gore degil TIPE gore secilir; soru her alanda ayni
 * kolon adlarini kullanmiyor.
 */

export interface SummaryMeasure {
  etiket: string;
  deger: number;
  /** Para birimi gibi bir kirilim varsa. */
  kirilim?: string;
}

export interface ListSummary {
  rowCount: number;
  /** Benzersiz varlik sayisi (ilk metin kolonu; ornegin musteri adi). */
  entityColumn: string | null;
  uniqueEntities: number;
  /** Birden fazla kez gecen varliklarin orani; "tekrar orani". */
  repeatRate: number | null;
  repeating: number;
  /** Sayisal kolonlarin toplam ve ortalamasi. */
  measures: SummaryMeasure[];
  /** Ozetin okunabilir tek cumlelik hali. */
  cumle: string;
}

const PARA_KOLON = /para\s*birim|currency|kur/i;
/** "Adet", "Sayi", "Fatura Sayisi", "Satin Alma Adedi" gibi sayac kolonlari. */
const ADET_KOLON = /adet|adedi|say[iı]s[iı]|toNumber|count|islem\s*say/i;

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Cogunlugu sayi olan kolonlarin indeksleri. */
function numericColumns(satirlar: unknown[][], kolonSayisi: number): number[] {
  const sonuc: number[] = [];
  for (let i = 0; i < kolonSayisi; i++) {
    const dolu = satirlar.filter((s) => s[i] != null);
    if (dolu.length && dolu.every((s) => isNumber(s[i]))) sonuc.push(i);
  }
  return sonuc;
}

/** Ilk metin kolonu: varlik (musteri, urun, kisi) genelde budur. */
function textColumn(satirlar: unknown[][], kolonSayisi: number): number {
  for (let i = 0; i < kolonSayisi; i++) {
    const dolu = satirlar.filter((s) => s[i] != null);
    if (dolu.length && dolu.every((s) => typeof s[i] === "string")) return i;
  }
  return -1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summarizeList(kolonlar: string[], satirlar: unknown[][]): ListSummary {
  const bos: ListSummary = {
    rowCount: 0, entityColumn: null, uniqueEntities: 0,
    repeatRate: null, repeating: 0, measures: [],
    cumle: "Sonuç boş; özetlenecek satır yok.",
  };
  if (!satirlar.length || !kolonlar.length) return bos;

  const vi = textColumn(satirlar, kolonlar.length);
  const si = numericColumns(satirlar, kolonlar.length);

  // Para birimi kolonu varsa olculeri ONA GORE kiriyoruz. Farkli
  // birimleri tek toplamda birlestirmek anlamsiz bir sayi uretir.
  const pi = kolonlar.findIndex((k) => PARA_KOLON.test(k));

  // Sonuc GRUPLANMIS gelebilir: her varlik tek satir, adet ayri kolonda.
  // O durumda satir tekrarina bakmak "tekrar orani %0" gibi yanlis bir
  // sonuc veriyordu; adet kolonundan okumak gerekiyor.
  const ai = kolonlar.findIndex((k) => ADET_KOLON.test(k));

  let benzersiz = 0;
  let repeating = 0;
  if (vi >= 0) {
    const sayac = new Map<string, number>();
    for (const s of satirlar) {
      const a = String(s[vi]);
      // Adet kolonu varsa ve satirlar gruplanmissa gercek adedi kullan.
      const artis = ai >= 0 && isNumber(s[ai]) ? s[ai] : 1;
      sayac.set(a, (sayac.get(a) ?? 0) + artis);
    }
    benzersiz = sayac.size;
    repeating = [...sayac.values()].filter((n) => n > 1).length;
  }

  const measures: SummaryMeasure[] = [];
  for (const i of si) {
    if (i === vi) continue;
    const gruplar = new Map<string, number[]>();
    for (const s of satirlar) {
      if (!isNumber(s[i])) continue;
      const anahtar = pi >= 0 && s[pi] != null ? String(s[pi]) : "";
      const dizi = gruplar.get(anahtar) ?? [];
      dizi.push(s[i]);
      gruplar.set(anahtar, dizi);
    }
    for (const [kirilim, degerler] of gruplar) {
      if (!degerler.length) continue;
      const toplam = degerler.reduce((a, b) => a + b, 0);
      const olcu: SummaryMeasure = { etiket: `${kolonlar[i]} toplamı`, deger: round2(toplam) };
      const ort: SummaryMeasure = {
        etiket: `${kolonlar[i]} ortalaması`, deger: round2(toplam / degerler.length),
      };
      if (kirilim) { olcu.kirilim = kirilim; ort.kirilim = kirilim; }
      measures.push(olcu, ort);
    }
  }

  const repeatRate = benzersiz > 0 ? round2((repeating / benzersiz) * 100) : null;

  const parcalar = [`${satirlar.length} satır`];
  if (vi >= 0) {
    parcalar.push(`${benzersiz} benzersiz ${kolonlar[vi]}`);
    if (repeatRate != null) parcalar.push(`tekrar oranı %${repeatRate}`);
  }

  return {
    rowCount: satirlar.length,
    entityColumn: vi >= 0 ? (kolonlar[vi] ?? null) : null,
    uniqueEntities: benzersiz,
    repeatRate,
    repeating,
    measures,
    cumle: parcalar.join(" · "),
  };
}
