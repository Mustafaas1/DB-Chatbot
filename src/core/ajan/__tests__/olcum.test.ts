import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AracKaydi } from "../../tools/kayit";
import type { Saglayici, SaglayiciYaniti } from "../../llm/tipler";
import { olcumleriCalistir } from "../olcum";
import type { Atama } from "../dagitici";
import { PLANLAMA_AJANLARI } from "../../../agents/index";
import type { GoalNodeGenis } from "../../hedef/tipler";
import type { OlcumOlayi } from "../olcum";

vi.mock("../istem", () => ({ sistemIstemi: async () => "sistem" }));

/** Es zamanli calisan is sayisini olcer. */
class SayanSaglayici implements Saglayici {
  readonly ad = "sahte"; readonly model = "sahte-1";
  aktif = 0; enYuksekAktif = 0;
  constructor(private readonly gecikmeMs = 20) {}

  async konus(): Promise<SaglayiciYaniti> {
    this.aktif++;
    this.enYuksekAktif = Math.max(this.enYuksekAktif, this.aktif);
    await new Promise((r) => setTimeout(r, this.gecikmeMs));
    this.aktif--;
    return {
      metin: "cevap", aracCagrilari: [], bitisSebebi: "tamamlandi",
      model: this.model, kullanim: { girdiTokeni: 100, ciktiTokeni: 20 },
    };
  }
}

function kayit(): AracKaydi {
  const k = new AracKaydi();
  k.kaydet({
    ad: "veri_sorgula", aciklama: "t", kaynak: "yerel", yanEtki: "okuma",
    girdiSemasi: z.object({ sorgu: z.string() }),
    async calistir() { return { kolonlar: ["a"], satirlar: [[1]] }; },
  });
  return k;
}

function atamalar(adet: number): Atama[] {
  return Array.from({ length: adet }, (_, i) => {
    const d: GoalNodeGenis = {
      id: `d${i}`, parentId: "kok", statement: `olcum ${i}`, type: "metric",
      rationale: "", measurementQuery: `soru ${i}`,
      evidence: [], children: [], status: "pending",
    };
    return { dugum: d, ajan: PLANLAMA_AJANLARI[i % PLANLAMA_AJANLARI.length]!, puan: 10, belirsiz: false };
  });
}

async function topla(g: AsyncGenerator<OlcumOlayi>): Promise<OlcumOlayi[]> {
  const c: OlcumOlayi[] = [];
  for await (const o of g) c.push(o);
  return c;
}

describe("olcumleriCalistir", () => {
  it("her olcum icin basladi ve bitti yayinlar", async () => {
    const olaylar = await topla(olcumleriCalistir({
      saglayici: new SayanSaglayici(), kayit: kayit(),
      atamalar: atamalar(2), esZamanli: 1,
    }));
    expect(olaylar.filter((o) => o.tur === "basladi")).toHaveLength(2);
    expect(olaylar.filter((o) => o.tur === "bitti")).toHaveLength(2);
  });

  it("ES ZAMANLILIK SINIRI asilmaz", async () => {
    const s = new SayanSaglayici(30);
    await topla(olcumleriCalistir({
      saglayici: s, kayit: kayit(), atamalar: atamalar(6), esZamanli: 2, azamiOlcum: 6,
    }));
    // Kota sinirini koruyan asil garanti bu.
    expect(s.enYuksekAktif).toBeLessThanOrEqual(2);
    expect(s.enYuksekAktif).toBeGreaterThan(1);
  });

  it("azamiOlcum ustundekiler atlanir, sessizce dusurulmez", async () => {
    const olaylar = await topla(olcumleriCalistir({
      saglayici: new SayanSaglayici(), kayit: kayit(),
      atamalar: atamalar(5), azamiOlcum: 2, esZamanli: 2,
    }));
    expect(olaylar.filter((o) => o.tur === "bitti")).toHaveLength(2);
    expect(olaylar.filter((o) => o.tur === "atlandi")).toHaveLength(3);
  });

  it("bir olcumun hatasi digerlerini durdurmaz", async () => {
    let n = 0;
    const patlak: Saglayici = {
      ad: "p", model: "p",
      async konus(): Promise<SaglayiciYaniti> {
        if (n++ === 0) throw new Error("patladi");
        return { metin: "ok", aracCagrilari: [], bitisSebebi: "tamamlandi",
                 model: "p", kullanim: { girdiTokeni: 1, ciktiTokeni: 1 } };
      },
    };
    const olaylar = await topla(olcumleriCalistir({
      saglayici: patlak, kayit: kayit(), atamalar: atamalar(3), esZamanli: 1,
    }));
    expect(olaylar.filter((o) => o.tur === "hata")).toHaveLength(1);
    expect(olaylar.filter((o) => o.tur === "bitti")).toHaveLength(2);
  });

  it("bos sonuc isaretlenir", async () => {
    const k = new AracKaydi();
    k.kaydet({
      ad: "veri_sorgula", aciklama: "t", kaynak: "yerel", yanEtki: "okuma",
      girdiSemasi: z.object({ sorgu: z.string() }),
      async calistir() { return { kolonlar: ["a"], satirlar: [] }; },
    });
    const olaylar = await topla(olcumleriCalistir({
      saglayici: new SayanSaglayici(), kayit: k, atamalar: atamalar(1),
    }));
    const bitti = olaylar.find((o) => o.tur === "bitti");
    expect(bitti?.tur === "bitti" && bitti.sonuc.bosMu).toBe(true);
  });
});
