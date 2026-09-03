import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import type { GoalNodeGenis } from "../../../schemas/index";
import { buildListingMeasurement } from "../listeleyici";

const tablolar = [
  {
    ad: "TicketRecords",
    kolonlar: [
      { ad: "Id", tip: "uniqueidentifier" }, { ad: "BiletNo", tip: "nvarchar" },
      { ad: "Baslik", tip: "nvarchar" }, { ad: "Asama", tip: "nvarchar" },
    ],
  },
  {
    ad: "Teklifler",
    kolonlar: [
      { ad: "Id", tip: "uniqueidentifier" }, { ad: "TeklifNo", tip: "nvarchar" },
      { ad: "MusteriAdi", tip: "nvarchar" }, { ad: "Durum", tip: "nvarchar" },
    ],
  },
  // Yazma islemi TANIMLI OLMAYAN tablo: aksiyona donusemez.
  { ad: "Products", kolonlar: [{ ad: "Kod", tip: "nvarchar" }, { ad: "Ad", tip: "nvarchar" }] },
] as unknown as Tablo[];

function dugum(o: Partial<GoalNodeGenis>): GoalNodeGenis {
  return {
    id: o.id ?? "d1",
    parentId: "parentId" in o ? o.parentId! : "kok",
    statement: o.statement ?? "",
    type: "metric", rationale: "", measurementQuery: o.measurementQuery ?? "",
    evidence: [], children: [], status: "pending",
  } as GoalNodeGenis;
}

const kok = dugum({ id: "kok", parentId: null, statement: "Hedef" });

describe("listeleyiciOlcumEkle", () => {

  it("hepsi topluysa listeleyici olcum uretir", () => {
    const d = [kok, dugum({ id: "a", measurementQuery: "SELECT COUNT(*) FROM dbo.Teklifler" })];
    const y = buildListingMeasurement(d, tablolar);

    expect(y).not.toBeNull();
    expect(y!.dugum.measurementQuery).toContain("Teklifler");
    expect(y!.dugum.measurementQuery).toContain("TeklifNo");
    // Toplama YAPILMAMALI: uretilen olcumun kendisi toplu olamaz.
    expect(y!.dugum.measurementQuery).toContain("gruplama ve sayim kullanma");
    expect(y!.dugum.parentId).toBe("kok");
  });

  it("olcum metinlerinde en cok gecen yazilabilir tabloyu secer", () => {
    const d = [
      kok,
      dugum({ id: "a", measurementQuery: "SELECT COUNT(*) FROM dbo.TicketRecords" }),
      dugum({ id: "b", measurementQuery: "TicketRecords asama dagilimi sayisi" }),
      dugum({ id: "c", measurementQuery: "SELECT COUNT(*) FROM dbo.Teklifler" }),
    ];
    expect(buildListingMeasurement(d, tablolar)!.dugum.measurementQuery).toContain("TicketRecords");
  });

  it("zaman araligi verilirse olcume tasinir", () => {
    const d = [kok, dugum({ id: "a", measurementQuery: "SELECT COUNT(*) FROM dbo.Teklifler" })];
    expect(buildListingMeasurement(d, tablolar, "son 1 ay")!.dugum.measurementQuery).toContain("son 1 ay");
  });

});

describe("tablo secimi metrige gore agirlikli", () => {
  /** Agac bilet olcumleriyle dolu; metrik ise satin alma. */
  const bileteKayanAgac = [
    kok,
    dugum({ id: "a", measurementQuery: "TicketRecords tablosunda bilet sayisi" }),
    dugum({ id: "b", measurementQuery: "TicketRecords asama dagilimi" }),
    dugum({ id: "c", measurementQuery: "TicketRecords atanan kisi basina bilet sayisi" }),
  ];

  it("satin alma metrigi bilet agacini yener", () => {
    // Onceden agacta en cok gecen tablo seciliyordu: satin alma sorusuna
    // bilet planlariyla cevap veriliyordu.
    const y = buildListingMeasurement(bileteKayanAgac, tablolar, "", "satin alim yapan musteri listesi");
    expect(y!.dugum.measurementQuery).toContain("Teklifler");
    expect(y!.dugum.measurementQuery).not.toContain("TicketRecords");
  });

  it("metrik yoksa agactaki agirlik gecerli kalir", () => {
    const y = buildListingMeasurement(bileteKayanAgac, tablolar, "");
    expect(y!.dugum.measurementQuery).toContain("TicketRecords");
  });

  it("destek metrigi bilet tablosunu secer", () => {
    const agac = [kok, dugum({ id: "a", measurementQuery: "Teklifler durum dagilimi" })];
    const y = buildListingMeasurement(agac, tablolar, "", "acik destek bileti sayisi");
    expect(y!.dugum.measurementQuery).toContain("TicketRecords");
  });

  it("teklif metrigi teklif tablosunu secer", () => {
    const agac = [kok, dugum({ id: "a", measurementQuery: "TicketRecords bilet sayisi" })];
    const y = buildListingMeasurement(agac, tablolar, "", "kazanilan teklif orani");
    expect(y!.dugum.measurementQuery).toContain("Teklifler");
  });
});

