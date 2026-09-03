import { describe, expect, it } from "vitest";
import { Budget } from "../butce";

describe("soru basina butce", () => {
  it("limit altinda asilmis saymaz", () => {
    const b = new Budget(1000, 10);
    b.spend({ girdiTokeni: 300, ciktiTokeni: 200, cagriSayisi: 2 });
    const d = b.state();
    expect(d.tokens).toBe(500);
    expect(d.turns).toBe(2);
    expect(d.exceeded).toBe(false);
    expect(d.reason).toBeNull();
  });

  it("token limiti dolunca durur ve sebebini soyler", () => {
    const b = new Budget(1000, 100);
    b.spend({ girdiTokeni: 800, ciktiTokeni: 300 });
    expect(b.isExceeded()).toBe(true);
    expect(b.state().reason).toContain("Token butcesi");
  });

  it("tur limiti dolunca durur", () => {
    const b = new Budget(1_000_000, 3);
    for (let i = 0; i < 3; i++) b.spend({ cagriSayisi: 1 });
    expect(b.isExceeded()).toBe(true);
    expect(b.state().reason).toContain("Ajan turu");
  });

  it("cagriSayisi verilmezse tek tur sayar", () => {
    // Asamalar cagriSayisi dondurmuyor; tur yine de ilerlemeli, yoksa
    // token limiti gelene kadar tur butcesi hic islemezdi.
    const b = new Budget(1_000_000, 2);
    b.spend({ girdiTokeni: 10 });
    b.spend({ girdiTokeni: 10 });
    expect(b.isExceeded()).toBe(true);
  });

  it("harcama once kaydedilir, sonra kontrol edilir", () => {
    // Cagri zaten yapildi; saymamak butceyi yalanci kilardi.
    const b = new Budget(100, 100);
    b.spend({ girdiTokeni: 500 });
    expect(b.state().tokens).toBe(500);
    expect(b.isExceeded()).toBe(true);
  });
});
