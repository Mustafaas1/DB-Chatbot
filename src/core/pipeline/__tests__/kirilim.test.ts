import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import { pickAnalysisColumns } from "../nedenAnalizi";
import {
  buildBreakdownQuery, buildNewVsReturningQuery, isUsefulBreakdown,
  pickBreakdownColumns, readBreakdown, readNewVsReturning,
} from "../kirilim";

const teklifler = {
  ad: "Teklifler",
  kolonlar: [
    { ad: "Id", tip: "uniqueidentifier" },
    { ad: "MusteriAdi", tip: "nvarchar" },
    { ad: "SatisTemsilcisi", tip: "nvarchar" },
    { ad: "UrunTipi", tip: "nvarchar" },
    { ad: "KaynakTeklifId", tip: "uniqueidentifier" },
    { ad: "GenelToplam", tip: "decimal" },
    { ad: "ParaBirimi", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

const range = { kind: "relative", days: 30 } as const;
const kolonlar = ["Deger", "Varlik", "Kayit"];

describe("kirilim kolonu secimi", () => {
  it("atif ve kategori kolonlarini ayirir", () => {
    const b = pickBreakdownColumns(teklifler, ["MusteriAdi", "CreatedAt"]);
    expect(b.attribution).toBe("SatisTemsilcisi");
    expect(b.categories).toContain("UrunTipi");
  });

  it("GUID kolonlari kirilim sayilmaz", () => {
    // KaynakTeklifId "Kaynak" gibi duruyor ama GUID; kirilim olmaz.
    const b = pickBreakdownColumns(teklifler, []);
    expect(b.categories).not.toContain("KaynakTeklifId");
    expect(b.attribution).not.toBe("KaynakTeklifId");
  });

  it("atif kolonu kategoride TEKRARLANMAZ", () => {
    const b = pickBreakdownColumns(teklifler, []);
    expect(b.categories).not.toContain(b.attribution);
  });

  it("haric tutulan kolonlar (varlik, tarih, tutar) secilmez", () => {
    const b = pickBreakdownColumns(teklifler, ["MusteriAdi", "CreatedAt", "ParaBirimi"]);
    expect(b.categories).not.toContain("ParaBirimi");
  });
});

describe("uretilen SQL", () => {
  const k = pickAnalysisColumns(teklifler)!;

  it("kirilim sorgusu varlik ve kayit sayar", () => {
    const sql = buildBreakdownQuery(k, "SatisTemsilcisi", range);
    expect(sql).toContain("[SatisTemsilcisi] AS [Deger]");
    expect(sql).toContain("COUNT(DISTINCT [MusteriAdi]) AS [Varlik]");
    expect(sql).toContain("WHERE IsDeleted = 0 AND");
    expect(sql).toContain("GROUP BY [SatisTemsilcisi]");
  });

  it("yeni/mevcut sorgusu ilk kayit tarihine bakar", () => {
    const sql = buildNewVsReturningQuery(k, range);
    expect(sql).toContain("MIN([CreatedAt])");
    expect(sql).toContain("[Yeni]");
    expect(sql).toContain("[Mevcut]");
  });

  it("kolon adlarini kacislar", () => {
    expect(buildBreakdownQuery(k, "Ko]lon", range)).toContain("[Ko]]lon]");
  });
});

describe("kirilimin yorumu", () => {
  it("payları hesaplar", () => {
    const b = readBreakdown("SatisTemsilcisi", "attribution", kolonlar, [
      ["Çağatay", 53, 75], ["Sitran", 23, 27], ["Mete", 1, 1],
    ]);
    expect(b.rows[0]).toMatchObject({ value: "Çağatay", entities: 53, share: 68.8 });
    expect(b.distinctValues).toBe(3);
    expect(isUsefulBreakdown(b)).toBe(true);
  });

  it("boş değerler AYRI kova olarak kalır", () => {
    // Gizlemek dagilimi bozar; "(bos)" gorunur olmali.
    const b = readBreakdown("Periyot", "category", kolonlar, [
      [null, 52, 60], ["Yıllık", 3, 3], ["Aylık", 1, 1],
    ]);
    expect(b.rows[0]!.value).toBe("(boş)");
  });

  it("tek kova her şeyi kapsıyorsa BILGI TASIMAZ", () => {
    // Teklifler.IskontoTuru gercekte tek deger aliyor (%100 bos);
    // bunu "kirilim" diye gostermek gurultu olur.
    const b = readBreakdown("IskontoTuru", "category", kolonlar, [[null, 75, 75]]);
    expect(b.uninformative).toBe(true);
    expect(isUsefulBreakdown(b)).toBe(false);
  });

  it("%95 boş olan kolon da elenir", () => {
    const b = readBreakdown("UrunTipi", "category", kolonlar, [
      [null, 71, 71], ["Mikro Jump", 3, 4], ["Mikro Fly", 1, 3],
    ]);
    expect(b.uninformative).toBe(true);
    expect(isUsefulBreakdown(b)).toBe(false);
  });

  it("çok fazla farklı değer varsa kırılım değildir", () => {
    // Invoices.UrunAdi 73 satirda 58 farkli deger -- satirin kendisi.
    const cok = Array.from({ length: 20 }, (_, i) => [`u${i}`, 3, 3]);
    const b = readBreakdown("UrunAdi", "category", kolonlar, cok);
    expect(b.tooGranular).toBe(true);
    expect(isUsefulBreakdown(b)).toBe(false);
    // Yine de ilk 12 satir tasiniyor; cagiran gostermemeyi secer.
    expect(b.rows).toHaveLength(12);
  });

  it("tek satırlık kırılım gösterilmez", () => {
    const b = readBreakdown("X", "category", kolonlar, [["tek", 10, 10]]);
    expect(isUsefulBreakdown(b)).toBe(false);
  });
});

describe("yeni / mevcut", () => {
  it("oranı hesaplar", () => {
    // Gercek veri: Teklifler son 30 gun -> 60 yeni, 15 mevcut
    const n = readNewVsReturning(["Yeni", "Mevcut"], [[60, 15]])!;
    expect(n).toMatchObject({ neww: 60, returning: 15, newShare: 80 });
  });

  it("boş sonuçta null döner", () => {
    expect(readNewVsReturning(["Yeni", "Mevcut"], [])).toBeNull();
    expect(readNewVsReturning(["Yeni", "Mevcut"], [[0, 0]])).toBeNull();
  });
});
