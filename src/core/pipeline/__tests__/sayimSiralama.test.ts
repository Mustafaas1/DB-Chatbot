import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import { pickAnalysisColumns } from "../nedenAnalizi";
import {
  buildCountQuery, buildRankingQuery, pickRankingColumn, readCount,
} from "../sayimSiralama";
import type { TimeRange } from "../zamanAraligi";

const invoices = {
  ad: "Invoices",
  kolonlar: [
    { ad: "Id", tip: "uniqueidentifier" },
    { ad: "MusteriAdi", tip: "nvarchar" },
    { ad: "UrunAdi", tip: "nvarchar" },
    { ad: "Tutar", tip: "decimal" },
    { ad: "ParaBirimi", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

const k = pickAnalysisColumns(invoices)!;
const buAy: TimeRange = { kind: "calendar", unit: "month", offset: 0 };

describe("sayım sorgusu", () => {
  const sql = buildCountQuery(k, buAy);

  it("tek sayı döndürür", () => {
    expect(sql).toContain("COUNT(*) AS [Adet]");
    expect(sql).not.toContain("GROUP BY");
  });

  it("silinmiş kayıtları ve zaman aralığını süzer", () => {
    expect(sql).toContain("IsDeleted = 0 AND");
    expect(sql).toContain("[CreatedAt] >=");
  });

  it("benzersiz varlık sayısını da verir", () => {
    // "Bu ay kac fatura kesildi" ile "kac musteriye kesildi" farkli
    // sorular; ikisini de tek sorguda verip kullaniciya gostermek,
    // ikinci bir tur harcamaktan iyi.
    expect(sql).toContain("COUNT(DISTINCT [MusteriAdi]) AS [Varlik]");
  });
});

describe("sayım sonucunun okunması", () => {
  it("adet ve varlık sayısını çıkarır", () => {
    const c = readCount(["Adet", "Varlik"], [[44, 30]]);
    expect(c).toEqual({ adet: 44, varlik: 30 });
  });

  it("boş sonuçta sıfır döner", () => {
    // Sorgu calisip 0 satir donmesi ile 0 kayit olmasi ayni sey:
    // COUNT(*) her zaman bir satir dondurur.
    expect(readCount(["Adet", "Varlik"], [])).toEqual({ adet: 0, varlik: 0 });
  });

  it("varlık kolonu yoksa null verir", () => {
    expect(readCount(["Adet"], [[7]])).toEqual({ adet: 7, varlik: null });
  });
});

describe("sıralama kolonu seçimi", () => {
  it("'ürün' sorusu ürün kolonunu seçer", () => {
    expect(pickRankingColumn(invoices, "En çok satan ürünler")).toBe("UrunAdi");
  });

  it("'müşteri' sorusu müşteri kolonunu seçer", () => {
    expect(pickRankingColumn(invoices, "En fazla fatura kesilen müşteri")).toBe("MusteriAdi");
  });

  it("eşleşme yoksa null döner", () => {
    // Uydurup yanlis kolona gruplamaktansa ajana dusmek dogru.
    expect(pickRankingColumn(invoices, "En çok gecikmeli teslimat")).toBeNull();
  });

  it("sayısal ve kimlik kolonlarını seçmez", () => {
    expect(pickRankingColumn(invoices, "En yüksek tutar")).not.toBe("Tutar");
    expect(pickRankingColumn(invoices, "En çok id")).toBeNull();
  });
});

describe("sıralama sorgusu", () => {
  it("adede göre azalan sıralar", () => {
    const sql = buildRankingQuery(k, "UrunAdi", buAy, "ust", false);
    expect(sql).toContain("GROUP BY [UrunAdi]");
    expect(sql).toContain("ORDER BY [Olcu] DESC");
    expect(sql).toContain("COUNT(*) AS [Olcu]");
  });

  it("alt sıralamada ARTAN sıralar", () => {
    const sql = buildRankingQuery(k, "UrunAdi", buAy, "alt", false);
    expect(sql).toContain("ORDER BY [Olcu] ASC");
  });

  it("tutar sorulduğunda SUM kullanır", () => {
    const sql = buildRankingQuery(k, "MusteriAdi", buAy, "ust", true);
    expect(sql).toContain("SUM([Tutar]) AS [Olcu]");
    expect(sql).not.toContain("COUNT(*) AS [Olcu]");
  });

  it("tutar kolonu yoksa SUM istense bile adede düşer", () => {
    // Kolon olmadan SUM yazmak calisan ama anlamsiz SQL uretirdi.
    const tutarsiz = pickAnalysisColumns({
      ad: "T",
      kolonlar: [
        { ad: "MusteriAdi", tip: "nvarchar" },
        { ad: "CreatedAt", tip: "datetime2" },
      ],
    } as unknown as Tablo)!;
    expect(buildRankingQuery(tutarsiz, "MusteriAdi", buAy, "ust", true))
      .toContain("COUNT(*) AS [Olcu]");
  });

  it("boş grupları dışarıda bırakır", () => {
    // "(bos)" bir urun adi degil; siralamanin basinda durmasi yaniltici.
    expect(buildRankingQuery(k, "UrunAdi", buAy, "ust", false))
      .toContain("[UrunAdi] IS NOT NULL");
  });

  it("adede göre sıralamada KAYIT kolonu EKLENMEZ", () => {
    // Olcu de Kayit de COUNT(*) olurdu; ozet katmani ikisini iki ayri
    // olcu sanip "OLCU TOPLAMI 13 / KAYIT TOPLAMI 13" diye tekrarliyordu.
    expect(buildRankingQuery(k, "UrunAdi", buAy, "ust", false))
      .not.toContain("[Kayit]");
  });

  it("tutara göre sıralamada KAYIT kolonu EK BİLGİ verir", () => {
    expect(buildRankingQuery(k, "MusteriAdi", buAy, "ust", true))
      .toContain("COUNT(*) AS [Kayit]");
  });

  it("kolon adını kaçışlar", () => {
    expect(buildRankingQuery(k, "Ko]lon", buAy, "ust", false)).toContain("[Ko]]lon]");
  });
});
