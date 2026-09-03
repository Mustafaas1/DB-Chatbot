import { describe, expect, it } from "vitest";
import { summarizeList } from "../ozet";

describe("liste ozeti", () => {
  it("bos sonucta ozet uretmez", () => {
    const o = summarizeList(["MusteriAdi"], []);
    expect(o.rowCount).toBe(0);
    expect(o.cumle).toContain("boş");
  });

  it("adet, benzersiz varlik ve tekrar oranini hesaplar", () => {
    // 4 satir, 3 benzersiz musteri, 1'i tekrar ediyor -> %33.33
    const o = summarizeList(
      ["MusteriAdi", "Tutar"],
      [["A", 100], ["B", 200], ["A", 50], ["C", 25]]
    );
    expect(o.rowCount).toBe(4);
    expect(o.entityColumn).toBe("MusteriAdi");
    expect(o.uniqueEntities).toBe(3);
    expect(o.repeating).toBe(1);
    expect(o.repeatRate).toBe(33.33);
  });

  it("sayisal kolonun toplam ve ortalamasini verir", () => {
    const o = summarizeList(["MusteriAdi", "Tutar"], [["A", 100], ["B", 200]]);
    const toplam = o.measures.find((m) => m.etiket.includes("toplamı"));
    const ort = o.measures.find((m) => m.etiket.includes("ortalaması"));
    expect(toplam?.deger).toBe(300);
    expect(ort?.deger).toBe(150);
  });

  it("para birimlerini AYRI toplar", () => {
    // Farkli birimleri tek toplamda birlestirmek anlamsiz bir sayi uretir.
    const o = summarizeList(
      ["MusteriAdi", "ParaBirimi", "Tutar"],
      [["A", "TRY", 100], ["B", "USD", 10], ["C", "TRY", 200]]
    );
    const tr = o.measures.find((m) => m.kirilim === "TRY" && m.etiket.includes("toplamı"));
    const usd = o.measures.find((m) => m.kirilim === "USD" && m.etiket.includes("toplamı"));
    expect(tr?.deger).toBe(300);
    expect(usd?.deger).toBe(10);
  });

  it("null tutarlar toplama girmez", () => {
    // Gercek veride 29 faturanin ParaBirimi ve Tutar'i null.
    const o = summarizeList(["MusteriAdi", "Tutar"], [["A", 100], ["B", null], ["C", 50]]);
    const toplam = o.measures.find((m) => m.etiket.includes("toplamı"));
    expect(toplam?.deger).toBe(150);
  });

  it("sayisal kolon yoksa yine adet ve tekrar orani verir", () => {
    const o = summarizeList(["MusteriAdi"], [["A"], ["A"], ["B"]]);
    expect(o.uniqueEntities).toBe(2);
    expect(o.repeatRate).toBe(50);
    expect(o.measures).toHaveLength(0);
  });

  it("kabul senaryosunun gercek sayilarini uretir", () => {
    // 52 musteri, 73 fatura, 18'i tekrar eden -> %34.6
    const satirlar: unknown[][] = [];
    for (let i = 0; i < 52; i++) satirlar.push([`M${i}`, "TRY", 1000]);
    for (let i = 0; i < 18; i++) satirlar.push([`M${i}`, "TRY", 1000]);
    for (let i = 0; i < 3; i++) satirlar.push([`M${i}`, "TRY", 1000]);

    const o = summarizeList(["MusteriAdi", "ParaBirimi", "Tutar"], satirlar);
    expect(o.rowCount).toBe(73);
    expect(o.uniqueEntities).toBe(52);
    expect(o.repeating).toBe(18);
    expect(o.repeatRate).toBe(34.62);
  });
});

describe("gruplanmis sonuc", () => {
  it("adet kolonundan tekrar oranini okur", () => {
    // Kabul kosusunda sorgu musteri bazinda grupladi: her musteri tek
    // satir, adet ayri kolonda. Satir tekrarina bakmak "%0" veriyordu.
    const o = summarizeList(
      ["Müşteri Adı", "Satın Alma Adedi", "Toplam Tutar"],
      [["MANTİS", 2, 98400], ["SMMM GÜLAY", 2, 99360], ["WENGLOR", 1, 58800], ["YÜKSEL", 1, 15000]]
    );
    expect(o.uniqueEntities).toBe(4);
    expect(o.repeating).toBe(2);
    expect(o.repeatRate).toBe(50);
  });

  it("adet kolonu yoksa satir tekrarina dusuyor", () => {
    const o = summarizeList(["MusteriAdi", "Tutar"], [["A", 1], ["A", 2], ["B", 3]]);
    expect(o.uniqueEntities).toBe(2);
    expect(o.repeating).toBe(1);
  });
});
