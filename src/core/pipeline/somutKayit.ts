import sql from "mssql";
import { ISLEMLER } from "../yaz/islemler";
import { havuzGetir } from "../db/havuz";
import { semaGetir, type Tablo } from "../db/sema";
import type { OlcumSonucu } from "../ajan/olcum";
import type { Diagnosis } from "./teshis";

/**
 * Olcumden SOMUT kayitlar cikarir.
 *
 * Neden gerekli: model toplu aksiyon oneriyor ("dusuk oncelikli TUM
 * biletleri Islemde yap") ama beyaz liste tek kayit uzerinde calisiyor.
 * Sonuc: her aksiyon "biletNo: expected string, received undefined" ile
 * dusuyordu.
 *
 * Cozum toplu islem eklemek DEGIL -- o tek onayla yuzlerce kaydi
 * degistirirdi. Bunun yerine olcumun isaret ettigi somut kayitlar
 * cekiliyor ve modele veriliyor; boylece aksiyonlar gercek kimliklere
 * baglaniyor ve her biri tek tek onaydan geciyor.
 *
 * Sorgu KOD tarafindan, parametreli olarak yaziliyor: modele SQL
 * yazdirmiyoruz.
 */

/** Insan tarafindan okunabilir kimlik kolonu tercih edilir. */
const KIMLIK_ONCELIGI = [/^BiletNo$/i, /No$/i, /Kod$/i, /^Id$/i];

export interface ConcreteRecord {
  kimlik: string;
  etiket: string;
}

export interface ConcreteResult {
  tablo: string;
  kimlikKolonu: string;
  kayitlar: ConcreteRecord[];
  /** Hangi gruba gore suzuldu. */
  filtre?: { kolon: string; deger: string };
  /** Tabloda GERCEKTEN atanmis kisiler. Model kisi adi da uyduruyor. */
  atananlar: string[];
}

/** Olcum SQL'inden tablo adini cikarir ve SEMAYA KARSI dogrular. */
function findTable(olcumSql: string, tablolar: Tablo[]): Tablo | null {
  const es = /(?:^|\s)FROM\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][A-Za-z0-9_]*)\]?/i.exec(olcumSql);
  if (!es) return null;
  const ad = es[1]!.toLowerCase();
  // Sema disi bir ad kabul edilmez; enjeksiyon yuzeyi birakmiyoruz.
  return tablolar.find((t) => t.ad.toLowerCase() === ad) ?? null;
}

function kimlikKolonu(tablo: Tablo): string | null {
  // Tabloya yazma islemi tanimliysa ONUN kolonu esastir. Aksi halde
  // Invoices icin MikroEvrakNo secilip fatura_durum_degistir'in
  // bekledigi Id ile hic ortusmuyordu.
  const islem = ISLEMLER.find(
    (i) => i.hedefTablo.toLowerCase() === tablo.ad.toLowerCase()
  );
  if (islem && tablo.kolonlar.some((c) => c.ad === islem.kimlikKolonu)) {
    return islem.kimlikKolonu;
  }

  for (const desen of KIMLIK_ONCELIGI) {
    const k = tablo.kolonlar.find((c) => desen.test(c.ad));
    if (k) return k.ad;
  }
  return null;
}

/** Aciklayici bir metin kolonu; listede kaydi tanimaya yarar. */
function labelColumn(tablo: Tablo, kimlik: string): string | null {
  const aday = tablo.kolonlar.find(
    (c) => c.ad !== kimlik && /char/i.test(c.tip) && /(baslik|ad|adi|konu|title|name)/i.test(c.ad)
  );
  return aday?.ad ?? null;
}

/** Teshisteki baskin grubu (yigilma/aykiri) filtre olarak kullanir. */
function dominantGroup(sonuc: OlcumSonucu, teshis: Diagnosis): { kolon: string; deger: string } | null {
  const bulgu = teshis.findings.find((b) => b.etiket && (b.tur === "yigilma" || b.tur === "aykiri"));
  if (!bulgu?.etiket) return null;

  // Etiketin hangi kolondan geldigini bul: o degeri tasiyan kolon.
  for (let n = 0; n < sonuc.kolonlar.length; n++) {
    if (sonuc.satirlar.some((s) => String(s[n]) === bulgu.etiket)) {
      return { kolon: sonuc.kolonlar[n]!, deger: bulgu.etiket };
    }
  }
  return null;
}

/** Kolonun tabloda GERCEKTEN var oldugunu dogrular (takma ad olabilir). */
function gercekKolon(tablo: Tablo, ad: string): string | null {
  const sade = ad.replace(/[\[\]]/g, "").trim().toLowerCase();
  return tablo.kolonlar.find((c) => c.ad.toLowerCase() === sade)?.ad ?? null;
}

/**
 * Olcumun isaret ettigi somut kayitlari getirir.
 *
 * Bulamazsa null doner; plan yine uretilir, yalnizca aksiyonsuz kalir.
 */
export async function fetchConcreteRecords(
  sonuc: OlcumSonucu, teshis: Diagnosis, azami = 5
): Promise<ConcreteResult | null> {
  if (!sonuc.sql) return null;

  const tablolar = await semaGetir();
  const tablo = findTable(sonuc.sql, tablolar);
  if (!tablo) return null;

  const kimlik = kimlikKolonu(tablo);
  if (!kimlik) return null;

  const etiket = labelColumn(tablo, kimlik);
  const grup = dominantGroup(sonuc, teshis);
  const filtreKolon = grup ? gercekKolon(tablo, grup.kolon) : null;

  const kimlikSql = `[${kimlik.replace(/]/g, "]]")}]`;
  const etiketSql = etiket ? `, [${etiket.replace(/]/g, "]]")}]` : "";
  const silinmisVar = tablo.kolonlar.some((c) => c.ad.toLowerCase() === "isdeleted");

  const kosullar: string[] = [];
  if (silinmisVar) kosullar.push("IsDeleted = 0");
  if (filtreKolon) kosullar.push(`[${filtreKolon.replace(/]/g, "]]")}] = @filtre`);

  const sorgu =
    `SELECT TOP (${azami}) ${kimlikSql}${etiketSql} ` +
    `FROM [${tablo.sema}].[${tablo.ad.replace(/]/g, "]]")}] ` +
    (kosullar.length ? `WHERE ${kosullar.join(" AND ")}` : "");

  try {
    const havuz = await havuzGetir();
    const istek = havuz.request();
    // Deger PARAMETRE olarak gidiyor; SQL'e gomulmuyor.
    if (filtreKolon && grup) istek.input("filtre", sql.NVarChar(200), grup.deger);
    const y = await istek.query(sorgu);

    const kayitlar: ConcreteRecord[] = (y.recordset as Record<string, unknown>[]).map((r) => ({
      kimlik: String(r[kimlik] ?? ""),
      etiket: etiket ? String(r[etiket] ?? "") : "",
    })).filter((k) => k.kimlik);

    if (!kayitlar.length) return null;

    // Gercek atanan kisiler: model "AutoResponderBot", "SeniorSupport" gibi
    // olmayan adlar oneriyordu.
    let atananlar: string[] = [];
    const atananKolon = tablo.kolonlar.find(
      (c) => /^(AtananKisi|SatisTemsilcisi)$/i.test(c.ad)
    );
    if (atananKolon) {
      try {
        const y2 = await havuz.request().query(
          `SELECT TOP (20) [${atananKolon.ad}] AS kisi ` +
          `FROM [${tablo.sema}].[${tablo.ad}] ` +
          `WHERE [${atananKolon.ad}] IS NOT NULL ` +
          (silinmisVar ? "AND IsDeleted = 0 " : "") +
          `GROUP BY [${atananKolon.ad}] ORDER BY COUNT(*) DESC`
        );
        atananlar = (y2.recordset as { kisi: unknown }[])
          .map((r) => String(r.kisi)).filter(Boolean);
      } catch { /* atanan listesi alinamazsa dogrulama atlanir */ }
    }

    return {
      tablo: tablo.ad, kimlikKolonu: kimlik, kayitlar, atananlar,
      ...(filtreKolon && grup ? { filtre: { kolon: filtreKolon, deger: grup.deger } } : {}),
    };
  } catch {
    return null;   // somut kayit bulunamazsa plan aksiyonsuz uretilir
  }
}

/** Modele verilecek kompakt metin. */
export function concreteRecordsText(s: ConcreteResult): string {
  const satirlar = s.kayitlar.map((k) => `  ${k.kimlik}${k.etiket ? " -- " + k.etiket : ""}`);
  const baslik = s.filtre
    ? `BU OLCUMDEKI ORNEK KAYITLAR (${s.filtre.kolon} = ${s.filtre.deger}):`
    : "BU OLCUMDEKI ORNEK KAYITLAR:";
  const kisiler = s.atananlar.length
    ? ["", "ATAMA YAPILABILECEK GERCEK KISILER:",
       "  " + s.atananlar.slice(0, 10).join(", ")]
    : [];
  return [baslik, ...satirlar, ...kisiler,
    `Aksiyon onerirken ${s.kimlikKolonu} ve kisi adi olarak YUKARIDAKI degerleri kullan; uydurma.`,
  ].join("\n");
}
