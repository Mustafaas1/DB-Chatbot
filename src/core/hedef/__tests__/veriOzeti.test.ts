import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import type { KolonDegerleri } from "../../db/degerler";
import { dataOverview } from "../veriOzeti";

const tablolar = [
  {
    ad: "Invoices", satirSayisi: 900,
    kolonlar: [
      { ad: "Id", tip: "uniqueidentifier" },
      { ad: "MusteriAdi", tip: "nvarchar" },
      { ad: "Durum", tip: "nvarchar" },
      { ad: "Tutar", tip: "decimal" },
      { ad: "CreatedAt", tip: "datetime2" },
      { ad: "IsDeleted", tip: "bit" },
    ],
  },
  {
    ad: "ContractRecords", satirSayisi: 300,
    kolonlar: [
      { ad: "Id", tip: "uniqueidentifier" },
      { ad: "Asama", tip: "nvarchar" },
    ],
  },
  // Bos tablo: olcum tasarlarken bilgi vermiyor.
  { ad: "BosTablo", satirSayisi: 0, kolonlar: [{ ad: "X", tip: "int" }] },
] as unknown as Tablo[];

const degerler: KolonDegerleri[] = [
  { tablo: "Invoices", kolon: "Durum", degerler: ["Faturalanacak", "Kesildi"] },
  { tablo: "ContractRecords", kolon: "Asama", degerler: ["Aktif", "Pasif"] },
];

describe("veri özeti", () => {
  it("tablo ve anlamlı kolonları yazar", () => {
    const m = dataOverview(tablolar, []);
    expect(m).toContain("Invoices (900 kayit)");
    expect(m).toContain("MusteriAdi");
  });

  it("gürültü kolonlarını atar", () => {
    // Id/tarih/bayrak kolonlari olcum tasarlarken bilgi vermiyor.
    const m = dataOverview(tablolar, []);
    expect(m).not.toContain("IsDeleted");
    expect(m).not.toContain("CreatedAt");
  });

  it("boş tabloyu listelemez", () => {
    expect(dataOverview(tablolar, [])).not.toContain("BosTablo");
  });

  it("DURUM DEĞERLERİNİ ağaca verir", () => {
    // Gercek hata: bu parametre alinip govdede hic kullanilmiyordu.
    // Agac kolon adlarini goruyor, degerleri gormuyordu; 8 olcumun 6'si
    // bos donuyordu ve boslar "Aktif musterilerin..." gibi uydurma
    // durumlara dayaniyordu.
    const m = dataOverview(tablolar, degerler);
    expect(m).toContain("Invoices.Durum = 'Faturalanacak', 'Kesildi'");
    expect(m).toContain("ContractRecords.Asama = 'Aktif', 'Pasif'");
  });

  it("'Aktif'in HANGİ tabloya ait olduğu görünür", () => {
    // Agacin "aktif musteri" uydurmasinin sebebi buydu: "Aktif" gercekten
    // var ama SOZLESMELERDE. Tablo adi olmadan bu ayrim kaybolur.
    const m = dataOverview(tablolar, degerler);
    const satir = m.split("\n").find((l) => l.includes("'Aktif'"));
    expect(satir).toContain("ContractRecords");
    expect(satir).not.toContain("Invoices");
  });

  it("uydurmama uyarısını taşır", () => {
    expect(dataOverview(tablolar, degerler)).toContain("UYDURMA");
  });

  it("değer yoksa bölümü HİÇ eklemez", () => {
    // Bos baslik yazmak modele anlamsiz gurultu vermek olurdu.
    expect(dataOverview(tablolar, [])).not.toContain("DURUM KOLONLARININ");
  });
});
