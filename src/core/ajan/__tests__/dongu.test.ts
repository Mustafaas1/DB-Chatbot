import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AracKaydi } from "../../tools/kayit.js";
import type { AracTanimi, Baglam } from "../../tools/tipler.js";
import type { KonusmaIstegi, Saglayici, SaglayiciYaniti } from "../../llm/tipler.js";
import { LlmHatasi } from "../../llm/tipler.js";
import { donguCalistir } from "../dongu.js";

const baglam: Baglam = { izId: "t", provaMi: false };

/** Onceden yazilmis yanitlari sirayla donduren sahte saglayici. */
class SahteSaglayici implements Saglayici {
  readonly ad = "sahte";
  readonly model = "sahte-1";
  readonly gorulenIstekler: KonusmaIstegi[] = [];
  #sira = 0;
  constructor(private readonly yanitlar: (Partial<SaglayiciYaniti> | Error)[]) {}

  async konus(istek: KonusmaIstegi): Promise<SaglayiciYaniti> {
    this.gorulenIstekler.push(istek);
    const y = this.yanitlar[this.#sira++];
    if (y instanceof Error) throw y;
    return {
      metin: "", aracCagrilari: [], bitisSebebi: "tamamlandi",
      model: this.model, kullanim: { girdiTokeni: 10, ciktiTokeni: 5 }, ...y,
    };
  }
}

function sayacAraci(sonuc: unknown = { adet: 59 }): AracTanimi<{ sorgu: string }, unknown> {
  return {
    ad: "veri_sorgula", aciklama: "test", kaynak: "yerel", yanEtki: "okuma",
    girdiSemasi: z.object({ sorgu: z.string() }),
    async calistir() { return sonuc; },
  };
}

function kayitla(arac: AracTanimi<any, any>): AracKaydi {
  const k = new AracKaydi(); k.kaydet(arac); return k;
}

const temel = { baglam, sistemIstemi: "sistem", soru: "kac bilet var?" };

describe("dongu", () => {
  it("arac cagrisi olmadan dogrudan cevap doner", async () => {
    const s = new SahteSaglayici([{ metin: "59 bilet var." }]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(sayacAraci()) });
    expect(r.cevap).toBe("59 bilet var.");
    expect(r.adimlar).toHaveLength(0);
    expect(r.tamamlandi).toBe(true);
  });

  it("araci calistirip sonucu modele geri verir", async () => {
    const s = new SahteSaglayici([
      { aracCagrilari: [{ id: "1", ad: "veri_sorgula", girdi: { sorgu: "SELECT 1" } }], bitisSebebi: "arac_cagrisi" },
      { metin: "59 bilet var." },
    ]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(sayacAraci()) });

    expect(r.adimlar).toHaveLength(1);
    expect(r.adimlar[0]?.ok).toBe(true);
    expect(r.cevap).toBe("59 bilet var.");
    // Ikinci cagrida arac sonucu mesajlarda olmali.
    const ikinci = s.gorulenIstekler[1]!.mesajlar;
    expect(ikinci.some((m) => m.rol === "arac" && m.icerik.includes("59"))).toBe(true);
  });

  it("token kullanimini toplar", async () => {
    const s = new SahteSaglayici([
      { aracCagrilari: [{ id: "1", ad: "veri_sorgula", girdi: { sorgu: "SELECT 1" } }], bitisSebebi: "arac_cagrisi" },
      { metin: "bitti" },
    ]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(sayacAraci()) });
    expect(r.kullanim).toEqual({ girdiTokeni: 20, ciktiTokeni: 10 });
  });

  it("arac hatasi modele geri verilir, dongu devam eder", async () => {
    const patlak: AracTanimi<{ sorgu: string }, unknown> = {
      ...sayacAraci(), async calistir(): Promise<unknown> { throw new Error("sozdizimi hatasi"); },
    };
    const s = new SahteSaglayici([
      { aracCagrilari: [{ id: "1", ad: "veri_sorgula", girdi: { sorgu: "BOZUK" } }], bitisSebebi: "arac_cagrisi" },
      { metin: "duzelttim" },
    ]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(patlak) });
    expect(r.adimlar[0]?.ok).toBe(false);
    expect(s.gorulenIstekler[1]!.mesajlar.some((m) => m.rol === "arac" && m.icerik.includes("sozdizimi"))).toBe(true);
    expect(r.cevap).toBe("duzelttim");
  });

  it("tur siniri asilinca SESSIZCE kesilmez", async () => {
    const cagri = { aracCagrilari: [{ id: "1", ad: "veri_sorgula", girdi: { sorgu: "SELECT 1" } }], bitisSebebi: "arac_cagrisi" as const };
    const s = new SahteSaglayici([cagri, cagri, cagri, cagri]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(sayacAraci()), azamiTur: 2 });
    expect(r.tamamlandi).toBe(false);
    expect(r.durmaSebebi).toBe("tur_siniri");
    expect(r.adimlar).toHaveLength(2);
  });

  it("kota hatasi anlasilir mesaja cevrilir", async () => {
    const s = new SahteSaglayici([new LlmHatasi("429", "kota")]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(sayacAraci()) });
    expect(r.tamamlandi).toBe(false);
    expect(r.durmaSebebi).toBe("hata");
    expect(r.cevap).toMatch(/kota/i);
  });

  it("cikti uzunluk sinirina takilirsa tamamlanmis sayilmaz", async () => {
    const s = new SahteSaglayici([{ metin: "yarim", bitisSebebi: "uzunluk" }]);
    const r = await donguCalistir({ ...temel, saglayici: s, kayit: kayitla(sayacAraci()) });
    expect(r.tamamlandi).toBe(false);
    expect(r.durmaSebebi).toBe("uzunluk");
  });
});
