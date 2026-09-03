import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import { buildListingQuery } from "../listeleyiciCalistir";

const teklifler = {
  ad: "Teklifler",
  kolonlar: [
    { ad: "Id", tip: "uniqueidentifier" },
    { ad: "TeklifNo", tip: "nvarchar" },
    { ad: "Baslik", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

const tarihsiz = {
  ad: "Basit",
  kolonlar: [{ ad: "Kod", tip: "nvarchar" }, { ad: "Ad", tip: "nvarchar" }],
} as unknown as Tablo;

describe("listeleyici SQL uretimi", () => {
  it("secilen kolonlari, silinmis filtresini ve siralamayi kurar", () => {
    const { sql } = buildListingQuery(teklifler, "TeklifNo", "Baslik");

    expect(sql).toBe(
      "SELECT TOP (20) [TeklifNo], [Baslik] FROM dbo.[Teklifler] " +
      "WHERE IsDeleted = 0 AND [TeklifNo] IS NOT NULL ORDER BY [CreatedAt] DESC"
    );
  });

  it("SELECT * kullanmaz", () => {
    // Ajana birakildiginda "SELECT TOP 1 *" uretilmisti.
    expect(buildListingQuery(teklifler, "TeklifNo", "Baslik").sql).not.toContain("*");
  });

  it("kimligi bos olan satirlari eler", () => {
    // Kimliksiz satir aksiyona baglanamaz.
    expect(buildListingQuery(teklifler, "TeklifNo", null).sql)
      .toContain("[TeklifNo] IS NOT NULL");
  });

  it("IsDeleted yoksa WHERE'i yine dogru kurar", () => {
    const { sql } = buildListingQuery(tarihsiz, "Kod", "Ad");
    expect(sql).toContain("WHERE [Kod] IS NOT NULL");
    expect(sql).not.toContain("IsDeleted");
    expect(sql).not.toContain("AND [Kod]");
  });

  it("tarih kolonu yoksa ORDER BY eklemez", () => {
    expect(buildListingQuery(tarihsiz, "Kod", "Ad").sql).not.toContain("ORDER BY");
  });

  it("etiket kolonu yoksa yalnizca kimligi secer", () => {
    expect(buildListingQuery(teklifler, "TeklifNo", null).sql)
      .toContain("SELECT TOP (20) [TeklifNo] FROM");
  });

  it("kolon adlarini koseli parantezle kacislar", () => {
    const tuhaf = {
      ad: "Tuhaf]Tablo",
      kolonlar: [{ ad: "Ko]lon", tip: "nvarchar" }],
    } as unknown as Tablo;
    const { sql } = buildListingQuery(tuhaf, "Ko]lon", null);
    expect(sql).toContain("[Ko]]lon]");
    expect(sql).toContain("dbo.[Tuhaf]]Tablo]");
  });

  it("satir sinirini disaridan alir", () => {
    expect(buildListingQuery(teklifler, "TeklifNo", null, 5).sql)
      .toContain("SELECT TOP (5)");
  });
});
