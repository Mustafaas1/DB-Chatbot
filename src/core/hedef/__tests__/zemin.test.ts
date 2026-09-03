import { describe, expect, it } from "vitest";
import { schemaVocabulary, checkGrounding } from "../zemin";
import type { Tablo } from "../../db/sema";

const tablolar: Tablo[] = [
  { sema: "dbo", ad: "TicketRecords", satirSayisi: 5000, kolonlar: [
    { ad: "BiletNo", tip: "nvarchar", bosOlabilir: false },
    { ad: "Asama", tip: "nvarchar", bosOlabilir: true },
    { ad: "Oncelik", tip: "int", bosOlabilir: false },
    { ad: "AtananKisi", tip: "nvarchar", bosOlabilir: true },
    { ad: "Kanal", tip: "nvarchar", bosOlabilir: true },
  ]},
  { sema: "dbo", ad: "Teklifler", satirSayisi: 190, kolonlar: [
    { ad: "Durum", tip: "nvarchar", bosOlabilir: true },
    { ad: "ParaBirimi", tip: "nvarchar", bosOlabilir: true },
  ]},
  { sema: "dbo", ad: "ProjectTasks", satirSayisi: 186, kolonlar: [
    { ad: "Durum", tip: "nvarchar", bosOlabilir: true },
  ]},
  { sema: "dbo", ad: "LeaveRequests", satirSayisi: 100, kolonlar: [
    { ad: "Tur", tip: "nvarchar", bosOlabilir: true },
  ]},
  { sema: "dbo", ad: "Suggestions", satirSayisi: 40, kolonlar: [
    { ad: "Metin", tip: "nvarchar", bosOlabilir: true },
  ]},
];

const sozluk = schemaVocabulary(tablolar);
const kontrol = (m: string) => checkGrounding(m, sozluk);

describe("semaSozlugu", () => {
  it("CamelCase tablo ve kolon adlarini boler", () => {
    expect(sozluk.has("ticket")).toBe(true);
    expect(sozluk.has("records")).toBe(true);
    expect(sozluk.has("asama")).toBe(true);
    expect(sozluk.has("para")).toBe(true);
  });
});

describe("agacin URETTIGI gercek zeminsiz olcumler", () => {
  // Tarayici testinde gorulen, 22-34 saniye harcayip anlamsiz donenler.
  for (const m of [
    "SSS Makale Eşleştirme",
    "Otomatik Çözüm Makalesi Önerisi",
    "Konu Bazlı Makale Popülerliği",
    "SSS sayfasına günlük benzersiz ziyaretçi sayısı",
    "Chatbotun ortalama yanıt süresi",
  ]) {
    it(JSON.stringify(m), () => {
      const r = kontrol(m);
      expect(r.grounded).toBe(false);
      expect(r.sebep).toBeTruthy();
    });
  }

  it("tek bir yok-kavram yuksek ortusmeye ragmen reddeder", () => {
    // "yanit" ve "sure" semada gecse bile chatbot yok.
    const r = kontrol("Chatbotun ortalama yanıt süresi");
    expect(r.grounded).toBe(false);
    expect(r.sebep).toContain("chatbot");
  });
});

describe("mesru olcumler ENGELLENMEZ", () => {
  for (const m of [
    "Aşamalarına göre açık destek biletleri",
    "Düşük öncelikli biletlerin sayısı",
    "TicketRecords tablosunda Kanal değerine göre grup sayımı",
    "Durumlarına göre teklif sayısı",
    "İzin türlerine göre talep sayısı",
    "En çok bilet atanan 10 kişi",
    "Tamamlanmamış proje görevleri",
    "Para birimine göre teklif tutarı",
  ]) {
    it(JSON.stringify(m), () => expect(kontrol(m).grounded).toBe(true));
  }
});

describe("muhafazakar davranis", () => {
  it("anlamli kelime yoksa zeminli sayar", () => {
    expect(kontrol("bu ve su icin").grounded).toBe(true);
  });

  it("bos metin zeminli sayar", () => {
    expect(kontrol("").grounded).toBe(true);
  });
});

/**
 * Kabul senaryosu regresyonu.
 *
 * "Son 1 ayda satin alim yapan musterileri getir." sorusunda zemin
 * kontrolu GECERLI olcumlerin tamamini elemisti. Asagidaki metinler o
 * kosudan birebir alindi.
 */
describe("zemin: satin alma olcumleri elenmemeli", () => {
  const sozluk = schemaVocabulary([
    {
      ad: "Invoices",
      kolonlar: [
        { ad: "Id" }, { ad: "MusteriAdi" }, { ad: "Tutar" }, { ad: "ParaBirimi" },
        { ad: "BaslangicTarihi" }, { ad: "CreatedAt" }, { ad: "IsDeleted" },
      ],
    },
    { ad: "TeklifKalemleri", kolonlar: [{ ad: "UrunKodu" }, { ad: "Miktar" }, { ad: "BirimFiyat" }] },
    { ad: "ServiceForms", kolonlar: [{ ad: "Id" }, { ad: "Durum" }] },
    { ad: "VehicleTrafficFines", kolonlar: [{ ad: "Id" }, { ad: "Tutar" }] },
  ] as unknown as Tablo[]);

  it("satin alma olcumleri zeminli sayilir", () => {
    for (const m of [
      "Musterilerin son 30 gun icinde yaptigi satin alma sayisi",
      "Her musterinin ilk satin alma tarihini gosteren kayit",
      "Bir musterinin son 12 ay icinde kac ayri satin alma islemi gerceklestirdigi",
      "Invoices tablosunda her 'MusteriAdi' icin en erken 'BaslangicTarihi' sonrasi gerceklesen satir sayisini say",
      "Son 1 ayda fatura olusturan musterilerin toplam tutari",
    ]) {
      const s = checkGrounding(m, sozluk);
      expect(s.grounded, `${m} -- ${s.sebep}`).toBe(true);
    }
  });

  it('"say" fiili "sayfa" sanilmaz', () => {
    // Cift yonlu onek kontrolu bunu eliyordu.
    expect(checkGrounding("Fatura satirlarini say", sozluk).grounded).toBe(true);
  });

  it("yasak liste semayi EZMEZ", () => {
    // Bu iki terim yasak listedeydi ama tablolari gercekten var.
    expect(checkGrounding("ServiceForms kayitlarinin durumu", sozluk).grounded).toBe(true);
    expect(checkGrounding("Arac trafik cezalarinin tutari", sozluk).grounded).toBe(true);
  });

  it("gercekten olmayan kavramlar hala eleniyor", () => {
    for (const m of [
      "Chatbotun ortalama yanit suresi",
      "SSS makale populerligi",
      "Self servis portali kullanim orani",
      "Anket memnuniyet skoru",
    ]) {
      expect(checkGrounding(m, sozluk).grounded, m).toBe(false);
    }
  });
});
