import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import { pickAnalysisColumns } from "../nedenAnalizi";
import { buildEntityLookupQuery, pickSingleMatch, readEntityMatches, sqlLiteral } from "../varlik";

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

const k = pickAnalysisColumns(invoices)!;

describe("metin sabiti kacislama", () => {
  it("tek tırnağı ikiler", () => {
    // Kacislanmazsa sorgu bozulur; kullanici girdisi SQL'e giriyor.
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it("kontrol karakterlerini atar", () => {
    // Kontrol karakteri KAYNAKTA degil, kod noktasindan uretiliyor:
    // ham kontrol bayti dosyaya yazmak bu projede tekrar eden bir hata.
    const kirli = `Fel${String.fromCharCode(0)}las${String.fromCharCode(31)}`;
    expect(sqlLiteral(kirli)).toBe("'Fellas'");
  });

  it("Türkçe karakterleri BOZMAZ", () => {
    // Veritabanindaki ad "SAĞLIK"; ASCII'ye indirmek eslesmeyi kacirirdi.
    expect(sqlLiteral("SAĞLIK ÜRÜNLERİ")).toBe("'SAĞLIK ÜRÜNLERİ'");
  });
});

describe("arama sorgusu", () => {
  it("LIKE ve silinmiş süzgeci kurar", () => {
    const sql = buildEntityLookupQuery(k, "fellas");
    expect(sql).toContain("[MusteriAdi] LIKE '%fellas%'");
    expect(sql).toContain("IsDeleted = 0 AND");
    expect(sql).toContain("GROUP BY [MusteriAdi]");
  });

  it("joker karakterler VERİ olarak kalır", () => {
    // "A_B" arayan kullaniciya "AXB" donmemeli.
    const sql = buildEntityLookupQuery(k, "A_B%C");
    expect(sql).toContain("LIKE '%A\\_B\\%C%' ESCAPE '\\'");
  });

  it("tırnaklı ad sorguyu bozmaz", () => {
    expect(buildEntityLookupQuery(k, "O'Brien")).toContain("'%O''Brien%'");
  });
});

describe("eşleşmelerin okunması", () => {
  const kolonlar = ["Deger", "Kayit"];

  it("boş adları eler", () => {
    const m = readEntityMatches(kolonlar, [["FELLAS GIDA", 2], [null, 5], ["  ", 1]]);
    expect(m).toEqual([{ value: "FELLAS GIDA", records: 2 }]);
  });
});

describe("tek eşleşme seçimi", () => {
  const coz = (matches: { value: string; records: number }[], query = "ADA") =>
    ({ query, table: "Invoices", column: "MusteriAdi", matches });

  it("tek eşleşmeyi seçer", () => {
    const m = { value: "FELLAS GIDA VE SAĞLIK ÜRÜNLERİ", records: 2 };
    expect(pickSingleMatch(coz([m], "fellas"))).toEqual(m);
  });

  it("belirsizlikte SEÇMEZ", () => {
    // Gercek veri: "ADA" iki musteriye birden uyuyor. Birini secip
    // digerini gizlemek, kaynak tablo seciminde reddedilen davranis.
    const secim = pickSingleMatch(coz([
      { value: "ADA TEKSTIL", records: 3 },
      { value: "ADALAR LOJISTIK", records: 1 },
    ]));
    expect(secim).toBeNull();
  });

  it("tam eşitlik belirsizliği çözer", () => {
    // "ADA" hem tam ad hem onek olabilir; TAM olan kazanir.
    const secim = pickSingleMatch(coz([
      { value: "ADA", records: 3 },
      { value: "ADALAR LOJISTIK", records: 1 },
    ]));
    expect(secim?.value).toBe("ADA");
  });

  it("hiç eşleşme yoksa null", () => {
    expect(pickSingleMatch(coz([]))).toBeNull();
  });
});
