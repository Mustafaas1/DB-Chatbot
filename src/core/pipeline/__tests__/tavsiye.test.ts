import { describe, expect, it } from "vitest";
import {
  composeAdvice, extractNumbers, factLines, parseTurkishNumber, verifyNumbers,
} from "../tavsiye";
import { allowedNumbers, deriveSignals, type EntityProfile } from "../varlikProfili";

function profil(o: Partial<EntityProfile> = {}): EntityProfile {
  return {
    entity: "FELLAS GIDA", table: "Invoices",
    rangeLabel: "bu ay", previousRangeLabel: "geçen ay",
    current: 10, previous: 4, changePercent: 150,
    currentAmount: null, previousAmount: null, amountChangePercent: null,
    currency: null, allTime: 20, firstSeen: null, lastSeen: null,
    daysSinceLast: null, averageIntervalDays: null, peers: null,
    ...o,
  };
}

describe("Türkçe sayı okuma", () => {
  it("binlik ayracını çözer", () => {
    expect(parseTurkishNumber("1.250")).toBe(1250);
    expect(parseTurkishNumber("1.250,50")).toBe(1250.5);
  });

  it("ondalık noktayı BOZMAZ", () => {
    // "36.7" model tarafindan yazilabilir; binlik sanip 367 yapmamali.
    expect(parseTurkishNumber("36.7")).toBe(36.7);
  });

  it("ondalık virgülü çözer", () => {
    expect(parseTurkishNumber("2,4")).toBe(2.4);
  });
});

describe("metinden sayı çıkarma", () => {
  it("yüzde ve adet sayılarını bulur", () => {
    const n = extractNumbers("Bu ay 10 kere, %150 artış.").map((x) => x.deger);
    expect(n).toEqual([10, 150]);
  });

  it("BOŞLUKLU binlik ayracını tek sayı sayar", () => {
    // Gercek kosuda model "98 400 TRY" yazdi; 98 ve 400 diye okunup
    // metin yanlislikla UYDURMA sayilip reddedildi.
    const bosluk = `98${String.fromCharCode(32)}400 TRY`;
    expect(extractNumbers(bosluk).map((x) => x.deger)).toEqual([98400]);
  });

  it("sert boşluklu ayracı da çözer", () => {
    const nbsp = `1${String.fromCharCode(160)}234${String.fromCharCode(8239)}567`;
    expect(extractNumbers(nbsp).map((x) => x.deger)).toEqual([1234567]);
  });

  it("üç haneli OLMAYAN grupları birleştirmez", () => {
    // "4 kayit" ve "243 varlik" iki ayri sayidir.
    expect(extractNumbers("4 kayıt ve 243 varlık").map((x) => x.deger))
      .toEqual([4, 243]);
  });

  it("sayı yoksa boş döner", () => {
    expect(extractNumbers("Bu müşteriye daha sık gitmelisiniz.")).toEqual([]);
  });
});

describe("sayı doğrulaması", () => {
  const p = profil();
  const izinli = [
    ...allowedNumbers(p),
    ...extractNumbers(factLines(p, deriveSignals(p)).join("\n")).map((x) => x.deger),
  ];

  it("gerçeklerden gelen sayılara izin verir", () => {
    expect(verifyNumbers("Bu ay 10 satış var, geçen ay 4 idi.", izinli)).toEqual([]);
  });

  it("UYDURULMUŞ sayıyı yakalar", () => {
    // Modelin en sik yaptigi sey: olmayan bir oran eklemek.
    expect(verifyNumbers("10 satış yaptınız; sektör ortalaması 37.", izinli))
      .toEqual(["37"]);
  });

  it("yuvarlanmış hali kabul edilir", () => {
    // Profilde 36,7 varsa modelin "37 gun" yazmasi uydurma degil.
    const yuvarlanabilir = profil({ averageIntervalDays: 36.7, daysSinceLast: 60 });
    expect(verifyNumbers("Ortalama 37 gün.", allowedNumbers(yuvarlanabilir))).toEqual([]);
  });

  it("UYDURULMUŞ ZAMAN UFKUNU yakalar", () => {
    // Gercek kosuda model "onumuzdeki 30 gun icinde" yazdi; 30 verilmis
    // bir sure degil. Bu dogru bir ret.
    expect(verifyNumbers("Önümüzdeki 30 gün içinde kampanya planlayın.", izinli))
      .toEqual(["30"]);
  });

  it("sayısız metni geçirir", () => {
    expect(verifyNumbers("Bu müşteriye daha sık gitmelisiniz.", izinli)).toEqual([]);
  });
});

describe("gerçek satırları", () => {
  it("yalnızca DOLU alanları yazar", () => {
    const satir = factLines(profil(), []);
    expect(satir.join("\n")).toContain("bu ay: 10 kayit");
    // Tutar kolonu yok; uydurma bir satir eklenmemeli.
    expect(satir.join("\n")).not.toContain("tutar");
  });

  it("gözlemleri de aktarır", () => {
    const p = profil({ current: 0, allTime: 20 });
    const satir = factLines(p, deriveSignals(p));
    expect(satir.some((s) => s.startsWith("Gozlem:"))).toBe(true);
  });
});

describe("kod tarafının cümlesi", () => {
  it("gözlem varsa durum + gözlem + eylem verir", () => {
    const p = profil({ current: 0, allTime: 20 });
    const c = composeAdvice(p, deriveSignals(p));
    expect(c).toContain("kayıt yok");
    expect(c).toContain("geri kazanım");
  });

  it("gözlem yoksa sapma olmadığını söyler", () => {
    expect(composeAdvice(profil({ changePercent: 0, previous: 10, current: 10 }), []))
      .toContain("sapma yok");
  });

  it("cümledeki her sayı DOĞRULANMIŞ olur", () => {
    // Kod cumlesi de ayni suzgecten gecmeli; aksi halde geri dusus
    // dogrulamayi atlayan bir arka kapi olurdu.
    const p = profil({ current: 0, allTime: 20, daysSinceLast: 90, averageIntervalDays: 30 });
    const signals = deriveSignals(p);
    const izinli = [
      ...allowedNumbers(p),
      ...extractNumbers(factLines(p, signals).join("\n")).map((x) => x.deger),
    ];
    expect(verifyNumbers(composeAdvice(p, signals), izinli)).toEqual([]);
  });
});
