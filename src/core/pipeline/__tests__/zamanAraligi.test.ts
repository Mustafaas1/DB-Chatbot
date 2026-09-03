import { describe, expect, it } from "vitest";
import { parseTimeRange, timeRangeCondition, timeRangeLabel } from "../zamanAraligi";

describe("zaman araligi ayristirma", () => {
  it("gorece araliklari gune cevirir", () => {
    expect(parseTimeRange("son 1 ay")).toEqual({ kind: "relative", days: 30 });
    expect(parseTimeRange("son 30 gün")).toEqual({ kind: "relative", days: 30 });
    expect(parseTimeRange("son 3 ay")).toEqual({ kind: "relative", days: 90 });
    expect(parseTimeRange("son 1 yıl")).toEqual({ kind: "relative", days: 365 });
    expect(parseTimeRange("son 2 hafta")).toEqual({ kind: "relative", days: 14 });
  });

  it("yazili sayilari okur", () => {
    // "son bir ay" en az "son 1 ay" kadar yaygin.
    expect(parseTimeRange("son bir ay")).toEqual({ kind: "relative", days: 30 });
    expect(parseTimeRange("son üç ay")).toEqual({ kind: "relative", days: 90 });
    expect(parseTimeRange("son altı ay")).toEqual({ kind: "relative", days: 180 });
  });

  it("es anlamli geriye bakan sozcukleri tanir", () => {
    for (const s of ["son 30 gün", "geçtiğimiz 30 gün", "geride kalan 30 gün"]) {
      expect(parseTimeRange(s), s).toEqual({ kind: "relative", days: 30 });
    }
  });

  it("sayi yoksa 1 varsayar", () => {
    expect(parseTimeRange("son ay")).toEqual({ kind: "relative", days: 30 });
    expect(parseTimeRange("son hafta")).toEqual({ kind: "relative", days: 7 });
  });

  it("çeyrek 90 gündür", () => {
    expect(parseTimeRange("son çeyrek")).toEqual({ kind: "relative", days: 90 });
  });
});

describe("takvim araliklari GORELI'den ayrilir", () => {
  it('"bu ay" ayın 1inden bugüne, "son 1 ay" 30 gün geriye', () => {
    // Ikisini ayni saymak ayin 3'unde sorulan soruya 30 gunluk cevap
    // verirdi; kullanicinin sordugu bu degil.
    expect(parseTimeRange("bu ay")).toEqual({ kind: "calendar", unit: "month", offset: 0 });
    expect(parseTimeRange("son 1 ay")).toEqual({ kind: "relative", days: 30 });
  });

  it('"geçen ay" önceki TAKVIM ayıdır', () => {
    expect(parseTimeRange("geçen ay")).toEqual({ kind: "calendar", unit: "month", offset: -1 });
    expect(parseTimeRange("önceki ay")).toEqual({ kind: "calendar", unit: "month", offset: -1 });
  });

  it("sayı varsa göreli aralığa düşer", () => {
    // "gecen 3 ay" takvim ayi degil, 90 gun.
    expect(parseTimeRange("geçen 3 ay")).toEqual({ kind: "relative", days: 90 });
  });

  it("yıl aralıkları", () => {
    expect(parseTimeRange("bu yıl")).toEqual({ kind: "calendar", unit: "year", offset: 0 });
    expect(parseTimeRange("bu sene")).toEqual({ kind: "calendar", unit: "year", offset: 0 });
    expect(parseTimeRange("geçen yıl")).toEqual({ kind: "calendar", unit: "year", offset: -1 });
  });
});

describe("ayristirilamayan girdi null doner", () => {
  it("bos girdi", () => {
    expect(parseTimeRange("")).toBeNull();
    expect(parseTimeRange(null)).toBeNull();
    expect(parseTimeRange(undefined)).toBeNull();
  });

  it("zaman araligi OLMAYAN ifadeler", () => {
    // Bunlar niyet cikariminda zamanAraligi alanina dusebiliyor;
    // tahmin etmektense ajana birakmak dogru.
    for (const s of ["kanala göre", "müşteri bazında", "aşamaya göre", "segment"]) {
      expect(parseTimeRange(s), s).toBeNull();
    }
  });

  it("geriye bakan sözcük yoksa aralık saymaz", () => {
    // "aylik ciro" bir aralik degil, bir olcu.
    expect(parseTimeRange("aylık ciro")).toBeNull();
    expect(parseTimeRange("yıllık büyüme")).toBeNull();
  });

  it("sıfır ve negatif reddedilir", () => {
    expect(parseTimeRange("son 0 gün")).toBeNull();
  });
});

describe("SQL koşulu", () => {
  it("göreli aralık DATEADD üretir", () => {
    expect(timeRangeCondition({ kind: "relative", days: 30 }, "CreatedAt"))
      .toBe("[CreatedAt] >= DATEADD(day, -30, CAST(GETDATE() AS date))");
  });

  it('"bu ay" ayın 1inden itibaren', () => {
    expect(timeRangeCondition({ kind: "calendar", unit: "month", offset: 0 }, "CreatedAt"))
      .toBe("[CreatedAt] >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)");
  });

  it('"geçen ay" KAPALI aralıktır', () => {
    // Ust sinir olmazsa bu ayin kayitlari da girer.
    const s = timeRangeCondition({ kind: "calendar", unit: "month", offset: -1 }, "CreatedAt");
    expect(s).toContain("DATEADD(month, -1,");
    expect(s).toContain("< DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)");
  });

  it('"geçen yıl" KAPALI aralıktır', () => {
    const s = timeRangeCondition({ kind: "calendar", unit: "year", offset: -1 }, "CreatedAt");
    expect(s).toContain("YEAR(GETDATE()) - 1");
    expect(s).toContain("< DATEFROMPARTS(YEAR(GETDATE()), 1, 1)");
  });

  it("kolon adını köşeli parantezle kaçışlar", () => {
    expect(timeRangeCondition({ kind: "relative", days: 7 }, "Ko]lon"))
      .toContain("[Ko]]lon]");
  });
});

describe("etiket", () => {
  it("kullanıcıya gösterilecek kısa açıklama", () => {
    expect(timeRangeLabel({ kind: "relative", days: 30 })).toBe("son 30 gün");
    expect(timeRangeLabel({ kind: "calendar", unit: "month", offset: 0 })).toBe("bu ay");
    expect(timeRangeLabel({ kind: "calendar", unit: "month", offset: -1 })).toBe("geçen ay");
    expect(timeRangeLabel({ kind: "calendar", unit: "year", offset: -1 })).toBe("geçen yıl");
  });
});
