import { describe, expect, it } from "vitest";
import { ajanaGoreGrupla, dagit } from "../dagitici";
import type { HedefDugumu } from "../../hedef/tipler";

function dugum(baslik: string, olcumSorusu = ""): HedefDugumu {
  return {
    id: baslik, baslik, tur: "olcum", gerekce: "", seviye: 2,
    cocuklar: [], durum: "bekliyor", olcumSorusu,
  };
}

describe("dagitici", () => {
  it("tablo adi en guclu sinyal", () => {
    const [a] = dagit([dugum("X", "TicketRecords tablosunda kac kayit var")]);
    expect(a?.ajan.kod).toBe("destek");
  });

  it("terim ipucuyla dogru ajana gider", () => {
    expect(dagit([dugum("Durumlarina gore teklif sayisi")])[0]?.ajan.kod).toBe("satis");
    expect(dagit([dugum("Para birimine gore fatura tutari")])[0]?.ajan.kod).toBe("finans");
    expect(dagit([dugum("Izin turlerine gore talep sayisi")])[0]?.ajan.kod).toBe("ik");
    expect(dagit([dugum("Tamamlanmamis proje gorevleri")])[0]?.ajan.kod).toBe("proje");
  });

  it("Turkce karakter normalize edilir", () => {
    // "İşlemde", "Aşama" gibi kelimeler eslesmeli.
    const [a] = dagit([dugum("Aşamalarına göre açık destek biletleri")]);
    expect(a?.ajan.kod).toBe("destek");
    expect(a?.puan).toBeGreaterThan(0);
  });

  it("hicbir ipucu yoksa varsayilana duser ve puan 0 olur", () => {
    const [a] = dagit([dugum("filanca falanca")]);
    expect(a?.puan).toBe(0);
    expect(a?.ajan.kod).toBeTruthy();
  });

  it("ajana gore gruplar", () => {
    const atamalar = dagit([
      dugum("teklif sayisi"), dugum("bilet sayisi"), dugum("teklif tutari"),
    ]);
    const g = ajanaGoreGrupla(atamalar);
    expect([...g.keys()].length).toBeGreaterThanOrEqual(2);
    expect([...g.values()].reduce((t, v) => t + v.length, 0)).toBe(3);
  });
});
