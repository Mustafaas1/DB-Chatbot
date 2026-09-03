import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { IslemTanimi, Prova } from "../tipler";

// Gercek islemler veritabanina gider; testte sahte beyaz liste kullaniyoruz.
const durum = { uygulandi: 0, geriAlindi: 0, patlasin: false };

const provaDolu: Prova = {
  ozet: "HT1 atanan kisisi 'A' -> 'B'", etkilenen: 1,
  degisiklikler: [{ kimlik: "HT1", alan: "AtananKisi", onceki: "A", sonraki: "B" }],
  uyarilar: [],
};
const provaBos: Prova = { ozet: "degismiyor", etkilenen: 0, degisiklikler: [], uyarilar: [] };

const sahteIslem: IslemTanimi<{ biletNo: string; kisi: string }> = {
  kod: "bilet_ata", ad: "Bileti kisiye ata", aciklama: "test", risk: "low",
  hedefTablo: "TicketRecords",
  kimlikParametresi: "biletNo",
  kimlikKolonu: "BiletNo",
  parametreSemasi: z.object({ biletNo: z.string().min(1), kisi: z.string().min(1) }),
  async prova(p) { return p.biletNo === "YOK" ? provaBos : provaDolu; },
  async uygula() {
    if (durum.patlasin) throw new Error("veritabani reddetti");
    durum.uygulandi++;
    return { etkilenen: 1, oncekiDurum: { biletNo: "HT1", alan: "AtananKisi", onceki: "A" } };
  },
  async geriAl() { durum.geriAlindi++; return { etkilenen: 1 }; },
};

vi.mock("../islemler", () => ({
  AZAMI_ETKI: 50,
  ISLEMLER: [sahteIslem],
  islemBul: (kod: string) => (kod === "bilet_ata" ? sahteIslem : undefined),
}));
vi.mock("../havuzYaz", () => ({
  yazmaAcikMi: () => true,
  yazmaHavuzuGetir: async () => { throw new Error("testte kullanilmaz"); },
  YazmaKapaliHatasi: class extends Error {},
}));

const { oner, uygula, reddet, geriAl, OnayHatasi } = await import("../yurutucu");
const denetim = await import("../denetim");

beforeEach(() => {
  denetim._testIcinSifirla();
  durum.uygulandi = 0; durum.geriAlindi = 0; durum.patlasin = false;
});

describe("oner", () => {
  it("prova yapar ve denetime yazar, HICBIR SEY DEGISTIRMEZ", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    expect(durum.uygulandi).toBe(0);
    expect(o.onaylanabilir).toBe(true);
    expect(denetim.getir(o.kayitId)?.durum).toBe("oneri");
  });

  it("beyaz listede olmayan islem reddedilir", async () => {
    await expect(oner("tablo_sil", {})).rejects.toThrow(/Beyaz listede yok/);
  });

  it("gecersiz parametre reddedilir", async () => {
    await expect(oner("bilet_ata", { biletNo: "", kisi: "B" })).rejects.toThrow(OnayHatasi);
  });

  it("0 kayit etkileyen oneri onaylanabilir degildir", async () => {
    const o = await oner("bilet_ata", { biletNo: "YOK", kisi: "B" });
    expect(o.onaylanabilir).toBe(false);
  });
});

describe("ONAY KAPISI", () => {
  it("onaylayan olmadan uygulanamaz", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    await expect(uygula(o.kayitId, "")).rejects.toThrow(/Onaylayan belirtilmeden/);
    await expect(uygula(o.kayitId, "   ")).rejects.toThrow(OnayHatasi);
    expect(durum.uygulandi).toBe(0);
  });

  it("onaylanan islem uygulanir ve onceki durum saklanir", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    const k = await uygula(o.kayitId, "Mustafa");
    expect(durum.uygulandi).toBe(1);
    expect(k.durum).toBe("uygulandi");
    expect(k.onaylayan).toBe("Mustafa");
    expect(k.oncekiDurum).toBeTruthy();
  });

  it("AYNI ISLEM IKI KEZ uygulanamaz", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    await uygula(o.kayitId, "Mustafa");
    await expect(uygula(o.kayitId, "Mustafa")).rejects.toThrow(/yalnizca "oneri"/);
    expect(durum.uygulandi).toBe(1);
  });

  it("0 kayit etkileyen islem uygulanamaz", async () => {
    const o = await oner("bilet_ata", { biletNo: "YOK", kisi: "B" });
    await expect(uygula(o.kayitId, "Mustafa")).rejects.toThrow(/anlamsiz/);
  });

  it("reddedilen islem uygulanamaz", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    reddet(o.kayitId, "Mustafa");
    await expect(uygula(o.kayitId, "Mustafa")).rejects.toThrow(OnayHatasi);
    expect(durum.uygulandi).toBe(0);
  });
});

describe("denetim kaydi", () => {
  it("REDDEDILEN de kaydedilir", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    reddet(o.kayitId, "Mustafa");
    const k = denetim.getir(o.kayitId)!;
    expect(k.durum).toBe("reddedildi");
    expect(k.onaylayan).toBe("Mustafa");
  });

  it("BASARISIZ da kaydedilir, hata metniyle", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    durum.patlasin = true;
    await expect(uygula(o.kayitId, "Mustafa")).rejects.toThrow("veritabani reddetti");
    const k = denetim.getir(o.kayitId)!;
    expect(k.durum).toBe("basarisiz");
    expect(k.hata).toContain("veritabani reddetti");
  });

  it("listede en yeni ustte", async () => {
    await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    await oner("bilet_ata", { biletNo: "HT1", kisi: "C" });
    expect(denetim.listele().length).toBe(2);
  });
});

describe("geri alma", () => {
  it("uygulanan islem geri alinir", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    await uygula(o.kayitId, "Mustafa");
    const k = await geriAl(o.kayitId, "Mustafa");
    expect(durum.geriAlindi).toBe(1);
    expect(k.durum).toBe("geri_alindi");
  });

  it("uygulanmamis islem geri alinamaz", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    await expect(geriAl(o.kayitId, "Mustafa")).rejects.toThrow(/yalnizca "uygulandi"/i);
  });

  it("iki kez geri alinamaz", async () => {
    const o = await oner("bilet_ata", { biletNo: "HT1", kisi: "B" });
    await uygula(o.kayitId, "Mustafa");
    await geriAl(o.kayitId, "Mustafa");
    await expect(geriAl(o.kayitId, "Mustafa")).rejects.toThrow(OnayHatasi);
    expect(durum.geriAlindi).toBe(1);
  });
});
