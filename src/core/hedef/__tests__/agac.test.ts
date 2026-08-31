import { describe, expect, it } from "vitest";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../../llm/tipler";
import { LlmHatasi } from "../../llm/tipler";
import { agacKur } from "../agac";
import { duzles, olcumDugumleri } from "../tipler";
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
    expect(sonrakiTur("hedef")).toBe("surucu");
    expect(sonrakiTur("surucu")).toBe("olcum");
    expect(sonrakiTur("olcum")).toBe("aksiyon");
    expect(sonrakiTur("aksiyon")).toBeNull();
  });
});

describe("agacKur", () => {
  it("kok soruyu hedef dugumu yapar", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "Destek yukunu azalt", azamiCagri: 1 });
    expect(a.kok.tur).toBe("hedef");
    expect(a.kok.baslik).toBe("Destek yukunu azalt");
    expect(a.kok.seviye).toBe(0);
  });

  it("katmanlari sirayla kurar", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiCagri: 3 });
    expect(a.kok.cocuklar.map((c) => c.tur)).toEqual(["surucu", "surucu"]);
    expect(a.kok.cocuklar[0]?.cocuklar[0]?.tur).toBe("olcum");
  });

  it("azamiDerinlik asilmaz", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiDerinlik: 1, azamiCagri: 20 });
    expect(Math.max(...duzles(a.kok).map((d) => d.seviye))).toBe(1);
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
    const olcumler = olcumDugumleri(a.kok);
    expect(olcumler.length).toBeGreaterThan(0);
    expect(olcumler[0]?.olcumSorusu).toBeTruthy();
  });

  it("genislikte arama: ust katman once tamamlanir", async () => {
    // Butce 3: kok + iki surucu genisletilir, derine inilmez.
    const a = await agacKur({ saglayici: new SahteSaglayici([IKI_COCUK]), soru: "S", azamiCagri: 3, azamiDerinlik: 5 });
    expect(a.kok.cocuklar).toHaveLength(2);
    expect(a.kok.cocuklar[0]?.cocuklar).toHaveLength(2);
    expect(a.kok.cocuklar[1]?.cocuklar).toHaveLength(2);
  });
});

describe("dayaniklilik", () => {
  it("kod blogu icindeki JSON ayiklanir", async () => {
    const a = await agacKur({
      saglayici: new SahteSaglayici(["```json\n" + IKI_COCUK + "\n```"]),
      soru: "S", azamiCagri: 1,
    });
    expect(a.kok.cocuklar).toHaveLength(2);
  });

  it("JSON etrafindaki aciklama metni sorun cikarmaz", async () => {
    const a = await agacKur({
      saglayici: new SahteSaglayici(["Iste cocuklar: " + IKI_COCUK + " umarim yardimci olur"]),
      soru: "S", azamiCagri: 1,
    });
    expect(a.kok.cocuklar).toHaveLength(2);
  });

  it("kirpik cikti tekrar denenir", async () => {
    const s = new SahteSaglayici([{ metin: "[{\"baslik\":\"yar", bitis: "uzunluk" }, IKI_COCUK]);
    const a = await agacKur({ saglayici: s, soru: "S", azamiCagri: 3 });
    expect(a.kok.cocuklar).toHaveLength(2);
    // Ikinci denemede butce daha genis olmali.
    expect(s.istekler[1]?.azamiCiktiTokeni).toBeGreaterThan(s.istekler[0]!.azamiCiktiTokeni!);
  });

  it("bozuk JSON agaci comertmez, dugum genisletilmemis kalir", async () => {
    const a = await agacKur({ saglayici: new SahteSaglayici(["bu JSON degil"]), soru: "S", azamiCagri: 4 });
    expect(a.kok.cocuklar).toHaveLength(0);
    expect(a.genisletilmeyen).toBeGreaterThan(0);
  });

  it("kota hatasinda agac kurulmus kismiyla doner", async () => {
    const s = new SahteSaglayici([IKI_COCUK, new LlmHatasi("429", "kota")]);
    const a = await agacKur({ saglayici: s, soru: "S", azamiCagri: 10 });
    expect(a.kok.cocuklar).toHaveLength(2);
    expect(a.genisletilmeyen).toBeGreaterThan(0);
  });
});
