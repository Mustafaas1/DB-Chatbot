import { describe, expect, it } from "vitest";
import { olcumuDogrula } from "../dogrula";
import type { Tablo } from "../../db/sema";
import type { KolonDegerleri } from "../../db/degerler";

const tablolar: Tablo[] = [{
  sema: "dbo", ad: "TicketRecords", satirSayisi: 6938,
  kolonlar: [
    { ad: "BiletNo", tip: "nvarchar", bosOlabilir: false },
    { ad: "Asama", tip: "nvarchar", bosOlabilir: true },
    { ad: "Oncelik", tip: "int", bosOlabilir: false },
    { ad: "AtananKisi", tip: "nvarchar", bosOlabilir: true },
  ],
}];

const degerler: KolonDegerleri[] = [
  { tablo: "TicketRecords", kolon: "Asama", degerler: ["Beklemede", "İşlemde", "Tamamlandı"] },
  // Ayni kolon adi, FARKLI tabloda farkli degerler.
  { tablo: "ContractRecords", kolon: "Asama", degerler: ["Aktif", "Pasif", "Beklemede"] },
];

const dogrula = (m: string) => olcumuDogrula(m, tablolar, degerler);

describe("ekranda gorulen gercek hatalar", () => {
  it("Asama='Kapalı' yakalanir - boyle bir deger yok", () => {
    const s = dogrula("SELECT COUNT(*) FROM dbo.TicketRecords WHERE IsDeleted = 0 AND Asama = N'Kapalı'");
    expect(s.gecerli).toBe(false);
    expect(s.gecersizlikler[0]?.tur).toBe("olmayan_deger");
    expect(s.gecersizlikler[0]?.mesaj).toContain("Beklemede");
  });

  it("Oncelik='Yuksek' yakalanir - sayisal kolon metinle karsilastirilamaz", () => {
    const s = dogrula("Ortalama kapama suresi kritik (Oncelik='Yuksek') biletler icin");
    expect(s.gecerli).toBe(false);
    expect(s.gecersizlikler[0]?.tur).toBe("tip_uyusmazligi");
  });
});

describe("gecerli olcumler engellenmez", () => {
  it("gercek asama degeri gecer", () => {
    expect(dogrula("Asama = N'Beklemede' olan biletler").gecerli).toBe(true);
  });

  it("Turkce buyuk/kucuk harf farki engellemez", () => {
    expect(dogrula("Asama = N'beklemede'").gecerli).toBe(true);
  });

  it("sayisal kolon sayiyla karsilastirilirsa gecer", () => {
    expect(dogrula("Oncelik = '1' olan biletler").gecerli).toBe(true);
  });

  it("bilinmeyen kolon SUPHEDE gecerli sayilir", () => {
    // Yanlis pozitif, calisan bir olcumu engellerdi.
    expect(dogrula("Musteri = N'ACME' olan kayitlar").gecerli).toBe(true);
  });

  it("karsilastirma icermeyen metin gecer", () => {
    expect(dogrula("Asamalarina gore acik destek biletleri").gecerli).toBe(true);
  });
});

describe("ayni kolon adi farkli tablolarda", () => {
  it("metinde tablo geciyorsa YALNIZCA o tablonun degerleri kullanilir", () => {
    const s = dogrula("TicketRecords tablosunda Asama = N'Aktif' olan kayitlar");
    // "Aktif" ContractRecords'ta gecerli ama TicketRecords'ta degil.
    expect(s.gecerli).toBe(false);
    expect(s.gecersizlikler[0]?.beklenen).not.toContain("Pasif");
  });

  it("tablo gecmiyorsa birlesim kullanilir ve TEKRARSIZ olur", () => {
    const s = dogrula("Asama = N'Aktif' olan kayitlar");
    expect(s.gecerli).toBe(true);
    const t = dogrula("Asama = N'Kapalı'");
    // Beklemede iki tabloda da var; mesajda bir kez gecmeli.
    const beklenen = t.gecersizlikler[0]?.beklenen ?? "";
    expect(beklenen.split("Beklemede").length - 1).toBe(1);
  });
});

describe("oneri", () => {
  it("yakin degeri onerir", () => {
    const s = dogrula("Asama = N'Tamamlandi'");
    expect(s.gecerli).toBe(false);
    expect(s.gecersizlikler[0]?.mesaj).toContain("Tamamlandı");
  });

  it("birden fazla hatayi birden bildirir", () => {
    const s = dogrula("Asama = N'Kapalı' AND Oncelik = 'Yuksek'");
    expect(s.gecersizlikler).toHaveLength(2);
  });
});
