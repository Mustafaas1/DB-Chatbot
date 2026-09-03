import { describe, expect, it } from "vitest";
import { detectShape } from "../soruSekli";

/**
 * Şekil tanıma testleri.
 *
 * Kural: TANIYAMADIĞINDA `null` döner ve çağıran taraf ajana düşer.
 * Yanlış tanıyıp yanlış SQL üretmektense hiç tanımamak doğru -- zaman
 * ayrıştırıcıda da aynı karar verilmişti.
 */

const sekil = (s: string) => detectShape(s)?.kind ?? null;

/**
 * Sıralama yönünü daraltarak okur.
 *
 * `detectShape(...)?.yon` derlenmiyor: birleşimin "sayim" kolunda böyle
 * bir alan yok. Daraltmayı testte de yapmak, tipin gerçekten ayrık
 * olduğunu doğruluyor.
 */
function yonu(soru: string): "ust" | "alt" | null {
  const s = detectShape(soru);
  return s && s.kind === "siralama" ? s.yon : null;
}

describe("sayım soruları", () => {
  it("'kaç' ile başlayan sayımı tanır", () => {
    expect(sekil("Bu ay kaç bilet açıldı?")).toBe("sayim");
    expect(sekil("Son 30 günde kaç fatura kesildi")).toBe("sayim");
  });

  it("'ne kadar' sayım sayılır", () => {
    expect(sekil("Bu ay ne kadar teklif verdik?")).toBe("sayim");
  });

  it("'toplam ... sayısı' kalıbını tanır", () => {
    expect(sekil("Bu yıl toplam sözleşme sayısı")).toBe("sayim");
  });

  it("ASCII yazılmış hali de tanınır", () => {
    // Kullanici Turkce karakter kullanmayabilir; ayni soru.
    expect(sekil("Bu ay kac bilet acildi?")).toBe("sayim");
  });
});

describe("kırılım isteyen soru sayım DEĞİLDİR", () => {
  it("'göre' kırılımı sayımı bozar", () => {
    // "Asamaya gore kac bilet" tek sayi degil, tablo ister.
    expect(sekil("Aşamaya göre kaç bilet var?")).not.toBe("sayim");
  });

  it("'bazında' kırılımı sayımı bozar", () => {
    expect(sekil("Müşteri bazında kaç fatura kesildi")).not.toBe("sayim");
  });

  it("'dağılımı' sayım değildir", () => {
    expect(sekil("Biletlerin aşama dağılımı")).not.toBe("sayim");
  });
});

describe("sıralama soruları", () => {
  it("'en çok' üst sıralamayı verir", () => {
    const s = detectShape("En çok satan ürünler");
    expect(s).toEqual({ kind: "siralama", yon: "ust" });
  });

  it("'en fazla' de üst sıralamadır", () => {
    expect(yonu("En fazla bilet açan müşteri")).toBe("ust");
  });

  it("'en az' alt sıralamayı verir", () => {
    expect(detectShape("En az sipariş veren müşteriler")).toEqual({
      kind: "siralama", yon: "alt",
    });
  });

  it("'en yüksek' ve 'en düşük' yön ayrımı", () => {
    expect(yonu("En yüksek tutarlı faturalar")).toBe("ust");
    expect(yonu("En düşük cirolu müşteriler")).toBe("alt");
  });

  it("sıralama sayımdan ÖNCE gelir", () => {
    // "En cok kac bilet acan musteri" -- ikisi de gecerken siralama
    // kazanmali; cevap tek sayi degil, sirali liste.
    expect(sekil("En çok kaç bilet açan müşteri var?")).toBe("siralama");
  });
});

describe("tanınmayan şekiller", () => {
  it("liste sorusu null döner", () => {
    // Mevcut "liste" yolu ayri; burada tanimiyoruz.
    expect(sekil("Son 1 ayda satın alım yapan müşterileri getir")).toBeNull();
  });

  it("açık uçlu amaç sorusu null döner", () => {
    expect(sekil("Destek yükümüzü nasıl azaltırız?")).toBeNull();
  });

  it("boş soru null döner", () => {
    expect(sekil("")).toBeNull();
    expect(sekil("   ")).toBeNull();
  });

  it("'kaç' sözcüğün İÇİNDE geçerse sayım sayılmaz", () => {
    // "kacak", "kacinci" gibi sozcukler sayim sorusu yapmaz.
    expect(sekil("Kaçak kullanım raporu")).toBeNull();
  });

  it("'en' tek başına sıralama yapmaz", () => {
    expect(sekil("Enerji tüketimi raporu")).toBeNull();
  });
});
