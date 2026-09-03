import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import {
  pickAnalysisColumns, comparePeriods, buildPeriodQuery, deriveSegments, buildEntityQuery,
} from "../nedenAnalizi";

const invoices = {
  ad: "Invoices",
  kolonlar: [
    { ad: "Id", tip: "uniqueidentifier" },
    { ad: "MusteriAdi", tip: "nvarchar" },
    { ad: "Tutar", tip: "decimal" },
    { ad: "ParaBirimi", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

/** Musteri adi var ama parasal kolon yok: analiz adet uzerinden yapilir. */
const tutarsizTablo = {
  ad: "Kayitlar",
  kolonlar: [
    { ad: "MusteriAdi", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

/** Musteri adi HIC yok: musteri segmenti analizi yapilamaz. */
const musterisizTablo = {
  ad: "TicketRecords",
  kolonlar: [
    { ad: "BiletNo", tip: "nvarchar" },
    { ad: "AtananKisi", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
  ],
} as unknown as Tablo;

describe("analiz kolonlarini secme", () => {
  it("varlik, tarih, tutar ve para birimini bulur", () => {
    const k = pickAnalysisColumns(invoices)!;
    expect(k.varlik).toBe("MusteriAdi");
    expect(k.tarih).toBe("CreatedAt");
    expect(k.tutar).toBe("Tutar");
    expect(k.paraBirimi).toBe("ParaBirimi");
  });

  it("varlik kolonu yoksa analiz yapilamaz", () => {
    const t = { ad: "X", kolonlar: [{ ad: "CreatedAt", tip: "datetime2" }] } as unknown as Tablo;
    expect(pickAnalysisColumns(t)).toBeNull();
  });

  it("tutar yoksa null birakir, analiz yine mumkun", () => {
    const k = pickAnalysisColumns(tutarsizTablo)!;
    expect(k.tutar).toBeNull();
    expect(k.varlik).toBe("MusteriAdi");
  });

  it("musteri kolonu olmayan tabloda analiz URETMEZ", () => {
    // AtananKisi'ye gore dilimleyip "musteri segmenti" demek veriyi
    // yanlis temsil ederdi; hic uretmemek dogru.
    expect(pickAnalysisColumns(musterisizTablo)).toBeNull();
  });
});

describe("uretilen SQL", () => {
  it("donem sorgusu aya ve para birimine gore gruplar", () => {
    const sql = buildPeriodQuery(pickAnalysisColumns(invoices)!);
    expect(sql).toContain("CONVERT(char(7), [CreatedAt], 126) AS [Ay]");
    expect(sql).toContain("COUNT(DISTINCT [MusteriAdi])");
    expect(sql).toContain("SUM([Tutar])");
    expect(sql).toContain("WHERE IsDeleted = 0");
    expect(sql).toContain("GROUP BY CONVERT(char(7), [CreatedAt], 126), [ParaBirimi]");
  });

  it("tutar yoksa SUM eklemez", () => {
    const sql = buildPeriodQuery(pickAnalysisColumns(tutarsizTablo)!);
    expect(sql).not.toContain("SUM(");
    expect(sql).toContain("COUNT(*)");
  });

  it("varlik sorgusu gun penceresi uygular", () => {
    const sql = buildEntityQuery(pickAnalysisColumns(invoices)!, { kind: "relative", days: 30 });
    expect(sql).toContain("DATEADD(day, -30, CAST(GETDATE() AS date))");
    expect(sql).toContain("GROUP BY [MusteriAdi]");
  });
});

describe("donem karsilastirmasi (aritmetik kodda)", () => {
  const kolonlar = ["Ay", "ParaBirimi", "Kayit", "Varlik", "Toplam"];

  it("son iki ayi karsilastirir ve yuzdeyi hesaplar", () => {
    // Gercek veri: 2026-07 -> 29 fatura / 19 musteri, 2026-08 -> 73 / 52
    const f = comparePeriods(kolonlar, [
      ["2026-08", "TRY", 73, 52, 1587937.08],
      ["2026-07", "TRY", 29, 19, 1621210.31],
    ])[0]!;

    expect(f.simdikiAy).toBe("2026-08");
    expect(f.oncekiAy).toBe("2026-07");
    expect(f.kayit).toMatchObject({ once: 29, sonra: 73 });
    expect(f.kayit.degisimYuzde).toBeCloseTo(151.7, 1);
    expect(f.varlik.degisimYuzde).toBeCloseTo(173.7, 1);
    expect(f.toplam!.degisimYuzde).toBeCloseTo(-2.1, 1);
  });

  it("para birimlerini AYRI karsilastirir", () => {
    const f = comparePeriods(kolonlar, [
      ["2026-08", "TRY", 40, 30, 1000], ["2026-07", "TRY", 20, 15, 500],
      ["2026-08", "USD", 4, 3, 100], ["2026-07", "USD", 2, 2, 50],
    ]);
    expect(f).toHaveLength(2);
    // Cok kayitli birim once.
    expect(f[0]!.paraBirimi).toBe("TRY");
    expect(f[1]!.paraBirimi).toBe("USD");
  });

  it("tek ay varsa karsilastirma yapmaz", () => {
    expect(comparePeriods(kolonlar, [["2026-08", "TRY", 73, 52, 100]])).toHaveLength(0);
  });

  it("sifirdan artista yuzde null doner", () => {
    // "%Infinity" gostermek yerine yuzdeyi tanimsiz birakiyoruz.
    const f = comparePeriods(kolonlar, [
      ["2026-08", "TRY", 5, 5, 10], ["2026-07", "TRY", 0, 0, 0],
    ])[0]!;
    expect(f.kayit.degisimYuzde).toBeNull();
  });
});

describe("turetilmis segment", () => {
  const kolonlar = ["Varlik", "Adet", "Toplam", "ParaBirimi"];

  it("dilimleri veriden turetir", () => {
    const satirlar = Array.from({ length: 10 }, (_, i) => [`M${i}`, 1, (10 - i) * 1000, "TRY"]);
    const s = deriveSegments(kolonlar, satirlar);

    expect(s.totalEntities).toBe(10);
    expect(s.withoutAmount).toBe(0);
    expect(s.tiers.map((d) => d.ad)).toEqual(["yüksek", "orta", "düşük"]);
    // Paylar toplami %100 olmali.
    expect(s.tiers.reduce((t, d) => t + d.pay, 0)).toBeCloseTo(100, 1);
  });

  it("tutari olmayan varliklari AYRI sayar, dilime katmaz", () => {
    // Gercek veride 52 musterinin 29'unun tutari yok; sessizce "dusuk"
    // saymak dilimlemeyi yalan yapardi.
    const s = deriveSegments(kolonlar, [
      ["A", 1, 1000, "TRY"], ["B", 1, 2000, "TRY"],
      ["C", 1, null, null], ["D", 1, null, null], ["E", 1, null, null],
    ]);
    expect(s.withoutAmount).toBe(3);
    expect(s.totalEntities).toBe(5);
    expect(s.tiers.reduce((t, d) => t + d.entityCount, 0)).toBe(2);
  });

  it("hicbir tutar yoksa dilim uretmez", () => {
    const s = deriveSegments(kolonlar, [["A", 1, null, null], ["B", 1, null, null]]);
    expect(s.tiers).toHaveLength(0);
    expect(s.withoutAmount).toBe(2);
  });

  it("bos sonucta cokmez", () => {
    expect(deriveSegments(kolonlar, []).totalEntities).toBe(0);
  });

  it("esikler SABIT degil, veriden geliyor", () => {
    // Ayni dagilim 1000 kat kucuk olsa da dilimler ayni sekilde bolunmeli.
    const buyuk = Array.from({ length: 10 }, (_, i) => [`M${i}`, 1, (10 - i) * 1000, "TRY"]);
    const kucuk = Array.from({ length: 10 }, (_, i) => [`M${i}`, 1, (10 - i), "TRY"]);
    expect(deriveSegments(kolonlar, kucuk).tiers.map((d) => d.entityCount))
      .toEqual(deriveSegments(kolonlar, buyuk).tiers.map((d) => d.entityCount));
  });
});

describe("tutar hic yoksa sifir GOSTERILMEZ", () => {
  const kolonlar = ["Ay", "ParaBirimi", "Kayit", "Varlik", "Toplam"];

  it("SUM null donen grupta toplam satiri uretilmez", () => {
    // Gercek veride ParaBirimi null olan 29 fatura var ve Tutar'lari da
    // null; "ciro 0 -> 0" gostermek "cirosu sifir" izlenimi verirdi.
    const f = comparePeriods(kolonlar, [
      ["2026-08", null, 29, 26, null],
      ["2026-07", null, 14, 13, null],
    ])[0]!;
    expect(f.toplam).toBeNull();
    expect(f.kayit.sonra).toBe(29);
  });

  it("tek tarafta tutar varsa karsilastirma yapilir", () => {
    const f = comparePeriods(kolonlar, [
      ["2026-08", "TRY", 5, 5, 1000],
      ["2026-07", "TRY", 5, 5, null],
    ])[0]!;
    expect(f.toplam).not.toBeNull();
    expect(f.toplam!.once).toBe(0);
    expect(f.toplam!.sonra).toBe(1000);
  });
});
