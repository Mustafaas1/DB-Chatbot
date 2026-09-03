import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import { pickAnalysisColumns } from "../nedenAnalizi";
import { buildDetailQuery, pickDetailColumns } from "../detay";
import { sqlLiteral } from "../varlik";
import type { TimeRange } from "../zamanAraligi";

const teklifler = {
  ad: "Teklifler",
  kolonlar: [
    { ad: "Id", tip: "uniqueidentifier" },
    { ad: "TeklifNo", tip: "nvarchar" },
    { ad: "Baslik", tip: "nvarchar" },
    { ad: "MusteriAdi", tip: "nvarchar" },
    { ad: "GenelToplam", tip: "decimal" },
    { ad: "ParaBirimi", tip: "nvarchar" },
    { ad: "Durum", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

const range: TimeRange = { kind: "relative", days: 30 };

describe("ayrıntı kolonlarının seçimi", () => {
  it("okunabilir kimliği seçer", () => {
    expect(pickDetailColumns(teklifler).kimlik).toBe("TeklifNo");
  });

  it("GUID kolonunu kimlik SAYMAZ", () => {
    // "Id" kullaniciya hicbir sey anlatmiyor.
    expect(pickDetailColumns(teklifler).kimlik).not.toBe("Id");
  });

  it("durum kolonunu bulur", () => {
    expect(pickDetailColumns(teklifler).durum).toBe("Durum");
  });

  it("kimlik yoksa null döner", () => {
    const yalin = {
      ad: "T",
      kolonlar: [
        { ad: "MusteriAdi", tip: "nvarchar" },
        { ad: "CreatedAt", tip: "datetime2" },
      ],
    } as unknown as Tablo;
    expect(pickDetailColumns(yalin)).toEqual({ kimlik: null, durum: null });
  });
});

describe("ayrıntı sorgusu", () => {
  const k = pickAnalysisColumns(teklifler)!;
  const d = pickDetailColumns(teklifler);
  const sql = buildDetailQuery(k, d, "BOSTANCIOĞLU A.Ş.", range, sqlLiteral);

  it("varlığı TAM EŞİTLİKLE süzer", () => {
    // LIKE kullanmak baska musteriyi karistirirdi; ad zaten ozet
    // tablosundan, yani veritabanindan geliyor.
    expect(sql).toContain("[MusteriAdi] = 'BOSTANCIOĞLU A.Ş.'");
    expect(sql).not.toContain("LIKE");
  });

  it("silinmiş kayıtları ve zaman aralığını süzer", () => {
    expect(sql).toContain("IsDeleted = 0 AND");
    expect(sql).toContain("[CreatedAt] >=");
  });

  it("okunabilir kolonları seçer", () => {
    expect(sql).toContain("[TeklifNo] AS [Kayit]");
    expect(sql).toContain("[GenelToplam] AS [Tutar]");
    expect(sql).toContain("[Durum] AS [Durum]");
  });

  it("en yeni kayıt ÜSTTE", () => {
    expect(sql).toContain("ORDER BY [CreatedAt] DESC");
  });

  it("satır sayısını sınırlar", () => {
    expect(sql).toContain("SELECT TOP (50)");
  });

  it("tırnaklı adı kaçışlar", () => {
    expect(buildDetailQuery(k, d, "O'Brien", range, sqlLiteral))
      .toContain("= 'O''Brien'");
  });

  it("olmayan kolonu sorguya koymaz", () => {
    const yalin = {
      ad: "T",
      kolonlar: [
        { ad: "MusteriAdi", tip: "nvarchar" },
        { ad: "CreatedAt", tip: "datetime2" },
      ],
    } as unknown as Tablo;
    const ky = pickAnalysisColumns(yalin)!;
    const s = buildDetailQuery(ky, pickDetailColumns(yalin), "X", range, sqlLiteral);
    expect(s).not.toContain("[Tutar]");
    expect(s).not.toContain("[Durum]");
    expect(s).toContain("[CreatedAt] AS [Tarih]");
  });
});
