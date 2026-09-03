import { describe, expect, it } from "vitest";
import {
  AUTONOMY_MODES, DEFAULT_MODE, readMode, canRunAutomatically, isAutomatic,
} from "../mod";

const dusuk = { risk: "low" as const, reversible: true };
const orta = { risk: "medium" as const, reversible: true };
const yuksek = { risk: "high" as const, reversible: true };
const geriAlinamaz = { risk: "low" as const, reversible: false };

describe("otonomi modlari", () => {
  it("varsayilan assisted", () => {
    expect(DEFAULT_MODE).toBe("assisted");
    expect(readMode(undefined)).toBe("assisted");
    expect(readMode("saçmalık")).toBe("assisted");
    expect(readMode(" AUTO ")).toBe("auto");
  });

  it("manual: hicbir sey otomatik degil", () => {
    expect(canRunAutomatically(dusuk, "manual").automatic).toBe(false);
    expect(canRunAutomatically(orta, "manual").automatic).toBe(false);
  });

  it("assisted: yalnizca low", () => {
    expect(canRunAutomatically(dusuk, "assisted").automatic).toBe(true);
    expect(canRunAutomatically(orta, "assisted").automatic).toBe(false);
  });

  it("auto: low ve medium", () => {
    expect(canRunAutomatically(dusuk, "auto").automatic).toBe(true);
    expect(canRunAutomatically(orta, "auto").automatic).toBe(true);
  });

  it("HICBIR mod high riski otomatiklestiremez", () => {
    for (const m of AUTONOMY_MODES) {
      const k = canRunAutomatically(yuksek, m);
      expect(k.automatic, `mod=${m}`).toBe(false);
      expect(k.reason).toContain("Risk yuksek");
    }
  });

  it("HICBIR mod geri alinamaz aksiyonu otomatiklestiremez", () => {
    for (const m of AUTONOMY_MODES) {
      const k = canRunAutomatically(geriAlinamaz, m);
      expect(k.automatic, `mod=${m}`).toBe(false);
      expect(k.reason).toContain("geri alinamiyor");
    }
  });

  it("otomatik onaylayan insandan ayirt edilebilir", () => {
    expect(isAutomatic("otomatik:auto")).toBe(true);
    expect(isAutomatic("mustafa")).toBe(false);
    expect(isAutomatic(null)).toBe(false);
  });
});
