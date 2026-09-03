import { describe, expect, it, vi } from "vitest";
import type { Tablo } from "../../db/sema";
import type { KolonDegerleri } from "../../db/degerler";
import type { AksiyonOnerisi } from "../../yaz/aksiyon";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../../llm/tipler";
import { LlmHatasi } from "../../llm/tipler";
import { buildPlans, planSkoru } from "../plan";
import { aksiyonUret } from "../../yaz/aksiyon";
import type { OlcumSonucu } from "../../ajan/olcum";
import type { Diagnosis } from "../teshis";

class Sahte implements Saglayici {
  readonly ad = "sahte"; readonly model = "s1";
  readonly istekler: KonusmaIstegi[] = [];
  #n = 0;
  constructor(private readonly yanitlar: (string | Error)[]) {}
  async konus(i: KonusmaIstegi): Promise<SaglayiciYaniti> {
    this.istekler.push(i);
    const y = this.yanitlar[Math.min(this.#n++, this.yanitlar.length - 1)]!;
    if (y instanceof Error) throw y;
    return { metin: y, aracCagrilari: [], bitisSebebi: "tamamlandi",
             model: this.model, kullanim: { girdiTokeni: 200, ciktiTokeni: 90 } };
  }
}

const sonuc: OlcumSonucu = {
  dugumId: "d1", ajanKod: "experience", ajanAd: "Deneyim Ajanı", renk: "#b45309",
  baslik: "Aşama dağılımı", soru: "s", cevap: "", sql: "",
  kolonlar: ["Asama", "Adet"], satirlar: [["Beklemede", 47], ["İşlemde", 12]],
  satirSayisi: 2, bosMu: false, belirsiz: false, sureMs: 10,
  kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
};

const teshis: Diagnosis = {
  dugumId: "d1", baslik: "Aşama dağılımı", toplam: 59, groupCount: 2,
  findings: [{ tur: "yigilma", metin: "Beklemede toplamin %80'i", etiket: "Beklemede", oran: 0.8 }],
};

const plan = (ek: Record<string, unknown> = {}) => JSON.stringify({
  planlar: [{
    title: "Beklemedeki biletlere sahip ata", rationale: "cunku",
    impact: 4, effort: 2, confidence: 0.8, timeframe: "2 hafta",
    kpi: "beklemedeki bilet sayisi", actions: [], ...ek,
  }],
});

const uret = (
  y: string | Error,
  dogrulama?: { tablolar: Tablo[]; degerler: KolonDegerleri[] }
) =>
  buildPlans(new Sahte([y]), sonuc, teshis, "Destek yukunu azaltmak", dogrulama);

describe("kanonik Plan alanlari", () => {
  it("spec alanlari doldurulur", async () => {
    const r = await uret(plan());
    const p = r.planlar[0]!;
    expect(p.title).toBe("Beklemedeki biletlere sahip ata");
    expect(p.agent).toBe("experience");
    expect(p.impact).toBe(4);
    expect(p.effort).toBe(2);
    expect(p.confidence).toBe(0.8);
    expect(p.timeframe).toBe("2 hafta");
    expect(p.kpi).toBe("beklemedeki bilet sayisi");
    expect(p.id).toBeTruthy();
  });

  it("goalNodeIds olcum dugumune baglanir", async () => {
    const r = await uret(plan());
    expect(r.planlar[0]!.goalNodeIds).toEqual(["d1"]);
  });

  it("skor KODDAN gelir: impact x confidence / effort", async () => {
    const r = await uret(plan());
    expect(r.planlar[0]!.skor).toBe(planSkoru({ impact: 4, effort: 2, confidence: 0.8 }));
    expect(r.planlar[0]!.skor).toBe(1.6);
  });

  it("planlar skora gore siralanir", async () => {
    const r = await buildPlans(new Sahte([JSON.stringify({ planlar: [
      { title: "Zayif", rationale: "", impact: 2, effort: 4, confidence: 0.3, timeframe: "", kpi: "", actions: [] },
      { title: "Guclu", rationale: "", impact: 5, effort: 1, confidence: 0.9, timeframe: "", kpi: "", actions: [] },
    ] })]), sonuc, teshis, "hedef");
    expect(r.planlar.map((p) => p.title)).toEqual(["Guclu", "Zayif"]);
  });
});

describe("Action KODDAN turetilir", () => {
  // Bu testler aksiyonUret'i DOGRUDAN cagiriyor: planUret somut kayitlari
  // veritabanindan cekiyor ve test ortaminda baglanti yok. Dogrulanan sey
  // zaten Action'in ISLEM TANIMINDAN turetilmesi.
  const izinli = { biletNo: ["HT1"], kisi: ["Ad Soyad"] };

  it("risk islem tanimindan gelir, modelden degil", () => {
    const a = aksiyonUret(
      { tool: "bilet_ata", params: { biletNo: "HT1", kisi: "Ad Soyad" },
        title: "Ata", expectedOutcome: "atanir" },
      izinli
    );
    expect(a.risk).toBe("low");          // bilet_ata tanimindaki sabit
    expect(a.tool).toBe("bilet_ata");
  });

  it("reversible ve dryRunSupported koddan turetilir", () => {
    const a = aksiyonUret(
      { tool: "bilet_ata", params: { biletNo: "HT1", kisi: "Ad Soyad" } },
      izinli
    );
    expect(a.reversible).toBe(true);      // geriAl() var
    expect(a.dryRunSupported).toBe(true); // prova() var
    expect(a.rollback?.tool).toBe("bilet_ata");
  });

  it("model risk/requiresApproval yazsa bile KODUN degeri gecerli", () => {
    const a = aksiyonUret(
      { tool: "bilet_asama_degistir", params: { biletNo: "HT1", asama: "Beklemede" },
        risk: "low", requiresApproval: false, reversible: true } as AksiyonOnerisi,
      { biletNo: ["HT1"] }
    );
    // bilet_asama_degistir tanimda "medium"; modelin "low" demesi gecersiz.
    expect(a.risk).toBe("medium");
    expect(a.requiresApproval).toBe(true);
  });

  it("SOMUT KAYIT YOKSA aksiyon uretilmez", () => {
    // Kabul kosusunda model "EXAMPLE_TEklif_001" / "AliYilmaz" uydurdu ve
    // izinli liste olmadigi icin dogrulama tamamen atlaniyordu.
    expect(() => aksiyonUret(
      { tool: "teklif_temsilci_ata",
        params: { teklifNo: "EXAMPLE_TEklif_001", temsilci: "AliYilmaz" } }
    )).toThrow(/gercek bir kayda baglanamadi/);
  });

  it("UYDURULAN kimlik izinli listede yoksa reddedilir", () => {
    expect(() => aksiyonUret(
      { tool: "teklif_temsilci_ata",
        params: { teklifNo: "UYDURMA", temsilci: "Sitran Çelik" } },
      { teklifNo: ["2026_00585_R1"], temsilci: ["Sitran Çelik"] }
    )).toThrow(/gecerli degil/);
  });

  it("UYDURULAN islem dusurulur, plan kalir", async () => {
    const r = await uret(plan({ actions: [{ tool: "tablo_sil", params: {} }] }));
    expect(r.planlar[0]!.actions).toHaveLength(0);
    expect(r.planlar[0]!.uyari).toContain("Beyaz listede yok");
  });

  it("GECERSIZ parametre dusurulur", async () => {
    const r = await uret(plan({ actions: [{ tool: "bilet_ata", params: { biletNo: "" } }] }));
    expect(r.planlar[0]!.actions).toHaveLength(0);
    expect(r.planlar[0]!.uyari).toContain("Gecersiz parametre");
  });
});

describe("dayaniklilik", () => {
  it("aralik disi impact reddedilir, bos liste doner", async () => {
    const r = await uret(plan({ impact: 9 }));
    expect(r.planlar).toHaveLength(0);
  });

  it("BOZUK cikti zinciri durdurmaz", async () => {
    expect((await uret("bu JSON degil")).planlar).toHaveLength(0);
  });

  it("KOTA hatasi yukari firlatilir", async () => {
    await expect(uret(new LlmHatasi("429", "kota"))).rejects.toThrow(LlmHatasi);
  });
});

describe("izinli kimlikler olcum sonucundan da gelir", () => {
  const izinli = {
    teklifNo: ["2026_00585_R1", "2026_00685"],
    temsilci: ["Sitran Çelik"],
  };

  it("olcum ciktisinda gorulen kimlik kabul edilir", () => {
    // Model istemde gordugu numarayi kullaniyor; dogrulama yalnizca ayri
    // sorgudan gelen listeye bakarken gercek numara reddediliyordu.
    const a = aksiyonUret(
      { tool: "teklif_temsilci_ata",
        params: { teklifNo: "2026_00685", temsilci: "Sitran Çelik" } },
      izinli
    );
    expect(a.params.teklifNo).toBe("2026_00685");
  });

  it("iki kaynakta da olmayan kimlik yine reddedilir", () => {
    expect(() => aksiyonUret(
      { tool: "teklif_temsilci_ata",
        params: { teklifNo: "UYDURMA_001", temsilci: "Sitran Çelik" } },
      izinli
    )).toThrow(/gecerli degil/);
  });
});
