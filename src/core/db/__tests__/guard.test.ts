import { describe, expect, it } from "vitest";
import { SqlGuardHatasi, sqlDogrula } from "../guard.js";

const YASAK = new Set(["users", "credentialrecords", "refreshtokens"]);

function reddedilir(sql: string) {
  expect(() => sqlDogrula(sql, { yasakliTablolar: YASAK })).toThrow(SqlGuardHatasi);
}
function kabul(sql: string) {
  expect(() => sqlDogrula(sql, { yasakliTablolar: YASAK })).not.toThrow();
}

describe("temel kurallar", () => {
  it("duz SELECT gecer", () => kabul("SELECT TOP 10 Asama FROM dbo.TicketRecords"));
  it("WITH ile CTE gecer", () => kabul("WITH x AS (SELECT 1 AS a) SELECT a FROM x"));
  it("bos sorgu reddedilir", () => reddedilir("   "));
  it("SELECT olmayan reddedilir", () => reddedilir("UPDATE dbo.T SET a = 1"));
  it("kod blogu temizlenir", () =>
    expect(sqlDogrula("```sql\nSELECT 1\n```")).toBe("SELECT 1"));
  it("sondaki noktali virgul silinir", () =>
    expect(sqlDogrula("SELECT 1;")).toBe("SELECT 1"));
});

describe("yazma ifadeleri", () => {
  for (const s of [
    "SELECT 1; DROP TABLE T",
    "SELECT * INTO yeni FROM T",
    "SELECT 1 UNION SELECT 1; DELETE FROM T",
  ]) it(JSON.stringify(s), () => reddedilir(s));
});

describe("BYPASS 1 - metin sabiti icindeki --", () => {
  // Python surumunde gercek bir acikti: sirali temizlikte metin icindeki "--"
  // yorum sanilip satirin kalani siliniyor, ardindaki DROP taramaya hic
  // ulasmiyordu.
  it("metin icindeki -- sorgunun kalanini gizleyemez", () => {
    reddedilir("SELECT * FROM T WHERE a = 'x--' ; DROP TABLE U");
  });
  it("mesru metin sabiti calismayi engellemez", () => {
    kabul("SELECT * FROM dbo.T WHERE Ad = 'Guncelleme -- Tarihi'");
  });
  it("ikilenmis tirnak sabiti bitirmez", () => {
    reddedilir("SELECT * FROM T WHERE a = 'it''s--' ; DROP TABLE U");
  });
});

describe("BYPASS 2 - tirnakli tanimlayiciyla gizlenen yasak tablo", () => {
  it("koseli parantez", () => reddedilir("SELECT * FROM [Users]"));
  it("cift tirnak", () => reddedilir('SELECT * FROM "Users"'));
  it("geri tirnak", () => reddedilir("SELECT * FROM `Users`"));
  it("nitelikli ad", () => reddedilir("SELECT * FROM dbo.Users"));
  it("nitelikli + koseli", () => reddedilir("SELECT * FROM [dbo].[Users]"));
  it("izinli tablo etkilenmez", () => kabul("SELECT * FROM [TicketRecords]"));
});

describe("BYPASS 3 - nitelikli sistem proseduru", () => {
  // KELIME nokta icermedigi icin "sys.sp_" oneki Python'da olu bir kuraldi.
  it("sys.sp_who reddedilir", () => reddedilir("SELECT * FROM sys.sp_who"));
  it("nokta cevresi bosluklu da reddedilir", () => reddedilir("SELECT * FROM sys . sp_who"));
  it("xp_cmdshell reddedilir", () => reddedilir("SELECT * FROM xp_cmdshell"));
});

describe("yasakli kelime yanlis pozitif vermez", () => {
  it("kolon adi tirnakliysa sorun cikarmaz", () =>
    kabul("SELECT [Guncelleme] AS [Create] FROM dbo.TicketRecords"));
  it("metin sabitindeki yasakli kelime sorun cikarmaz", () =>
    kabul("SELECT * FROM dbo.T WHERE Durum = 'DELETE bekliyor'"));
});
