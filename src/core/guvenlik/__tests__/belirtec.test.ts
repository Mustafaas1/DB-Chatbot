import { describe, expect, it } from "vitest";
import { belirteciAyikla, belirteciDenetle } from "../belirtec";

describe("belirtecin ayıklanması", () => {
  it("Bearer şemasını çözer", () => {
    expect(belirteciAyikla("Bearer abc123", null)).toBe("abc123");
  });

  it("şema adı büyük/küçük harf duyarsız", () => {
    // RFC 7235 boyle soyluyor; "bearer" gonderen istemciyi reddetmek
    // sebepsiz bir uyumsuzluk olurdu.
    expect(belirteciAyikla("bearer abc123", null)).toBe("abc123");
    expect(belirteciAyikla("BEARER abc123", null)).toBe("abc123");
  });

  it("X-API-Token başlığını da kabul eder", () => {
    expect(belirteciAyikla(null, "abc123")).toBe("abc123");
  });

  it("X-API-Token, Authorization'a göre önceliklidir", () => {
    expect(belirteciAyikla("Bearer eski", "yeni")).toBe("yeni");
  });

  it("boşlukları kırpar", () => {
    expect(belirteciAyikla("Bearer   abc123  ", null)).toBe("abc123");
    expect(belirteciAyikla(null, "  abc123 ")).toBe("abc123");
  });

  it("şemasız değeri belirteç saymaz", () => {
    // "Basic ..." ya da cıplak değer Bearer değildir.
    expect(belirteciAyikla("Basic abc123", null)).toBeNull();
    expect(belirteciAyikla("abc123", null)).toBeNull();
  });

  it("başlık yoksa null", () => {
    expect(belirteciAyikla(null, null)).toBeNull();
    expect(belirteciAyikla("", "")).toBeNull();
  });
});

describe("denetim", () => {
  it("API_TOKEN tanımsızsa kontrol KAPALI", () => {
    // Yerel gelistirmede yapilandirma zorunlulugu getirmiyoruz; cagiran
    // taraf bunu bir kez uyari olarak basiyor.
    expect(belirteciDenetle(undefined, null, null)).toEqual({ durum: "kapali" });
    expect(belirteciDenetle("", "Bearer x", null)).toEqual({ durum: "kapali" });
    expect(belirteciDenetle("   ", null, null)).toEqual({ durum: "kapali" });
  });

  it("doğru belirteç geçer", () => {
    expect(belirteciDenetle("gizli", "Bearer gizli", null))
      .toEqual({ durum: "gecerli" });
  });

  it("eksik ile geçersizi AYIRIR", () => {
    // Iki durumun cozumu farkli: biri "baslik ekle", digeri "degeri duzelt".
    expect(belirteciDenetle("gizli", null, null)).toEqual({ durum: "eksik" });
    expect(belirteciDenetle("gizli", "Bearer yanlis", null))
      .toEqual({ durum: "gecersiz" });
  });

  it("kısmi eşleşme geçmez", () => {
    expect(belirteciDenetle("gizlianahtar", "Bearer gizli", null))
      .toEqual({ durum: "gecersiz" });
    expect(belirteciDenetle("gizli", "Bearer gizlianahtar", null))
      .toEqual({ durum: "gecersiz" });
  });

  it("büyük/küçük harf farkı geçmez", () => {
    expect(belirteciDenetle("Gizli", "Bearer gizli", null))
      .toEqual({ durum: "gecersiz" });
  });

  it("beklenen değerin baştaki/sondaki boşluğu önemsizdir", () => {
    // .env dosyalarinda satir sonu boslugu sik; belirteci sessizce
    // gecersiz kilmasi kotu bir tuzak olurdu.
    expect(belirteciDenetle("  gizli  ", "Bearer gizli", null))
      .toEqual({ durum: "gecerli" });
  });

  it("Türkçe karakterli belirteç bozulmaz", () => {
    expect(belirteciDenetle("şifreÇĞİ", "Bearer şifreÇĞİ", null))
      .toEqual({ durum: "gecerli" });
    expect(belirteciDenetle("şifreÇĞİ", "Bearer sifreCGI", null))
      .toEqual({ durum: "gecersiz" });
  });
});
