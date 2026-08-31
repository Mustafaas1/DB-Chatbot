import { describe, it, expect } from "vitest";
import { etkiHesapla } from "../etki";
import type { OlcumSnapshot } from "../tipler";

function snapshot(
  tur: "once" | "sonra",
  kolonlar: string[],
  satirlar: unknown[][],
  ek: Partial<OlcumSnapshot> = {}
): OlcumSnapshot {
  return {
    id: `test-${tur}`,
    denetimId: "d1",
    dugumId: "dug1",
    ajanKod: "destek",
    soru: "Test sorusu",
    sqlSorgu: "SELECT 1",
    kolonlar,
    satirlar,
    satirSayisi: satirlar.length,
    tur,
    olusturma: new Date().toISOString(),
    ...ek,
  };
}

describe("etkiHesapla", () => {
  it("satir sayisi degisimini hesaplar", () => {
    const once = snapshot("once", ["Asama", "Sayi"], [
      ["Beklemede", 47],
      ["İşlemde", 12],
    ]);
    const sonra = snapshot("sonra", ["Asama", "Sayi"], [
      ["Beklemede", 30],
      ["İşlemde", 20],
      ["Tamamlandı", 9],
    ]);

    const rapor = etkiHesapla(once, sonra, true);
    expect(rapor.satirDegisimi.onceki).toBe(2);
    expect(rapor.satirDegisimi.sonraki).toBe(3);
    expect(rapor.satirDegisimi.fark).toBe(1);
    expect(rapor.satirDegisimi.yon).toBe("artis");
  });

  it("sayisal kolon farki ve yuzde hesaplar", () => {
    const once = snapshot("once", ["Asama", "Sayi"], [
      ["Beklemede", 100],
      ["İşlemde", 50],
    ]);
    const sonra = snapshot("sonra", ["Asama", "Sayi"], [
      ["Beklemede", 80],
      ["İşlemde", 70],
    ]);

    const rapor = etkiHesapla(once, sonra, true);

    // Kolon toplami: once 150, sonra 150 → fark 0
    const sayiEtki = rapor.kolonEtkileri.find((k) => k.kolon === "Sayi");
    expect(sayiEtki).toBeDefined();
    expect(sayiEtki!.fark).toBe(0);
    expect(sayiEtki!.yon).toBe("ayni");
  });

  it("toplam artis hesaplar", () => {
    const once = snapshot("once", ["Kategori", "Tutar"], [
      ["A", 200],
      ["B", 300],
    ]);
    const sonra = snapshot("sonra", ["Kategori", "Tutar"], [
      ["A", 250],
      ["B", 350],
    ]);

    const rapor = etkiHesapla(once, sonra, true);
    const tutarEtki = rapor.kolonEtkileri.find((k) => k.kolon === "Tutar");
    expect(tutarEtki!.fark).toBe(100);
    expect(tutarEtki!.yon).toBe("artis");
    expect(tutarEtki!.yuzde).toBe(20); // 500 → 600 = +20%
  });

  it("toplam azalis hesaplar", () => {
    const once = snapshot("once", ["Tip", "Adet"], [
      ["Bilet", 50],
    ]);
    const sonra = snapshot("sonra", ["Tip", "Adet"], [
      ["Bilet", 30],
    ]);

    const rapor = etkiHesapla(once, sonra, true);
    const adetEtki = rapor.kolonEtkileri.find((k) => k.kolon === "Adet");
    expect(adetEtki!.fark).toBe(-20);
    expect(adetEtki!.yon).toBe("azalis");
    expect(adetEtki!.yuzde).toBe(-40);
  });

  it("satir bazinda karsilastirma yapar", () => {
    const once = snapshot("once", ["Asama", "Sayi"], [
      ["Beklemede", 47],
      ["İşlemde", 12],
    ]);
    const sonra = snapshot("sonra", ["Asama", "Sayi"], [
      ["Beklemede", 30],
      ["İşlemde", 20],
    ]);

    const rapor = etkiHesapla(once, sonra, true);
    expect(rapor.satirKarsilastirmalari.length).toBeGreaterThan(0);

    const beklemede = rapor.satirKarsilastirmalari.find((s) => s.anahtar === "Beklemede");
    expect(beklemede).toBeDefined();
    expect(beklemede!.degisimler[0]!.onceki).toBe(47);
    expect(beklemede!.degisimler[0]!.sonraki).toBe(30);
    expect(beklemede!.degisimler[0]!.fark).toBe(-17);
  });

  it("bos snapshot durumunu uygun sekilde isler", () => {
    const once = snapshot("once", [], []);
    const sonra = snapshot("sonra", [], []);

    const rapor = etkiHesapla(once, sonra, false);
    expect(rapor.satirDegisimi.fark).toBe(0);
    expect(rapor.satirDegisimi.yon).toBe("ayni");
    expect(rapor.kolonEtkileri).toEqual([]);
    expect(rapor.satirKarsilastirmalari).toEqual([]);
    expect(rapor.gercekOnceMi).toBe(false);
  });

  it("gercekOnceMi bayragi dogru aktarilir", () => {
    const once = snapshot("once", ["X"], [[1]]);
    const sonra = snapshot("sonra", ["X"], [[2]]);

    expect(etkiHesapla(once, sonra, true).gercekOnceMi).toBe(true);
    expect(etkiHesapla(once, sonra, false).gercekOnceMi).toBe(false);
  });

  it("yuzde hesaplama: onceki 0 ise null doner", () => {
    const once = snapshot("once", ["K", "V"], [["A", 0]]);
    const sonra = snapshot("sonra", ["K", "V"], [["A", 10]]);

    const rapor = etkiHesapla(once, sonra, true);
    const etki = rapor.kolonEtkileri.find((k) => k.kolon === "V");
    expect(etki!.yuzde).toBeNull();
  });

  it("kolon eslesmezse etki bos kalir", () => {
    const once = snapshot("once", ["X", "Deger1"], [["a", 10]]);
    const sonra = snapshot("sonra", ["Y", "Deger2"], [["a", 20]]);

    const rapor = etkiHesapla(once, sonra, true);
    expect(rapor.kolonEtkileri).toEqual([]);
  });
});

describe("kolon etkisi once/sonra tasir", () => {
  // Onceden yalnizca fark vardi; "+1" ile "47 -> 48" arasinda
  // okunabilirlik farki var ve farkin buyuklugu ancak tabana bakilinca
  // anlam kazaniyor.
  it("onceki ve sonraki toplamlar raporda yer alir", () => {
    const once = snapshot("once", ["Asama", "Bilet Sayisi"], [["Beklemede", 47], ["İşlemde", 12]]);
    const sonra = snapshot("sonra", ["Asama", "Bilet Sayisi"], [["Beklemede", 47], ["İşlemde", 13]]);
    const r = etkiHesapla(once, sonra, true);

    const k = r.kolonEtkileri.find((x) => x.kolon === "Bilet Sayisi");
    expect(k?.onceki).toBe(59);
    expect(k?.sonraki).toBe(60);
    expect(k?.fark).toBe(1);
  });
});
