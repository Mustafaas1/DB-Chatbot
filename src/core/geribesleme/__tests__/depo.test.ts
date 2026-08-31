import { describe, it, expect, beforeEach } from "vitest";
import {
  _testIcinSifirla,
  snapshotKaydet,
  snapshotlariGetir,
  snapshotSayisi,
  baglamKaydet,
  baglamlariGetir,
  geriBeslemeDurumlari,
} from "../depo";

beforeEach(() => {
  _testIcinSifirla();
});

describe("snapshot deposu", () => {
  it("snapshot kaydeder ve geri okur", () => {
    const id = snapshotKaydet(
      "d1", "dug1", "destek", "Açık biletler",
      "SELECT COUNT(*) FROM TicketRecords",
      ["Asama", "Sayi"],
      [["Beklemede", 47], ["İşlemde", 12]],
      "once"
    );

    expect(id).toBeTruthy();

    const sonuclar = snapshotlariGetir("d1");
    expect(sonuclar).toHaveLength(1);
    expect(sonuclar[0]!.denetimId).toBe("d1");
    expect(sonuclar[0]!.dugumId).toBe("dug1");
    expect(sonuclar[0]!.ajanKod).toBe("destek");
    expect(sonuclar[0]!.soru).toBe("Açık biletler");
    expect(sonuclar[0]!.kolonlar).toEqual(["Asama", "Sayi"]);
    expect(sonuclar[0]!.satirlar).toEqual([["Beklemede", 47], ["İşlemde", 12]]);
    expect(sonuclar[0]!.satirSayisi).toBe(2);
    expect(sonuclar[0]!.tur).toBe("once");
  });

  it("ture gore filtreler", () => {
    snapshotKaydet("d1", "dug1", "destek", "S1", "", ["A"], [[1]], "once");
    snapshotKaydet("d1", "dug1", "destek", "S1", "", ["A"], [[2]], "sonra");

    const once = snapshotlariGetir("d1", "once");
    const sonra = snapshotlariGetir("d1", "sonra");
    const hepsi = snapshotlariGetir("d1");

    expect(once).toHaveLength(1);
    expect(sonra).toHaveLength(1);
    expect(hepsi).toHaveLength(2);
    expect(once[0]!.tur).toBe("once");
    expect(sonra[0]!.tur).toBe("sonra");
  });

  it("snapshot sayisini hesaplar", () => {
    snapshotKaydet("d1", "dug1", "destek", "S1", "", [], [], "once");
    snapshotKaydet("d1", "dug2", "satis", "S2", "", [], [], "once");
    snapshotKaydet("d1", "dug1", "destek", "S1", "", [], [], "sonra");

    const say = snapshotSayisi("d1");
    expect(say.once).toBe(2);
    expect(say.sonra).toBe(1);
  });

  it("farkli denetim idlerini karistirmaz", () => {
    snapshotKaydet("d1", "dug1", "destek", "S1", "", [], [], "once");
    snapshotKaydet("d2", "dug2", "satis", "S2", "", [], [], "once");

    expect(snapshotlariGetir("d1")).toHaveLength(1);
    expect(snapshotlariGetir("d2")).toHaveLength(1);
  });
});

describe("ölçüm bağlamı deposu", () => {
  it("bağlam kaydeder ve geri okur", () => {
    const id = baglamKaydet("d1", {
      dugumId: "dug1",
      ajanKod: "destek",
      soru: "Açık biletler",
      sql: "SELECT Asama, COUNT(*) FROM TicketRecords GROUP BY Asama",
      tablolar: ["TicketRecords", "TicketActivities"],
    });

    expect(id).toBeTruthy();

    const baglamlar = baglamlariGetir("d1");
    expect(baglamlar).toHaveLength(1);
    expect(baglamlar[0]!.dugumId).toBe("dug1");
    expect(baglamlar[0]!.ajanKod).toBe("destek");
    expect(baglamlar[0]!.soru).toBe("Açık biletler");
    expect(baglamlar[0]!.sql).toContain("SELECT");
    expect(baglamlar[0]!.tablolar).toEqual(["TicketRecords", "TicketActivities"]);
  });

  it("farkli denetim idlerini karistirmaz", () => {
    baglamKaydet("d1", { dugumId: "a", ajanKod: "x", soru: "S1", sql: "", tablolar: [] });
    baglamKaydet("d2", { dugumId: "b", ajanKod: "y", soru: "S2", sql: "", tablolar: [] });

    expect(baglamlariGetir("d1")).toHaveLength(1);
    expect(baglamlariGetir("d2")).toHaveLength(1);
  });
});

describe("geri besleme durumlari", () => {
  it("bos denetim listesi icin bos doner", () => {
    expect(geriBeslemeDurumlari([])).toEqual([]);
  });

  it("snapshot durumlarini dogru bildirir", () => {
    snapshotKaydet("d1", "dug1", "destek", "S1", "", [], [], "once");
    snapshotKaydet("d1", "dug1", "destek", "S1", "", [], [], "sonra");

    const durumlar = geriBeslemeDurumlari(["d1", "d2"]);
    const d1 = durumlar.find((d) => d.denetimId === "d1")!;
    const d2 = durumlar.find((d) => d.denetimId === "d2")!;

    expect(d1.onceVar).toBe(true);
    expect(d1.sonraVar).toBe(true);
    expect(d1.sonOlcum).toBeTruthy();

    expect(d2.onceVar).toBe(false);
    expect(d2.sonraVar).toBe(false);
    expect(d2.sonOlcum).toBeNull();
  });
});
