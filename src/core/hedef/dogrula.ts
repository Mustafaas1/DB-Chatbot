import type { Tablo } from "../db/sema";
import type { KolonDegerleri } from "../db/degerler";

/**
 * Olcum sorusunun VERIYLE TUTARLI olup olmadigini kodda dogrular.
 *
 * Neden koda ait: hedef agaci istemine gercek durum degerlerini
 * koymamiza ragmen model hala olmayan deger uretiyor
 * (Asama='Kapalı', Oncelik='Yuksek'). Ucretsiz katmanda her bos olcum
 * ~40 saniye ve ~3.000 token harciyor; bunu calistirmadan once yakalamak
 * hem dogru hem ucuz.
 *
 * Bu, oturumun tekrar eden dersinin bir ornegi daha: duzyazi kural
 * tutmuyorsa kural koda tasinir.
 */

export type InvalidityKind = "olmayan_deger" | "tip_uyusmazligi";

export interface Invalidity {
  tur: InvalidityKind;
  kolon: string;
  yazilan: string;
  /** Gercek degerler ya da beklenen tip. */
  beklenen: string;
  mesaj: string;
}

/** Kolon = 'deger' bicimindeki karsilastirmalari yakalar (N onegi opsiyonel). */
const KARSILASTIRMA = /([A-Za-zÇĞİÖŞÜçğıöşü_][A-Za-z0-9ÇĞİÖŞÜçğıöşü_]*)\s*=\s*N?'([^']*)'/g;

function normalize(s: string): string {
  return s.toLocaleLowerCase("tr").trim();
}

/** Yazilan degere en yakin gercek degeri bulur (basit harf ortakligi). */
function enYakin(yazilan: string, adaylar: string[]): string | null {
  const y = normalize(yazilan);
  let enIyi: string | null = null;
  let enYuksek = 0;
  for (const a of adaylar) {
    const n = normalize(a);
    let ortak = 0;
    for (const h of new Set(y)) if (n.includes(h)) ortak++;
    const puan = ortak / Math.max(y.length, n.length);
    if (puan > enYuksek) { enYuksek = puan; enIyi = a; }
  }
  return enYuksek >= 0.5 ? enIyi : null;
}

export interface ValidationResult {
  valid: boolean;
  invalidities: Invalidity[];
}

/**
 * Olcum sorusunu (ya da SQL'i) dogrular.
 *
 * Yalnizca EMIN oldugumuz durumlarda gecersiz der: kolon adi bilinen bir
 * durum kolonuysa ve deger listede yoksa, ya da kolon sayisalsa ve metinle
 * karsilastiriliyorsa. Suphede kaldiginda gecerli sayar -- yanlis pozitif
 * calisan bir olcumu engellerdi.
 */
export function validateMeasurement(
  metin: string,
  tablolar: Tablo[],
  degerler: KolonDegerleri[]
): ValidationResult {
  const invalidities: Invalidity[] = [];

  // Ayni kolon adi farkli tablolarda FARKLI degerler tasiyabiliyor
  // (TicketRecords.Asama vs ContractRecords.Asama). Metinde bir tablo adi
  // geciyorsa o tablonunkini kullaniyoruz; yoksa birlesim (tekrarsiz).
  const metinKucuk = normalize(metin);
  const gecenTablolar = new Set(
    degerler.map((d) => d.tablo).filter((t) => metinKucuk.includes(normalize(t)))
  );

  const degerHarita = new Map<string, string[]>();
  for (const d of degerler) {
    if (gecenTablolar.size && !gecenTablolar.has(d.tablo)) continue;
    const anahtar = normalize(d.kolon);
    const mevcut = degerHarita.get(anahtar) ?? [];
    for (const v of d.degerler) if (!mevcut.some((m) => normalize(m) === normalize(v))) mevcut.push(v);
    degerHarita.set(anahtar, mevcut);
  }

  // Kolon adi -> sayisal mi
  const sayisalKolon = new Set<string>();
  for (const t of tablolar) {
    for (const k of t.kolonlar) {
      if (/^(int|bigint|smallint|tinyint|decimal|numeric|float|real|money)$/i.test(k.tip)) {
        sayisalKolon.add(normalize(k.ad));
      }
    }
  }

  for (const es of metin.matchAll(KARSILASTIRMA)) {
    const kolon = es[1]!;
    const yazilan = es[2]!;
    const anahtar = normalize(kolon);

    // 1) Sayisal kolon metinle karsilastiriliyor mu?
    if (sayisalKolon.has(anahtar) && !degerHarita.has(anahtar) && !/^-?\d+([.,]\d+)?$/.test(yazilan)) {
      invalidities.push({
        tur: "tip_uyusmazligi", kolon, yazilan, beklenen: "sayi",
        mesaj: `${kolon} sayisal bir kolon; '${yazilan}' metniyle karsilastirilamaz.`,
      });
      continue;
    }

    // 2) Bilinen durum kolonunda olmayan deger mi?
    const gercekler = degerHarita.get(anahtar);
    if (gercekler?.length) {
      const varMi = gercekler.some((g) => normalize(g) === normalize(yazilan));
      if (!varMi) {
        const oneri = enYakin(yazilan, gercekler);
        invalidities.push({
          tur: "olmayan_deger", kolon, yazilan,
          beklenen: gercekler.join(", "),
          mesaj:
            `${kolon} kolonunda '${yazilan}' diye bir deger yok. ` +
            `Gercek degerler: ${gercekler.join(", ")}.` +
            (oneri ? ` Kastedilen '${oneri}' olabilir.` : ""),
        });
      }
    }
  }

  return { valid: invalidities.length === 0, invalidities };
}
