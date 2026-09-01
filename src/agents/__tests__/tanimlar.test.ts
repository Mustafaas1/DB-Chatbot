import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AJAN_TANIMLARI, PLANLAMA_AJANLARI, YURUTME_AJANI, ajanTanimiBul } from "../index";
import { AjanTanimHatasi, YAZMA_ARACLARI, tanimlariDenetle, type AjanTanimi } from "../tipler";

function ajan(ek: Partial<AjanTanimi> = {}): AjanTanimi {
  return {
    kod: "test", ad: "Test", renk: "#000", tur: "planlama",
    aciklama: "t", rolPromptu: "t", araclar: ["veri_sorgula"],
    ciktiSemasi: z.object({}), tablolar: ["TicketRecords"], ornekler: [],
    limitler: { azamiTur: 2, azamiCiktiTokeni: 800, azamiCagri: 3 },
    ...ek,
  };
}

describe("TEMEL KURAL: yazma yalnizca yurutme ajaninda", () => {
  it("planlama ajani yazma araci tasiyamaz", () => {
    expect(() => tanimlariDenetle([ajan({ araclar: ["veri_sorgula", "bilet_ata"] })]))
      .toThrow(AjanTanimHatasi);
  });

  it("orkestra ajani yazma araci tasiyamaz", () => {
    expect(() => tanimlariDenetle([ajan({ tur: "orkestra", araclar: ["bilet_ata"] })]))
      .toThrow(AjanTanimHatasi);
  });

  it("yurutme ajani yazma araci TASIYABILIR", () => {
    expect(() => tanimlariDenetle([ajan({ tur: "yurutme", araclar: ["bilet_ata"] })]))
      .not.toThrow();
  });

  it("birden fazla yurutme ajani olamaz", () => {
    expect(() => tanimlariDenetle([
      ajan({ kod: "a", tur: "yurutme" }), ajan({ kod: "b", tur: "yurutme" }),
    ])).toThrow(/TEK ajanda/);
  });

  it("orkestra ajani hic arac tasiyamaz", () => {
    expect(() => tanimlariDenetle([ajan({ tur: "orkestra", araclar: ["veri_sorgula"] })]))
      .toThrow(/arac tasiyamaz/);
  });
});

describe("tanim butunlugu", () => {
  it("ayni kod iki kez olamaz", () => {
    expect(() => tanimlariDenetle([ajan(), ajan()])).toThrow(/Ayni kod/);
  });

  it("gecersiz limit reddedilir", () => {
    expect(() => tanimlariDenetle([ajan({
      limitler: { azamiTur: 0, azamiCiktiTokeni: 100, azamiCagri: 1 },
    })])).toThrow(/limitleri gecersiz/);
  });
});

describe("gercek kayit", () => {
  it("spec'teki 7 ajan + proje/IK icin eklenen 2 ajan tanimli", () => {
    expect(AJAN_TANIMLARI).toHaveLength(9);
    for (const kod of [
      "orchestrator", "data-analyst", "acquisition", "retention",
      "experience", "product-pricing", "ops-executor",
      // Spec'te yok; bu CRM'de proje ve IK verisi oldugu icin eklendi.
      "delivery", "people",
    ]) expect(ajanTanimiBul(kod), kod).toBeTruthy();
  });

  it("her tablo TEK ajana ait (data-analyst haric)", () => {
    const sahip = new Map<string, string[]>();
    for (const a of PLANLAMA_AJANLARI) {
      if (a.kod === "data-analyst") continue;  // kesitsel, ortak gorur
      for (const t of a.tablolar) sahip.set(t, [...(sahip.get(t) ?? []), a.kod]);
    }
    const cakisan = [...sahip.entries()].filter(([, v]) => v.length > 1);
    // Products ve Teklifler bilincli olarak paylasilir (kazanim + fiyat).
    const beklenen = new Set(["Products", "Teklifler", "TeklifKalemleri", "Contacts", "CustomerProducts", "InvoiceKalemleri"]);
    for (const [tablo] of cakisan) expect(beklenen.has(tablo), tablo).toBe(true);
  });

  it("HICBIR planlama ajaninda yazma araci yok", () => {
    for (const a of PLANLAMA_AJANLARI) {
      const yazma = a.araclar.filter((t) => YAZMA_ARACLARI.includes(t));
      expect(yazma, `${a.kod} yazma araci tasiyor`).toEqual([]);
    }
  });

  it("yazma yetkisi tek ajanda", () => {
    expect(AJAN_TANIMLARI.filter((a) => a.tur === "yurutme")).toHaveLength(1);
    expect(YURUTME_AJANI.kod).toBe("ops-executor");
  });

  it("her ajanin rol promptu, cikti semasi ve limiti var", () => {
    for (const a of AJAN_TANIMLARI) {
      expect(a.rolPromptu.length, a.kod).toBeGreaterThan(20);
      expect(a.ciktiSemasi, a.kod).toBeTruthy();
      expect(a.limitler.azamiTur, a.kod).toBeGreaterThan(0);
    }
  });

  it("orkestra ajaninin tablo erisimi yok", () => {
    expect(ajanTanimiBul("orchestrator")!.tablolar).toEqual([]);
  });
});
