import { beforeEach, describe, expect, it } from "vitest";
import { reddet, listele, baglamMetni, _testIcinSifirla } from "../red";

beforeEach(() => { _testIcinSifirla(); });

describe("plan reddi", () => {
  it("sebebi kaydeder ve ajana gore listeler", () => {
    reddet("retention", "Kampanya kur", "Butcemiz yok", "mustafa");
    reddet("acquisition", "Reklam ac", "Ilgisiz", "mustafa");

    expect(listele("retention")).toHaveLength(1);
    expect(listele("retention")[0]?.sebep).toBe("Butcemiz yok");
    expect(listele()).toHaveLength(2);
  });

  it("gecmisi olmayan ajana bos baglam verir", () => {
    // Bos baslik gostermek istemi bosuna sisirirdi.
    expect(baglamMetni("retention")).toBe("");
  });

  it("baglam metni plan basligini ve sebebi tasir", () => {
    reddet("retention", "Kampanya kur", "Butcemiz yok", "mustafa");
    const metin = baglamMetni("retention");

    expect(metin).toContain("Kampanya kur");
    expect(metin).toContain("Butcemiz yok");
    expect(metin).toContain("tekrarlama");
  });

  it("baglami en yeniden eskiye ve sinirli sayida verir", () => {
    for (let i = 0; i < 8; i++) reddet("retention", `Plan ${i}`, `Sebep ${i}`, "m");

    const satirlar = baglamMetni("retention", 3).split("\n").slice(1);
    expect(satirlar).toHaveLength(3);
    expect(satirlar[0]).toContain("Plan 7");
  });

  it("yalnizca ilgili ajanin reddini verir", () => {
    reddet("acquisition", "Reklam ac", "Ilgisiz", "m");
    expect(baglamMetni("retention")).toBe("");
  });
});
