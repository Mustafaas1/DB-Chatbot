import { describe, expect, it } from "vitest";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../../llm/tipler";
import { LlmHatasi } from "../../llm/tipler";
import { agacKur } from "../agac";
import { derinlikSirasi, kokDugum, olcumDugumleri } from "../tipler";
import { sonrakiTur } from "../istem";

class SahteSaglayici implements Saglayici {
  readonly ad = "sahte";
  readonly model = "sahte-1";
  readonly istekler: KonusmaIstegi[] = [];
  #n = 0;
  constructor(private readonly yanitlar: (string | Error | { metin: string; bitis: "uzunluk" })[]) {}

  async konus(istek: KonusmaIstegi): Promise<SaglayiciYaniti> {
    this.istekler.push(istek);
    const y = this.yanitlar[Math.min(this.#n++, this.yanitlar.length - 1)]!;
    if (y instanceof Error) throw y;
    const kirpik = typeof y === "object";
    return {
      metin: typeof y === "string" ? y : y.metin,
      aracCagrilari: [],
      bitisSebebi: kirpik ? "uzunluk" : "tamamlandi",
      model: this.model,
      kullanim: { girdiTokeni: 50, ciktiTokeni: 20 },
    };
  }
}

const IKI_COCUK = JSON.stringify([
  { baslik: "Birinci", gerekce: "cunku", olcumSorusu: "birinci soru" },
  { baslik: "Ikinci", gerekce: "cunku", olcumSorusu: "ikinci soru" },
]);

describe("katman turleri", () => {
  it("hedef -> surucu -> olcum -> aksiyon -> son", () => {
    expect(sonrakiTur("goal")).toBe("lever");
    expect(sonrakiTur("lever")).toBe("metric");
    expect(sonrakiTur("metric")).toBe("action");
    expect(sonrakiTur("action")).toBeNull();
  });
});

describe("agacKur", () => {
  it("kok soruyu hedef dugumu yapar", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "Destek yukunu azalt", azamiCagri: 1 });
    expect(kokDugum(a.dugumler)!.type).toBe("goal");
    expect(kokDugum(a.dugumler)!.statement).toBe("Destek yukunu azalt");
    expect(kokDugum(a.dugumler)!.parentId).toBeNull();
  });

  it("katmanlari sirayla kurar", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiCagri: 3 });
    const kok = kokDugum(a.dugumler)!;
    const cocuklar = kok.children.map((id) => a.dugumler.find((d) => d.id === id)!);
    expect(cocuklar.map((c) => c.type)).toEqual(["lever", "lever"]);
    const torun = cocuklar[0]!.children.map((id) => a.dugumler.find((d) => d.id === id)!);
    expect(torun[0]?.type).toBe("metric");
  });

  it("azamiDerinlik asilmaz", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiDerinlik: 1, azamiCagri: 20 });
    expect(Math.max(...derinlikSirasi(a.dugumler).map((x) => x.derinlik))).toBe(1);
  });

  it("azamiCagri butcesi asilmaz", async () => {
    const s = new SahteSaglayici([IKI_COCUK]);
    const a = await agacKur({ saglayici: s, soru: "S", azamiCagri: 2, azamiDerinlik: 5 });
    expect(s.istekler.length).toBe(2);
    expect(a.kullanim.cagriSayisi).toBe(2);
    expect(a.genisletilmeyen).toBeGreaterThan(0);
  });

  it("olcum dugumlerine olcumSorusu yazilir", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiCagri: 3 });
    const olcumler = olcumDugumleri(a.dugumler);
    expect(olcumler.length).toBeGreaterThan(0);
    expect(olcumler[0]?.measurementQuery).toBeTruthy();
  });

  it("genislikte arama: ust katman once tamamlanir", async () => {
    // Butce 3: kok + iki surucu genisletilir, derine inilmez.
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiCagri: 3, azamiDerinlik: 5 });
    expect(kokDugum(a.dugumler)!.children).toHaveLength(2);
    expect(a.dugumler.find((d) => d.id === kokDugum(a.dugumler)!.children[0])!.children).toHaveLength(2);
    expect(a.dugumler.find((d) => d.id === kokDugum(a.dugumler)!.children[1])!.children).toHaveLength(2);
  });
});

describe("dayaniklilik", () => {
  it("kod blogu icindeki JSON ayiklanir", async () => {
    const a = await agacKur({
      saglayici: new SahteSaglayici(["```json\n" + IKI_COCUK + "\n```"]),
      soru: "S", azamiCagri: 1,
    });
    expect(kokDugum(a.dugumler)!.children).toHaveLength(2);
  });

  it("JSON etrafindaki aciklama metni sorun cikarmaz", async () => {
    const a = await agacKur({
      saglayici: new SahteSaglayici(["Iste cocuklar: " + IKI_COCUK + " umarim yardimci olur"]),
      soru: "S", azamiCagri: 1,
    });
    expect(kokDugum(a.dugumler)!.children).toHaveLength(2);
  });

  it("kirpik cikti tekrar denenir", async () => {
    const s = new SahteSaglayici([{ metin: "[{\"baslik\":\"yar", bitis: "uzunluk" }, IKI_COCUK]);
    const a = await agacKur({ saglayici: s, soru: "S", azamiCagri: 3 });
    expect(kokDugum(a.dugumler)!.children).toHaveLength(2);
    // Ikinci denemede butce daha genis olmali.
    expect(s.istekler[1]?.azamiCiktiTokeni).toBeGreaterThan(s.istekler[0]!.azamiCiktiTokeni!);
  });

  it("bozuk JSON agaci comertmez, dugum genisletilmemis kalir", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici(["bu JSON degil"]), soru: "S", azamiCagri: 4 });
    expect(kokDugum(a.dugumler)!.children).toHaveLength(0);
    expect(a.genisletilmeyen).toBeGreaterThan(0);
  });

  it("kota hatasinda agac kurulmus kismiyla doner", async () => {
    const s = new SahteSaglayici([IKI_COCUK, new LlmHatasi("429", "kota")]);
    const a = await agacKur({ saglayici: s, soru: "S", azamiCagri: 10 });
    expect(kokDugum(a.dugumler)!.children).toHaveLength(2);
    expect(a.genisletilmeyen).toBeGreaterThan(0);
  });
});
