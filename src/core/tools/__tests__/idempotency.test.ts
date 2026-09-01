import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AracKaydi } from "../kayit";
import type { AracTanimi, Baglam } from "../tipler";
import * as idem from "../idempotency";

beforeEach(() => idem._testIcinSifirla());

let cagriSayisi = 0;
let patlasin = false;

function yazmaAraci(ek: Partial<AracTanimi<{ x: number }, unknown>> = {}): AracTanimi<{ x: number }, unknown> {
  return {
    ad: "yaz", aciklama: "t", kaynak: "yerel", yanEtki: "yazma", risk: "medium",
    girdiSemasi: z.object({ x: z.number() }),
    async calistir(g) {
      cagriSayisi++;
      if (patlasin) throw new Error("gecici hata");
      return { sonuc: g.x * 2 };
    },
    async prova(g) { return { prova: true, x: g.x }; },
    ...ek,
  };
}

function kayitla(a: AracTanimi<any, any>): AracKaydi {
  const k = new AracKaydi(); k.kaydet(a); return k;
}

const baglam = (anahtar?: string, provaMi = false): Baglam => ({
  izId: "t", provaMi, onaylayan: "Mustafa",
  ...(anahtar ? { idempotencyAnahtari: anahtar } : {}),
});

beforeEach(() => { cagriSayisi = 0; patlasin = false; });

describe("ONAY ZORUNLU", () => {
  it("yan etkili arac ONAYLAYAN olmadan calistirilmaz", async () => {
    const s = await kayitla(yazmaAraci()).calistir(
      "yaz", { x: 1 }, { izId: "t", provaMi: false, idempotencyAnahtari: "a1" }
    );
    expect(s.ok).toBe(false);
    expect(!s.ok && s.kod).toBe("onay_gerekli");
    expect(cagriSayisi).toBe(0);
  });
});

describe("IDEMPOTENCY ZORUNLU", () => {
  it("yan etkili arac anahtarsiz CALISTIRILMAZ", async () => {
    const s = await kayitla(yazmaAraci()).calistir("yaz", { x: 1 }, baglam());
    expect(s.ok).toBe(false);
    expect(!s.ok && s.kod).toBe("idempotency_gerekli");
    expect(cagriSayisi).toBe(0);
  });

  it("okuma araci anahtar istemez", async () => {
    const oku = { ...yazmaAraci(), yanEtki: "okuma" as const };
    const s = await kayitla(oku).calistir("yaz", { x: 1 }, baglam());
    expect(s.ok).toBe(true);
    expect(cagriSayisi).toBe(1);
  });

  it("prova anahtar istemez ve YAN ETKI URETMEZ", async () => {
    const s = await kayitla(yazmaAraci()).calistir("yaz", { x: 5 }, baglam(undefined, true));
    expect(s.ok).toBe(true);
    expect(s.ok && s.deger).toEqual({ prova: true, x: 5 });
    expect(cagriSayisi).toBe(0);
  });
});

describe("AYNI AKSIYON IKI KEZ CALISMAZ", () => {
  it("ayni anahtarla ikinci cagri araci TEKRAR CALISTIRMAZ", async () => {
    const k = kayitla(yazmaAraci());
    const bir = await k.calistir("yaz", { x: 3 }, baglam("a1"));
    const iki = await k.calistir("yaz", { x: 3 }, baglam("a1"));

    expect(cagriSayisi).toBe(1);
    expect(bir.ok && bir.deger).toEqual({ sonuc: 6 });
    expect(iki.ok && iki.deger).toEqual({ sonuc: 6 });
    expect(iki.ok && iki.tekrarMi).toBe(true);
  });

  it("FARKLI anahtar yeni cagri demektir", async () => {
    const k = kayitla(yazmaAraci());
    await k.calistir("yaz", { x: 1 }, baglam("a1"));
    await k.calistir("yaz", { x: 1 }, baglam("a2"));
    expect(cagriSayisi).toBe(2);
  });

  it("ayni anahtar FARKLI girdiyle reddedilir", async () => {
    const k = kayitla(yazmaAraci());
    await k.calistir("yaz", { x: 1 }, baglam("a1"));
    const s = await k.calistir("yaz", { x: 999 }, baglam("a1"));

    expect(s.ok).toBe(false);
    expect(!s.ok && s.hata).toMatch(/farkli bir girdiyle/i);
    expect(cagriSayisi).toBe(1);
  });

  it("BASARISIZ cagri tekrar denenebilir", async () => {
    const k = kayitla(yazmaAraci());
    patlasin = true;
    const bir = await k.calistir("yaz", { x: 1 }, baglam("a1"));
    expect(bir.ok).toBe(false);

    // Basarisizligi kalici kaydetmek, gecici bir hatadan sonra aksiyonun
    // bir daha hic denenememesine yol acardi.
    patlasin = false;
    const iki = await k.calistir("yaz", { x: 1 }, baglam("a1"));
    expect(iki.ok).toBe(true);
    expect(cagriSayisi).toBe(2);
  });
});

describe("HIZ SINIRI", () => {
  it("pencere icinde sinir asilinca reddedilir", async () => {
    const k = kayitla({ ...yazmaAraci(), yanEtki: "okuma",
      hizSiniri: { pencereMs: 60_000, azamiCagri: 2 } });

    expect((await k.calistir("yaz", { x: 1 }, baglam())).ok).toBe(true);
    expect((await k.calistir("yaz", { x: 1 }, baglam())).ok).toBe(true);
    const ucuncu = await k.calistir("yaz", { x: 1 }, baglam());

    expect(ucuncu.ok).toBe(false);
    expect(!ucuncu.ok && ucuncu.kod).toBe("hiz_siniri");
    expect(cagriSayisi).toBe(2);
  });

  it("sinir yoksa kisitlanmaz", async () => {
    const k = kayitla({ ...yazmaAraci(), yanEtki: "okuma" });
    for (let i = 0; i < 5; i++) await k.calistir("yaz", { x: 1 }, baglam());
    expect(cagriSayisi).toBe(5);
  });
});

describe("depo davranisi", () => {
  it("tamamlanan cagri sonucu saklanir", () => {
    expect(idem.baslat("k1", "yaz", { x: 1 })).toBeNull();
    idem.tamamla("k1", { sonuc: 42 });
    expect(idem.baslat("k1", "yaz", { x: 1 })).toEqual({ durum: "tamamlandi", sonuc: { sonuc: 42 } });
  });

  it("basarisiz cagri kayittan dusurulur", () => {
    idem.baslat("k1", "yaz", { x: 1 });
    idem.basarisiz("k1");
    expect(idem.baslat("k1", "yaz", { x: 1 })).toBeNull();
  });
});
