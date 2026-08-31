import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AracKaydi } from "../kayit.js";
import type { AracTanimi, Baglam } from "../tipler.js";

const baglam = (provaMi = false): Baglam => ({ izId: "test", provaMi });

function sahteArac(
  ad: string,
  yanEtki: "okuma" | "yazma" = "okuma"
): AracTanimi<{ x: number }, number> {
  return {
    ad,
    aciklama: `${ad} araci`,
    kaynak: "yerel",
    yanEtki,
    girdiSemasi: z.object({ x: z.number().int() }),
    async calistir(girdi) { return girdi.x * 2; },
  };
}

describe("kayit", () => {
  it("arac kaydeder ve listeler", () => {
    const k = new AracKaydi();
    k.kaydet(sahteArac("b"));
    k.kaydet(sahteArac("a"));
    expect(k.liste().map((a) => a.ad)).toEqual(["a", "b"]);
  });

  it("ayni ada iki kez izin vermez", () => {
    const k = new AracKaydi();
    k.kaydet(sahteArac("a"));
    expect(() => k.kaydet(sahteArac("a"))).toThrow(/iki arac/);
  });

  it("okuma araclarini ayirir", () => {
    const k = new AracKaydi();
    k.kaydet(sahteArac("oku"));
    k.kaydet(sahteArac("yaz", "yazma"));
    expect(k.okumaAraclari().map((a) => a.ad)).toEqual(["oku"]);
  });
});

describe("calistir", () => {
  it("gecerli girdiyle calisir", async () => {
    const k = new AracKaydi();
    k.kaydet(sahteArac("a"));
    const s = await k.calistir("a", { x: 21 }, baglam());
    expect(s.ok && s.deger).toBe(42);
  });

  it("bilinmeyen araci reddeder", async () => {
    const s = await new AracKaydi().calistir("yok", {}, baglam());
    expect(s.ok).toBe(false);
    expect(!s.ok && s.kod).toBe("bilinmeyen_arac");
  });

  it("gecersiz girdiyi ARAC CALISMADAN reddeder", async () => {
    let calisti = false;
    const k = new AracKaydi();
    k.kaydet({ ...sahteArac("a"), async calistir() { calisti = true; return 0; } });
    const s = await k.calistir("a", { x: "metin" }, baglam());
    expect(!s.ok && s.kod).toBe("gecersiz_girdi");
    expect(calisti).toBe(false);
  });

  it("arac hatasini yakalar, firlatmaz", async () => {
    const k = new AracKaydi();
    k.kaydet({ ...sahteArac("a"), async calistir(): Promise<number> { throw new Error("patladi"); } });
    const s = await k.calistir("a", { x: 1 }, baglam());
    expect(!s.ok && s.kod).toBe("calistirma_hatasi");
    expect(!s.ok && s.hata).toBe("patladi");
  });
});

describe("yazma araclari onay kapisi", () => {
  // F5 gelene kadar KAPALI kalmali; yarim kalmis yol sessizce acilmasin.
  it("yazma araci onaysiz calismaz", async () => {
    let calisti = false;
    const k = new AracKaydi();
    k.kaydet({ ...sahteArac("yaz", "yazma"), async calistir() { calisti = true; return 0; } });
    const s = await k.calistir("yaz", { x: 1 }, baglam(false));
    expect(!s.ok && s.kod).toBe("onay_gerekli");
    expect(calisti).toBe(false);
  });

  it("provada yazma araci calisabilir", async () => {
    const k = new AracKaydi();
    k.kaydet(sahteArac("yaz", "yazma"));
    const s = await k.calistir("yaz", { x: 5 }, baglam(true));
    expect(s.ok).toBe(true);
  });
});

describe("anthropic semasi", () => {
  it("JSON Schema uretir", () => {
    const k = new AracKaydi();
    k.kaydet(sahteArac("a"));
    const [sema] = k.anthropicSemalari();
    expect(sema?.name).toBe("a");
    expect(sema?.input_schema).toMatchObject({ type: "object" });
    expect(Object.keys((sema?.input_schema as any).properties)).toEqual(["x"]);
  });
});
