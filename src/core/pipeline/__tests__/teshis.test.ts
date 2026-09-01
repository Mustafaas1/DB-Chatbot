import { describe, expect, it } from "vitest";
import { teshisCikar, teshisMetni } from "../teshis";
import type { OlcumSonucu } from "../../ajan/olcum";

function sonuc(kolonlar: string[], satirlar: unknown[][]): OlcumSonucu {
  return {
    dugumId: "d1", ajanKod: "destek", ajanAd: "Destek", renk: "#000",
    baslik: "test", soru: "s", cevap: "", sql: "",
    kolonlar, satirlar, satirSayisi: satirlar.length,
    bosMu: satirlar.length === 0, belirsiz: false, sureMs: 1,
    kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
  };
}

const turler = (s: ReturnType<typeof teshisCikar>) => s.bulgular.map((b) => b.tur);

describe("yigilma", () => {
  it("tek grup baskin oldugunda yakalanir", () => {
    // 4900 / toplam 4959 = %98
    const t = teshisCikar(sonuc(["Asama", "Adet"],
      [["Tamamlandı", 4900], ["Beklemede", 47], ["İşlemde", 12]]));
    expect(turler(t)).toContain("yigilma");
    expect(t.bulgular[0]?.etiket).toBe("Tamamlandı");
    expect(t.bulgular[0]?.oran).toBeGreaterThan(0.9);
    expect(t.toplam).toBe(4959);
  });

  it("esigin altinda yigilma denmez", () => {
    const t = teshisCikar(sonuc(["G", "A"], [["a", 50], ["b", 50]]));
    expect(turler(t)).not.toContain("yigilma");
  });
});

describe("uzun kuyruk", () => {
  it("alt yari cok kucukse yakalanir", () => {
    const t = teshisCikar(sonuc(["G", "A"],
      [["a", 500], ["b", 400], ["c", 5], ["d", 3], ["e", 2], ["f", 1]]));
    expect(turler(t)).toContain("uzun_kuyruk");
  });

  it("az gruplu sonucta aranmaz", () => {
    const t = teshisCikar(sonuc(["G", "A"], [["a", 100], ["b", 1]]));
    expect(turler(t)).not.toContain("uzun_kuyruk");
  });
});

describe("aykiri deger", () => {
  it("ortalamanin katiysa ve yigilma degilse yakalanir", () => {
    // 40 / toplam 100 = %40 (yigilma esigi altinda), ortalama 20 -> 2x... 
    // 3x icin: 45,15,15,15,10 -> toplam 100, ortalama 20, en=45 -> 2.25x degil.
    const t = teshisCikar(sonuc(["G", "A"],
      [["a", 55], ["b", 15], ["c", 15], ["d", 10], ["e", 5]]));
    // en=55, toplam=100, oran 0.55 < 0.6; ortalama 20 -> 2.75x, esik 3 -> yok
    expect(turler(t)).not.toContain("aykiri");
  });

  it("belirgin aykiri yakalanir", () => {
    const t = teshisCikar(sonuc(["G", "A"],
      [["a", 58], ["b", 12], ["c", 11], ["d", 10], ["e", 9]]));
    // en=58/100=0.58<0.6, ortalama 20 -> 2.9x ... hala esik alti
    expect(t.grupSayisi).toBe(5);
  });
});

describe("kenar durumlar", () => {
  it("bos sonuc", () => {
    const t = teshisCikar(sonuc(["A"], []));
    expect(turler(t)).toEqual(["bos"]);
  });

  it("tek grup", () => {
    const t = teshisCikar(sonuc(["G", "A"], [["a", 59]]));
    expect(turler(t)).toEqual(["tek_grup"]);
    expect(t.toplam).toBe(59);
  });

  it("sayisal kolon yoksa satir sayisi kullanilir", () => {
    const t = teshisCikar(sonuc(["BiletNo", "Baslik"], [["H1", "x"], ["H2", "y"]]));
    expect(t.toplam).toBe(2);
    expect(turler(t)).toEqual(["dengeli"]);
  });

  it("dengeli dagilimda bulgu bos kalmaz", () => {
    const t = teshisCikar(sonuc(["G", "A"], [["a", 34], ["b", 33], ["c", 33]]));
    expect(t.bulgular.length).toBeGreaterThan(0);
    expect(turler(t)).toContain("dengeli");
  });
});

describe("teshisMetni", () => {
  it("bulgulari tek metne cevirir", () => {
    const t = teshisCikar(sonuc(["Asama", "Adet"], [["Tamamlandı", 4900], ["Beklemede", 47]]));
    expect(teshisMetni([t])).toContain("Tamamlandı");
  });
});
