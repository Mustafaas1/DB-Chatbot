import { describe, expect, it } from "vitest";
import { ajanaGoreGrupla, dagit } from "../dagitici";
import type { GoalNodeGenis } from "../../hedef/tipler";
import type { Tablo } from "../../db/sema";

function dugum(baslik: string, olcumSorusu = "", gerekce = ""): GoalNodeGenis {
  return {
    id: baslik, parentId: "kok", statement: baslik, type: "metric",
    rationale: gerekce, measurementQuery: olcumSorusu,
    evidence: [], children: [], status: "pending",
  };
}

const tablolar: Tablo[] = [
  { sema: "dbo", ad: "TicketRecords", satirSayisi: 5000, kolonlar: [
    { ad: "AtananKisi", tip: "nvarchar", bosOlabilir: true },
    { ad: "Kanal", tip: "nvarchar", bosOlabilir: true },
  ]},
  { sema: "dbo", ad: "Teklifler", satirSayisi: 190, kolonlar: [
    { ad: "ParaBirimi", tip: "nvarchar", bosOlabilir: true },
  ]},
];

describe("GEREKCE yonlendirmeye katilmaz", () => {
  // Gercek hata: destek biletiyle ilgili bir olcum, gerekcesinde
  // "teklif kazanma orani" gectigi icin Satis Ajanina gidiyordu.
  it("satis terimli gerekce olcumu Satisa cekmez", () => {
    const [a] = dagit([dugum(
      "Otomatik kapanış sonrası geri bildirim sayısı", "",
      "Müşteri memnuniyeti teklif kazanma oranını etkiler."
    )]);
    expect(a?.ajan.kod).not.toBe("acquisition");
  });

  it("gerekce dogru yonlendirmeyi de bozmaz", () => {
    const [a] = dagit([dugum(
      "Durumlarına göre teklif sayısı", "",
      "Destek biletleri yoğunluğu nedeniyle bakıyoruz."
    )]);
    expect(a?.ajan.kod).toBe("acquisition");
  });
});

describe("kolon adlariyla puanlama", () => {
  it("kolon adi geciyorsa sinyal uretir", () => {
    const sema = dagit([dugum("AtananKisi bazında açık bilet dağılımı")], tablolar);
    const semasiz = dagit([dugum("AtananKisi bazında açık bilet dağılımı")]);
    expect(sema[0]!.puan).toBeGreaterThan(semasiz[0]!.puan);
    expect(sema[0]!.ajan.kod).toBe("experience");
  });

  it("PAYLASILAN kolon yanlis sinyal uretmez", () => {
    // ParaBirimi Teklifler'de, Teklifler ise acquisition ve
    // product-pricing'de ortak. Kolon iki ajani ayirt etmiyor, dolayisiyla
    // puan uretmemeli: uretirse rastgele birine gider ve kullanici bunu
    // kesin bir yonlendirme sanir.
    const [a] = dagit([dugum("ParaBirimi bazında toplam tutar")], tablolar);
    expect(a?.puan).toBe(0);
    expect(a?.belirsiz).toBe(true);
  });

  it("data-analyst kesitsel oldugu icin varsayilandir", () => {
    const [a] = dagit([dugum("filanca falanca")], tablolar);
    expect(a?.ajan.kod).toBe("data-analyst");
  });
});

describe("belirsizlik gorunur", () => {
  it("puan 0 ise belirsiz isaretlenir", () => {
    const [a] = dagit([dugum("filanca falanca")]);
    expect(a?.puan).toBe(0);
    expect(a?.belirsiz).toBe(true);
  });

  it("sinyal varsa belirsiz degildir", () => {
    const [a] = dagit([dugum("Aşamalarına göre açık destek biletleri")]);
    expect(a?.belirsiz).toBe(false);
  });
});

describe("dagitici", () => {
  it("tablo adi en guclu sinyal", () => {
    const [a] = dagit([dugum("X", "TicketRecords tablosunda kac kayit var")]);
    expect(a?.ajan.kod).toBe("experience");
  });

  it("terim ipucuyla dogru ajana gider", () => {
    expect(dagit([dugum("Durumlarina gore teklif sayisi")])[0]?.ajan.kod).toBe("acquisition");
    expect(dagit([dugum("Para birimine gore fatura tutari")])[0]?.ajan.kod).toBe("retention");
    expect(dagit([dugum("Izin turlerine gore talep sayisi")])[0]?.ajan.kod).toBe("people");
    expect(dagit([dugum("Tamamlanmamis proje gorevleri")])[0]?.ajan.kod).toBe("delivery");
  });

  it("Turkce karakter normalize edilir", () => {
    // "İşlemde", "Aşama" gibi kelimeler eslesmeli.
    const [a] = dagit([dugum("Aşamalarına göre açık destek biletleri")]);
    expect(a?.ajan.kod).toBe("experience");
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
