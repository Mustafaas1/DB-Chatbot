import { describe, expect, it } from "vitest";
import type { Tablo } from "../../db/sema";
import { pickAnalysisColumns } from "../nedenAnalizi";
import { sqlLiteral } from "../varlik";
import {
  allowedNumbers, buildEntityProfileQuery, buildPeerQuery, deriveSignals,
  readEntityProfile, readPeerPosition, type EntityProfile,
} from "../varlikProfili";
import { previousTimeRangeCondition, type TimeRange } from "../zamanAraligi";

const invoices = {
  ad: "Invoices",
  kolonlar: [
    { ad: "Id", tip: "uniqueidentifier" },
    { ad: "MusteriAdi", tip: "nvarchar" },
    { ad: "Tutar", tip: "decimal" },
    { ad: "ParaBirimi", tip: "nvarchar" },
    { ad: "CreatedAt", tip: "datetime2" },
    { ad: "IsDeleted", tip: "bit" },
  ],
} as unknown as Tablo;

const k = pickAnalysisColumns(invoices)!;
const buAy: TimeRange = { kind: "calendar", unit: "month", offset: 0 };
const son30: TimeRange = { kind: "relative", days: 30 };

const PROFIL_KOLONLARI = [
  "Simdi", "Onceki", "Tum", "Ilk", "Son",
  "SimdiTutar", "OncekiTutar", "SimdiTutarli", "OncekiTutarli", "ParaBirimi",
];

/** Tek satirlik profil sonucu kurar. */
function profilSatiri(o: Partial<Record<string, unknown>>): unknown[] {
  return PROFIL_KOLONLARI.map((ad) => o[ad] ?? null);
}

describe("önceki dönem koşulu", () => {
  it("göreli aralıkta ÜST SINIR koyar", () => {
    // Ust sinir olmasa "son 30 gun"un oncesi bu donemi de kapsar ve
    // karsilastirma kendisiyle yapilirdi.
    const s = previousTimeRangeCondition(son30, "CreatedAt");
    expect(s).toContain("-60,");
    expect(s).toContain("< DATEADD(day, -30,");
  });

  it("bu ay için geçen ayı KAPALI aralık verir", () => {
    const s = previousTimeRangeCondition(buAy, "CreatedAt");
    expect(s).toContain("DATEADD(month, -1,");
    expect(s).toContain("DATEADD(month, 0,");
  });

  it("geçen ay için iki ay öncesini verir", () => {
    const s = previousTimeRangeCondition(
      { kind: "calendar", unit: "month", offset: -1 }, "CreatedAt"
    );
    expect(s).toContain("DATEADD(month, -2,");
    expect(s).toContain("DATEADD(month, -1,");
  });
});

describe("profil sorgusu", () => {
  const sql = buildEntityProfileQuery(k, "FELLAS GIDA", buAy, sqlLiteral);

  it("iki dönemi TEK sorguda sayar", () => {
    expect(sql).toContain("AS [Simdi]");
    expect(sql).toContain("AS [Onceki]");
    expect(sql).toContain("COUNT(*) AS [Tum]");
  });

  it("tutarı OLAN kayıtları ayrıca sayar", () => {
    // Toplamin 0 olmasi ile tutarin hic girilmemis olmasi ayni sey degil.
    expect(sql).toContain("[Tutar] IS NOT NULL THEN 1 ELSE 0 END) AS [SimdiTutarli]");
  });

  it("varlığı EŞİTLİKLE süzer, LIKE ile değil", () => {
    // Ad zaten cozuldu; burada tekrar LIKE kullanmak baska musteriyi
    // profile karistirirdi.
    expect(sql).toContain("[MusteriAdi] = 'FELLAS GIDA'");
    expect(sql).not.toContain("LIKE");
  });

  it("tırnaklı adı kaçışlar", () => {
    expect(buildEntityProfileQuery(k, "O'Brien", buAy, sqlLiteral))
      .toContain("= 'O''Brien'");
  });
});

describe("akran sorgusu", () => {
  const sql = buildPeerQuery(k, "FELLAS GIDA", buAy, sqlLiteral);

  it("dönemdeki tüm varlıkları gruplayıp konumu bulur", () => {
    expect(sql).toContain("WITH akran AS");
    expect(sql).toContain("AS [Toplam]");
    expect(sql).toContain("AS [Altinda]");
    expect(sql).toContain("AVG(CAST(a.n AS float))");
  });

  it("hedefin sayısını AYRI CTE'de tutar", () => {
    // SQL Server toplam fonksiyonunun ifadesinde alt sorguya izin
    // vermiyor; ilk surum bu yuzden calisirken patladi (hata 130).
    expect(sql).toContain("hedef AS (SELECT MAX(n)");
    expect(sql).toContain("CROSS JOIN hedef h");
    expect(sql).not.toMatch(/SUM\(CASE WHEN[^)]*\(SELECT/);
  });
});

describe("profilin okunması", () => {
  const simdi = new Date("2026-09-02T12:00:00Z");

  it("dönem farkını ve gecikmeyi hesaplar", () => {
    const p = readEntityProfile(
      "FELLAS", "Invoices", buAy, PROFIL_KOLONLARI,
      [profilSatiri({
        Simdi: 10, Onceki: 4, Tum: 20,
        Ilk: new Date("2024-09-02T00:00:00Z"),
        Son: new Date("2026-08-01T00:00:00Z"),
      })],
      null, simdi
    )!;

    expect(p.current).toBe(10);
    expect(p.previous).toBe(4);
    expect(p.changePercent).toBe(150);
    expect(p.allTime).toBe(20);
    expect(p.daysSinceLast).toBe(32);
    // 2024-09-02 -> 2026-08-01 = 698 gun, 19 aralik => 36,7
    expect(p.averageIntervalDays).toBe(36.7);
  });

  it("önceki dönem 0 ise yüzde TANIMSIZ", () => {
    // "%Infinity artis" gostermek yerine null; kart da bunu yazmiyor.
    const p = readEntityProfile(
      "X", "Invoices", buAy, PROFIL_KOLONLARI,
      [profilSatiri({ Simdi: 3, Onceki: 0, Tum: 3 })], null, simdi
    )!;
    expect(p.changePercent).toBeNull();
  });

  it("tutar KAYDEDİLMEMİŞSE 0 değil null", () => {
    // Sifir gostermek "bu musteri hic para birakmadi" demek olurdu.
    const p = readEntityProfile(
      "X", "Invoices", buAy, PROFIL_KOLONLARI,
      [profilSatiri({ Simdi: 5, Onceki: 5, Tum: 10, SimdiTutar: 0, SimdiTutarli: 0 })],
      null, simdi
    )!;
    expect(p.currentAmount).toBeNull();
    expect(p.amountChangePercent).toBeNull();
  });

  it("iki kayıtlı geçmişte ortalama aralık HESAPLANMAZ", () => {
    // Iki kayitla "ortalama" demek tek olcumu ortalama diye sunmaktir.
    const p = readEntityProfile(
      "X", "Invoices", buAy, PROFIL_KOLONLARI,
      [profilSatiri({
        Simdi: 1, Onceki: 1, Tum: 2,
        Ilk: new Date("2026-01-01"), Son: new Date("2026-08-01"),
      })],
      null, simdi
    )!;
    expect(p.averageIntervalDays).toBeNull();
  });

  it("boş sonuçta null döner", () => {
    expect(readEntityProfile("X", "Invoices", buAy, PROFIL_KOLONLARI, [])).toBeNull();
  });

  it("hiç kaydı olmayan varlık için profil KURULMAZ", () => {
    // Tam esitlik hicbir satira uymazsa sorgu yine tek satir dondurur,
    // her alani sifir. Bunu profil saymak var olmayan bir musteri
    // hakkinda "akranlarin altinda" yorumu urettiriyordu.
    expect(readEntityProfile(
      "YOK", "Invoices", buAy, PROFIL_KOLONLARI,
      [profilSatiri({ Simdi: 0, Onceki: 0, Tum: 0 })]
    )).toBeNull();
  });
});

describe("akran konumu", () => {
  const kolonlar = ["Toplam", "Altinda", "Ortalama", "Enfazla"];

  it("yüzdelik dilimi hesaplar", () => {
    const a = readPeerPosition(kolonlar, [[50, 45, 2.4, 19]])!;
    expect(a).toMatchObject({ total: 50, below: 45, percentile: 90, average: 2.4, max: 19 });
  });

  it("dönemde hiç varlık yoksa null", () => {
    expect(readPeerPosition(kolonlar, [[0, 0, null, null]])).toBeNull();
  });
});

/* --- Sinyaller --- */

function profil(o: Partial<EntityProfile>): EntityProfile {
  return {
    entity: "FELLAS", table: "Invoices",
    rangeLabel: "bu ay", previousRangeLabel: "geçen ay",
    current: 0, previous: 0, changePercent: null,
    currentAmount: null, previousAmount: null, amountChangePercent: null,
    currency: null, allTime: 0, firstSeen: null, lastSeen: null,
    daysSinceLast: null, averageIntervalDays: null, peers: null,
    ...o,
  };
}

describe("sinyaller", () => {
  const tur = (p: EntityProfile) => deriveSignals(p).map((s) => s.kind);

  it("kendi ortalamasının 1,5 katını aşan gecikmeyi işaretler", () => {
    expect(tur(profil({ current: 1, daysSinceLast: 60, averageIntervalDays: 20 })))
      .toContain("overdue");
  });

  it("ortalamanın hemen üstü gecikme SAYILMAZ", () => {
    // 22 > 20 ama duzenli bir musteriyi "gecikti" diye isaretlemek
    // her tur uyari uretirdi.
    expect(tur(profil({ current: 1, daysSinceLast: 22, averageIntervalDays: 20 })))
      .not.toContain("overdue");
  });

  it("dönemde kaydı olmayan ama geçmişi olan varlık uykuda", () => {
    expect(tur(profil({ current: 0, allTime: 12 }))).toContain("dormant");
  });

  it("küçük dalgalanma eğilim sayılmaz", () => {
    // %10 fark gurultu; her turda "dusus" demek uyariyi degersizlestirir.
    expect(tur(profil({ current: 11, previous: 10, changePercent: 10 })))
      .not.toContain("growing");
  });

  it("%20 ve üstü düşüş işaretlenir", () => {
    expect(tur(profil({ current: 8, previous: 10, changePercent: -20 })))
      .toContain("declining");
  });

  it("üst dilimdeki varlığı işaretler", () => {
    const p = profil({
      current: 10, peers: { total: 50, below: 45, percentile: 90, average: 2.4, max: 19 },
    });
    expect(tur(p)).toContain("topTier");
    expect(tur(p)).not.toContain("belowAverage");
  });

  it("tüm kayıtları bu dönemdeyse YENİ sayar", () => {
    expect(tur(profil({ current: 3, allTime: 3, firstSeen: "2026-09-01T00:00:00.000Z" })))
      .toContain("new");
  });

  it("geçmişi olan varlık yeni SAYILMAZ", () => {
    expect(tur(profil({ current: 3, allTime: 9, firstSeen: "2024-01-01T00:00:00.000Z" })))
      .not.toContain("new");
  });
});

describe("izinli sayılar", () => {
  it("mutlak değeri de kapsar", () => {
    // "%20 dustu" ile "-%20" ayni olgu; model ikisini de yazabilmeli.
    const n = allowedNumbers(profil({ current: 8, previous: 10, changePercent: -20 }));
    expect(n).toContain(-20);
    expect(n).toContain(20);
    expect(n).toContain(8);
  });

  it("null alanları atar", () => {
    expect(allowedNumbers(profil({ current: 5 }))).not.toContain(null as never);
  });
});
