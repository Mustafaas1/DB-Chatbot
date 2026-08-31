import { describe, expect, it } from "vitest";
import { ajanaGoreGrupla, dagit } from "../dagitici";
import type { HedefDugumu } from "../../hedef/tipler";
import type { Tablo } from "../../db/sema";

function dugum(baslik: string, olcumSorusu = "", gerekce = ""): HedefDugumu {
  return {
    id: baslik, baslik, tur: "olcum", gerekce, seviye: 2,
    cocuklar: [], durum: "bekliyor", olcumSorusu,
  };
}

const tablolar: Tablo[] = [
  { sema: "dbo", ad: "TicketRecords", satirSayisi: 6938, kolonlar: [
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
    expect(a?.ajan.kod).not.toBe("satis");
  });

  it("gerekce dogru yonlendirmeyi de bozmaz", () => {
    const [a] = dagit([dugum(
      "Durumlarına göre teklif sayısı", "",
      "Destek biletleri yoğunluğu nedeniyle bakıyoruz."
    )]);
    expect(a?.ajan.kod).toBe("satis");
  });
});

describe("kolon adlariyla puanlama", () => {
  it("kolon adi geciyorsa sinyal uretir", () => {
    const sema = dagit([dugum("AtananKisi bazında açık bilet dağılımı")], tablolar);
    const semasiz = dagit([dugum("AtananKisi bazında açık bilet dağılımı")]);
    expect(sema[0]!.puan).toBeGreaterThan(semasiz[0]!.puan);
    expect(sema[0]!.ajan.kod).toBe("destek");
  });

  it("ParaBirimi finansa yonlendirir", () => {
    const [a] = dagit([dugum("ParaBirimi bazında toplam tutar")], tablolar);
    expect(a?.ajan.kod).toBe("finans");
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
