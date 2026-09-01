import { describe, expect, it } from "vitest";
import { semaSozlugu, zeminKontrol } from "../zemin";
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

const sozluk = semaSozlugu(tablolar);
const kontrol = (m: string) => zeminKontrol(m, sozluk);

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
      expect(r.zeminli).toBe(false);
      expect(r.sebep).toBeTruthy();
    });
  }

  it("tek bir yok-kavram yuksek ortusmeye ragmen reddeder", () => {
    // "yanit" ve "sure" semada gecse bile chatbot yok.
    const r = kontrol("Chatbotun ortalama yanıt süresi");
    expect(r.zeminli).toBe(false);
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
    it(JSON.stringify(m), () => expect(kontrol(m).zeminli).toBe(true));
  }
});

describe("muhafazakar davranis", () => {
  it("anlamli kelime yoksa zeminli sayar", () => {
    expect(kontrol("bu ve su icin").zeminli).toBe(true);
  });

  it("bos metin zeminli sayar", () => {
    expect(kontrol("").zeminli).toBe(true);
  });
});
