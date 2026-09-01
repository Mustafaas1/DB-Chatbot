import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../tipler";
import { yapisalIste, YapisalCiktiHatasi } from "../yapisal";

class Sahte implements Saglayici {
  readonly ad = "sahte"; readonly model = "s1";
  readonly istekler: KonusmaIstegi[] = [];
  #n = 0;
  constructor(private readonly yanitlar: (string | { metin: string; kirpik: true })[]) {}
  async konus(i: KonusmaIstegi): Promise<SaglayiciYaniti> {
    this.istekler.push(i);
    const y = this.yanitlar[Math.min(this.#n++, this.yanitlar.length - 1)]!;
    const kirpik = typeof y === "object";
    return {
      metin: typeof y === "string" ? y : y.metin,
      aracCagrilari: [], bitisSebebi: kirpik ? "uzunluk" : "tamamlandi",
      model: this.model, kullanim: { girdiTokeni: 50, ciktiTokeni: 20 },
    };
  }
}

const SEMA = z.object({ ad: z.string(), sayi: z.number().int() });
const istek = { mesajlar: [{ rol: "kullanici" as const, metin: "s" }], azamiCiktiTokeni: 500 };
const calistir = (y: (string | { metin: string; kirpik: true })[], saglayici = new Sahte(y)) =>
  ({ saglayici, sonuc: yapisalIste({ saglayici, istek, sema: SEMA }) });

describe("yapisal cikti istenir", () => {
  it("saglayiciya jsonCikti bayragi gecer", async () => {
    const s = new Sahte(['{"ad":"a","sayi":1}']);
    await yapisalIste({ saglayici: s, istek, sema: SEMA });
    expect(s.istekler[0]!.jsonCikti).toBe(true);
  });

  it("temiz JSON dogrudan cozulur", async () => {
    const r = await yapisalIste({ saglayici: new Sahte(['{"ad":"a","sayi":1}']), istek, sema: SEMA });
    expect(r.deger).toEqual({ ad: "a", sayi: 1 });
    expect(r.tekrarDenendi).toBe(false);
  });
});

describe("geri dusus: metin icinde JSON", () => {
  it("kod blogu icindeki JSON okunur", async () => {
    const r = await yapisalIste({
      saglayici: new Sahte(["```json" + "\n" + '{"ad":"a","sayi":1}' + "\n" + "```"]),
      istek, sema: SEMA,
    });
    expect(r.deger.ad).toBe("a");
  });

  it("aciklama metniyle sarili JSON okunur", async () => {
    const r = await yapisalIste({
      saglayici: new Sahte(['Iste sonuc: {"ad":"a","sayi":1} umarim yardimci olur']),
      istek, sema: SEMA,
    });
    expect(r.deger.sayi).toBe(1);
  });
});

describe("SEMA DISI CIKTI REDDEDILIR", () => {
  it("yanlis tip reddedilir", async () => {
    await expect(yapisalIste({
      saglayici: new Sahte(['{"ad":"a","sayi":"metin"}']), istek, sema: SEMA,
    })).rejects.toThrow(YapisalCiktiHatasi);
  });

  it("eksik alan reddedilir", async () => {
    await expect(yapisalIste({
      saglayici: new Sahte(['{"ad":"a"}']), istek, sema: SEMA,
    })).rejects.toThrow(YapisalCiktiHatasi);
  });

  it("JSON olmayan cikti reddedilir", async () => {
    await expect(yapisalIste({
      saglayici: new Sahte(["bu duz metin"]), istek, sema: SEMA,
    })).rejects.toThrow(YapisalCiktiHatasi);
  });
});

describe("TEK retry", () => {
  it("ilk deneme bozuksa ikinci denenir", async () => {
    const s = new Sahte(["bozuk", '{"ad":"a","sayi":2}']);
    const r = await yapisalIste({ saglayici: s, istek, sema: SEMA });
    expect(r.deger.sayi).toBe(2);
    expect(r.tekrarDenendi).toBe(true);
    expect(s.istekler).toHaveLength(2);
  });

  it("EN FAZLA iki deneme yapilir", async () => {
    const s = new Sahte(["bozuk"]);
    await expect(yapisalIste({ saglayici: s, istek, sema: SEMA })).rejects.toThrow();
    expect(s.istekler).toHaveLength(2);
  });

  it("retry'de cikti butcesi artar", async () => {
    const s = new Sahte(["bozuk", '{"ad":"a","sayi":1}']);
    await yapisalIste({ saglayici: s, istek, sema: SEMA });
    expect(s.istekler[1]!.azamiCiktiTokeni!).toBeGreaterThan(s.istekler[0]!.azamiCiktiTokeni!);
  });

  it("kirpik cikti da retry tetikler", async () => {
    const s = new Sahte([{ metin: '{"ad":"a"', kirpik: true }, '{"ad":"a","sayi":3}']);
    const r = await yapisalIste({ saglayici: s, istek, sema: SEMA });
    expect(r.deger.sayi).toBe(3);
  });

  it("token kullanimi her iki denemeden toplanir", async () => {
    const r = await yapisalIste({
      saglayici: new Sahte(["bozuk", '{"ad":"a","sayi":1}']), istek, sema: SEMA,
    });
    expect(r.kullanim.girdiTokeni).toBe(100);
  });
});
