import { describe, expect, it } from "vitest";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../../llm/tipler";
import { LlmHatasi } from "../../llm/tipler";
import { extractIntent } from "../intent";

class Sahte implements Saglayici {
  readonly ad = "sahte"; readonly model = "s1";
  readonly istekler: KonusmaIstegi[] = [];
  constructor(private readonly yanit: string | Error) {}
  async konus(i: KonusmaIstegi): Promise<SaglayiciYaniti> {
    this.istekler.push(i);
    if (this.yanit instanceof Error) throw this.yanit;
    return {
      metin: this.yanit, aracCagrilari: [], bitisSebebi: "tamamlandi",
      model: this.model, kullanim: { girdiTokeni: 80, ciktiTokeni: 30 },
    };
  }
}

const TAM = JSON.stringify({
  metrik: "acik bilet sayisi", zamanAraligi: "son 30 gun", segment: "asamaya gore",
  ortukHedef: "Destek yukunu azaltmak", tur: "veri_sorusu",
});

describe("niyetCikar", () => {
  it("dort alani da ayristirir", async () => {
    const r = await extractIntent(new Sahte(TAM), "soru");
    expect(r.niyet.metrik).toBe("acik bilet sayisi");
    expect(r.niyet.zamanAraligi).toBe("son 30 gun");
    expect(r.niyet.segment).toBe("asamaya gore");
    expect(r.niyet.ortukHedef).toBe("Destek yukunu azaltmak");
    expect(r.fellBack).toBe(false);
  });

  it("ornekler isteme konur", async () => {
    const s = new Sahte(TAM);
    await extractIntent(s, "soru");
    const m = s.istekler[0]!.mesajlar;
    expect(m.filter((x) => x.rol === "asistan").length).toBeGreaterThanOrEqual(3);
  });

  it("kod blogu icindeki JSON ayiklanir", async () => {
    const r = await extractIntent(new Sahte("```json\n" + TAM + "\n```"), "soru");
    expect(r.niyet.ortukHedef).toBe("Destek yukunu azaltmak");
  });

  it("eksik alanlar varsayilana duser", async () => {
    const r = await extractIntent(new Sahte(JSON.stringify({ ortukHedef: "X" })), "soru");
    expect(r.niyet.metrik).toBe("");
    expect(r.niyet.tur).toBe("veri_sorusu");
  });

  it("BOZUK cikti zinciri durdurmaz, ham soru kok olur", async () => {
    const r = await extractIntent(new Sahte("bu JSON degil"), "Asamalarina gore biletler");
    expect(r.fellBack).toBe(true);
    expect(r.niyet.ortukHedef).toBe("Asamalarina gore biletler");
  });

  it("ortukHedef bos gelirse geri dusulur", async () => {
    const r = await extractIntent(new Sahte(JSON.stringify({ ortukHedef: "" })), "ham soru");
    expect(r.fellBack).toBe(true);
    expect(r.niyet.ortukHedef).toBe("ham soru");
  });

  it("KOTA hatasi yutulmaz, yukari firlatilir", async () => {
    await expect(extractIntent(new Sahte(new LlmHatasi("429", "kota")), "s"))
      .rejects.toThrow(LlmHatasi);
  });
});
