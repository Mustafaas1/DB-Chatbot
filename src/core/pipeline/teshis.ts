import type { OlcumSonucu } from "../ajan/olcum";

/**
 * S2 - DIAGNOSE (kod tarafi)
 *
 * "Bu veri neden boyle?" sorusunun ONCE hesaplanabilir kismi.
 *
 * Neden koda ait: yigilma, aykiri deger, konsantrasyon gibi seyler
 * ARITMETIK. Modele hesaplatmak hem token harciyor hem hata uretiyor --
 * bu oturumda model 103+32+2+14 icin "147" demisti. Model yalnizca
 * hesaplanmis bulguyu YORUMLAR.
 */

export type FindingKind =
  | "yigilma"        // tek grup baskin
  | "uzun_kuyruk"    // cok sayida kucuk grup
  | "aykiri"         // ortalamadan cok sapan grup
  | "dengeli"        // belirgin bir yapi yok
  | "tek_grup"
  | "bos";

export interface Finding {
  tur: FindingKind;
  /** Insan okuyabilir tek cumle. */
  metin: string;
  /** Varsa ilgili grup etiketi. */
  etiket?: string;
  /** Varsa oran (0-1). */
  oran?: number;
}

export interface Diagnosis {
  dugumId: string;
  baslik: string;
  /** Sayisal kolonun toplami; yoksa satir sayisi. */
  toplam: number;
  groupCount: number;
  findings: Finding[];
}

const YIGILMA_ESIGI = 0.6;      // tek grup toplamin %60'indan fazlasi
const UZUN_KUYRUK_ESIGI = 0.15; // en kucuk gruplarin toplam payi
const AYKIRI_KAT = 3;           // ortalamanin bu kati

/** Tum hucreleri sayi olan ilk kolonun indisi. */
function measureColumn(kolonlar: string[], satirlar: unknown[][]): number {
  for (let n = 0; n < kolonlar.length; n++) {
    if (satirlar.length > 0 && satirlar.every((s) => typeof s[n] === "number")) return n;
  }
  return -1;
}

/** Sayisal olmayan ilk kolon: grup etiketi. */
function labelColumn(kolonlar: string[], satirlar: unknown[][]): number {
  for (let n = 0; n < kolonlar.length; n++) {
    if (satirlar.some((s) => typeof s[n] === "string")) return n;
  }
  return -1;
}

function bicim(n: number): string {
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

/**
 * Bir olcum sonucundan hesaplanabilir bulgulari cikarir.
 *
 * LLM CAGRISI YOK. Tamami aritmetik.
 */
export function diagnose(s: OlcumSonucu): Diagnosis {
  const { kolonlar, satirlar } = s;
  const findings: Finding[] = [];

  if (!satirlar.length) {
    return { dugumId: s.dugumId, baslik: s.baslik, toplam: 0, groupCount: 0,
             findings: [{ tur: "bos", metin: "Sonuc bos; yorumlanacak veri yok." }] };
  }

  const oi = measureColumn(kolonlar, satirlar);
  const ei = labelColumn(kolonlar, satirlar);

  // Olcu kolonu yoksa satir sayisi uzerinden konusuruz.
  if (oi === -1) {
    return {
      dugumId: s.dugumId, baslik: s.baslik, toplam: satirlar.length,
      groupCount: satirlar.length,
      findings: [{ tur: "dengeli", metin: `${satirlar.length} kayit listelendi; sayisal olcu kolonu yok.` }],
    };
  }

  const degerler = satirlar.map((r) => Number(r[oi]) || 0);
  const toplam = degerler.reduce((t, v) => t + v, 0);
  const groupCount = satirlar.length;
  const olcuAdi = kolonlar[oi] ?? "deger";

  if (groupCount === 1) {
    return {
      dugumId: s.dugumId, baslik: s.baslik, toplam, groupCount,
      findings: [{ tur: "tek_grup", metin: `Tek grup: ${olcuAdi} = ${bicim(toplam)}.` }],
    };
  }

  const sirali = satirlar
    .map((r, i) => ({ etiket: ei >= 0 ? String(r[ei]) : `#${i + 1}`, deger: degerler[i]! }))
    .sort((a, b) => b.deger - a.deger);

  const en = sirali[0]!;
  const enOran = toplam > 0 ? en.deger / toplam : 0;

  // 1) Yigilma
  if (enOran >= YIGILMA_ESIGI) {
    findings.push({
      tur: "yigilma", etiket: en.etiket, oran: enOran,
      metin: `"${en.etiket}" tek basina toplamin %${Math.round(enOran * 100)}'ini olusturuyor ` +
             `(${bicim(en.deger)} / ${bicim(toplam)}). Yuk burada yogunlasmis.`,
    });
  }

  // 2) Uzun kuyruk
  if (groupCount >= 4) {
    const altYari = sirali.slice(Math.ceil(groupCount / 2));
    const kuyrukPay = toplam > 0 ? altYari.reduce((t, x) => t + x.deger, 0) / toplam : 0;
    if (kuyrukPay <= UZUN_KUYRUK_ESIGI) {
      findings.push({
        tur: "uzun_kuyruk", oran: kuyrukPay,
        metin: `Alt yaridaki ${altYari.length} grup toplamin yalnizca ` +
               `%${Math.round(kuyrukPay * 100)}'ini olusturuyor; uzun kuyruk var.`,
      });
    }
  }

  // 3) Aykiri deger
  const ortalama = toplam / groupCount;
  if (ortalama > 0 && en.deger >= ortalama * AYKIRI_KAT && enOran < YIGILMA_ESIGI) {
    findings.push({
      tur: "aykiri", etiket: en.etiket,
      metin: `"${en.etiket}" ortalamanin ${(en.deger / ortalama).toFixed(1)} kati ` +
             `(${bicim(en.deger)} / ortalama ${bicim(ortalama)}).`,
    });
  }

  if (!findings.length) {
    findings.push({
      tur: "dengeli",
      metin: `${groupCount} grup arasinda belirgin bir yigilma yok; dagilim dengeli.`,
    });
  }

  return { dugumId: s.dugumId, baslik: s.baslik, toplam, groupCount, findings };
}

/** Teshisleri modele verilecek kompakt metne cevirir. */
export function diagnosisText(teshisler: Diagnosis[]): string {
  return teshisler
    .map((t) => `${t.baslik}: ` + t.findings.map((b) => b.metin).join(" "))
    .join("\n");
}
