import { describe, expect, it } from "vitest";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../../llm/tipler";
import { LlmHatasi } from "../../llm/tipler";
import { planUret, skorHesapla } from "../plan";
import type { OlcumSonucu } from "../../ajan/olcum";
import type { Teshis } from "../teshis";

class Sahte implements Saglayici {
  readonly ad = "sahte"; readonly model = "s1";
  readonly istekler: KonusmaIstegi[] = [];
  constructor(private readonly yanit: string | Error) {}
  async konus(i: KonusmaIstegi): Promise<SaglayiciYaniti> {
    this.istekler.push(i);
    if (this.yanit instanceof Error) throw this.yanit;
    return { metin: this.yanit, aracCagrilari: [], bitisSebebi: "tamamlandi",
             model: this.model, kullanim: { girdiTokeni: 200, ciktiTokeni: 90 } };
  }
}

const sonuc: OlcumSonucu = {
  dugumId: "d1", ajanKod: "destek", ajanAd: "Destek Ajanı", renk: "#b45309",
  baslik: "Aşama dağılımı", soru: "s", cevap: "", sql: "",
  kolonlar: ["Asama", "Adet"], satirlar: [["Beklemede", 47], ["İşlemde", 12]],
  satirSayisi: 2, bosMu: false, sureMs: 10,
  kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
};

const teshis: Teshis = {
  dugumId: "d1", baslik: "Aşama dağılımı", toplam: 59, grupSayisi: 2,
  bulgular: [{ tur: "yigilma", metin: "Beklemede toplamin %80'i", etiket: "Beklemede", oran: 0.8 }],
};

const uret = (y: string | Error) => planUret(new Sahte(y), sonuc, teshis, "Destek yukunu azaltmak");

describe("skorHesapla", () => {
  it("etki x guven / caba", () => {
    expect(skorHesapla({ etki: 4, caba: 2, guven: 0.5 })).toBe(1);
    expect(skorHesapla({ etki: 5, caba: 1, guven: 1 })).toBe(5);
  });

  it("dusuk guven skoru dusurur", () => {
    const yuksek = skorHesapla({ etki: 5, caba: 2, guven: 0.9 });
    const dusuk = skorHesapla({ etki: 5, caba: 2, guven: 0.2 });
    expect(yuksek).toBeGreaterThan(dusuk);
  });
});

describe("planUret", () => {
  it("planlari SKORA GORE siralar", async () => {
    const r = await uret(JSON.stringify([
      { baslik: "Zayif", aciklama: "", etki: 2, caba: 4, guven: 0.3, islemKodu: "" },
      { baslik: "Guclu", aciklama: "", etki: 5, caba: 1, guven: 0.9, islemKodu: "" },
    ]));
    expect(r.planlar.map((p) => p.baslik)).toEqual(["Guclu", "Zayif"]);
    expect(r.planlar[0]!.skor).toBeGreaterThan(r.planlar[1]!.skor);
  });

  it("beyaz listedeki islem kodu yurutulebilir isaretlenir", async () => {
    const r = await uret(JSON.stringify([
      { baslik: "Ata", aciklama: "", etki: 3, caba: 1, guven: 0.8, islemKodu: "bilet_ata" },
    ]));
    expect(r.planlar[0]!.yurutulebilir).toBe(true);
    expect(r.planlar[0]!.islemKodu).toBe("bilet_ata");
  });

  it("UYDURULAN islem kodu temizlenir, plan yurutulemez olur", async () => {
    const r = await uret(JSON.stringify([
      { baslik: "X", aciklama: "", etki: 3, caba: 1, guven: 0.8, islemKodu: "tablo_sil" },
    ]));
    expect(r.planlar[0]!.islemKodu).toBe("");
    expect(r.planlar[0]!.yurutulebilir).toBe(false);
  });

  it("teshis isteme konur", async () => {
    const s = new Sahte(JSON.stringify([{ baslik: "A", aciklama: "", etki: 1, caba: 1, guven: 1, islemKodu: "" }]));
    await planUret(s, sonuc, teshis, "hedef");
    const kullaniciMesaji = s.istekler[0]!.mesajlar.find((m) => m.rol === "kullanici");
    expect(kullaniciMesaji && "metin" in kullaniciMesaji && kullaniciMesaji.metin).toContain("Beklemede toplamin");
  });

  it("gecersiz aralik reddedilir, bos liste doner", async () => {
    const r = await uret(JSON.stringify([{ baslik: "A", aciklama: "", etki: 9, caba: 1, guven: 1, islemKodu: "" }]));
    expect(r.planlar).toHaveLength(0);
  });

  it("BOZUK cikti zinciri durdurmaz", async () => {
    const r = await uret("bu JSON degil");
    expect(r.planlar).toHaveLength(0);
  });

  it("KOTA hatasi yukari firlatilir", async () => {
    await expect(uret(new LlmHatasi("429", "kota"))).rejects.toThrow(LlmHatasi);
  });
});
