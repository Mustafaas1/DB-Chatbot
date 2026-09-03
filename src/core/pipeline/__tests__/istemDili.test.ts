import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * İSTEMLERİN DİLİ.
 *
 * Model kuraldan çok ÖRNEĞİ taklit ediyor. İstem örnekleri ASCII yazılınca
 * çıktı da ASCII'ye düşüyordu ve bozuk cümleler üretiyordu -- gerçek bir
 * koşuda niyet alanı "satisi yukseltilmek" çıktı; bu metin kullanıcıya
 * olduğu gibi gösteriliyor.
 *
 * Örnekler zamanla elle düzenlenirken sessizce ASCII'ye dönebilir. Bu test
 * onu yakalar: kural düzyazıda kalırsa er ya da geç bozulur.
 */

const KOK = join(process.cwd(), "src", "core");

function oku(...yol: string[]): string {
  return readFileSync(join(KOK, ...yol), "utf8");
}

/** Türkçeye özgü harfler; hiçbiri yoksa metin ASCII'ye düşmüştür. */
const TURKCE = /[çğıöşüÇĞİÖŞÜ]/;

/**
 * ASCII'ye düşmüş Türkçe kalıpları.
 *
 * Tam sözcük eşleşmesi aranıyor: "gore" bir İngilizce sözcüğün parçası
 * olarak geçebilir, ama tek başına Türkçe "göre"nin bozulmuş halidir.
 */
const BOZUK = [
  "sayisi", "sayisini", "dagilimi", "gore", "acik", "asama", "asamalarina",
  "musteri", "musteriye", "satis", "satisi", "yukumuzu", "dusurmek",
  "cozum", "suresini", "kisaltmak", "yuku", "dagitmak", "yigilma",
  "urettigini", "azaltilamaz", "takildigini", "gosterir", "olasi",
  "esik", "asildiginda", "uyari", "kazanilan", "tutari", "oranini",
  "yukselterek", "artirmak", "biriktigini", "gorup", "yukunu",
  "iyilestirmek", "sikligini",
];

/**
 * Dosyadan YALNIZCA örnek bloğunu keser.
 *
 * Kapsam bilerek dar: kural düzyazısı ve yorumlar ASCII kalabilir, model
 * onları taklit etmiyor. Taklit ettiği şey ÖRNEKLER. İlk sürüm bütün
 * dosyaya bakıyordu ve kuralın içinde kasten alıntılanan bozuk örneği
 * ("satisi yukseltilmek" gibi devrik...) hata sanıyordu.
 */
function ornekBlogu(kaynak: string, baslangic: string, bitis: string): string {
  const i = kaynak.indexOf(baslangic);
  const j = kaynak.indexOf(bitis, i);
  if (i < 0 || j < 0) {
    throw new Error(`Örnek bloğu bulunamadı: ${baslangic} .. ${bitis}`);
  }
  // Bloğun İÇİNDE yorum yok; açıklayıcı yorumlar bloktan ÖNCE duruyor.
  // Bitiş sınırı ŞART: dosya sonuna kadar kesmek, sonraki
  // fonksiyonların ASCII yorumlarını da örnek sanıyordu.
  return kaynak.slice(i, j);
}

/** Yalnızca örnek/açıklama alanlarındaki dizgeleri denetler. */
function bozukSozcukler(metin: string): string[] {
  const bulunan = new Set<string>();
  for (const s of BOZUK) {
    // Sözcük sınırı: Türkçe harfler ASCII olmadığı için \b yerine
    // açık sınıf kullanılıyor.
    const desen = new RegExp(`(?<![\\p{L}])${s}(?![\\p{L}])`, "iu");
    if (desen.test(metin)) bulunan.add(s);
  }
  return [...bulunan];
}

describe("niyet istemi", () => {
  const kaynak = oku("pipeline", "intent.ts");
  const kodSatirlari = ornekBlogu(kaynak, "const ORNEKLER", "export interface IntentResult");

  it("dil kuralını taşır", () => {
    expect(kaynak).toContain("DUZGUN TURKCE");
  });

  it("örnekler düzgün Türkçe yazılmış", () => {
    expect(TURKCE.test(kodSatirlari)).toBe(true);
  });

  it("örneklerde ASCII'ye düşmüş Türkçe kalmamış", () => {
    // Model kuraldan çok örneği taklit ediyor; bozuk örnek bozuk çıktı üretir.
    expect(bozukSozcukler(kodSatirlari)).toEqual([]);
  });
});

describe("hedef ağacı istemi", () => {
  const kaynak = oku("hedef", "istem.ts");
  const kodSatirlari = ornekBlogu(kaynak, "export function examples", "export function nodeText");

  it("dil kuralını taşır", () => {
    expect(kaynak).toContain("TURKCE yaz");
  });

  it("örnekler düzgün Türkçe yazılmış", () => {
    expect(TURKCE.test(kodSatirlari)).toBe(true);
  });

  it("örneklerde ASCII'ye düşmüş Türkçe kalmamış", () => {
    expect(bozukSozcukler(kodSatirlari)).toEqual([]);
  });
});

describe("denetimin kendisi", () => {
  it("bozuk metni GERÇEKTEN yakalar", () => {
    // Deseni test etmeyen bir denetim, sessizce hiçbir şey yapmıyor
    // olabilir; bu projede aynı hata (ölü kural) daha önce yaşandı.
    expect(bozukSozcukler("Asamalarina gore acik biletler")).toEqual(
      expect.arrayContaining(["asamalarina", "gore", "acik"])
    );
  });

  it("doğru Türkçeyi bozuk saymaz", () => {
    expect(bozukSozcukler("Aşamalarına göre açık biletler")).toEqual([]);
  });

  it("sözcüğün İÇİNDE geçen dizgeyi işaretlemez", () => {
    // "gore" -> "category" içinde geçmiyor ama "score" gibi bir sözcük
    // yanlış eşleşmemeli.
    expect(bozukSozcukler("kategori skoru")).toEqual([]);
  });
});
