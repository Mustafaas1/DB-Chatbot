import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Reddedilen planlarin kaydi.
 *
 * Spec: "Reddedilen planlarin nedeni kaydedilsin, sonraki turda ajana
 * baglam olarak verilsin."
 *
 * Sistemin OGRENEN tek parcasi bu. Kullanici bir plani reddettiginde
 * sebebi kaydedilir ve ayni ajan bir sonraki turda o sebebi gorur;
 * boylece ayni oneriyi tekrar tekrar uretmez.
 *
 * Kalici (SQLite): ogrenme oturum omurlu olsa degersiz olurdu.
 */

const YOL = resolve(process.env.RED_DB ?? "./veri/red.db");
let db: DatabaseSync | null = null;

function baglan(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(YOL), { recursive: true });
  db = new DatabaseSync(YOL);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS red (
      id TEXT PRIMARY KEY,
      ajan TEXT NOT NULL,
      plan_basligi TEXT NOT NULL,
      sebep TEXT NOT NULL,
      reddeden TEXT NOT NULL,
      olusturma TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS ix_red_ajan ON red(ajan, olusturma DESC)");
  return db;
}

export interface Red {
  id: string;
  ajan: string;
  planBasligi: string;
  sebep: string;
  reddeden: string;
  olusturma: string;
}

export function reddet(
  ajan: string, planBasligi: string, sebep: string, reddeden: string
): string {
  const id = randomUUID();
  baglan().prepare(
    "INSERT INTO red (id, ajan, plan_basligi, sebep, reddeden, olusturma) VALUES (?,?,?,?,?,?)"
  ).run(id, ajan, planBasligi, sebep.trim(), reddeden, new Date().toISOString());
  return id;
}

function satiriRedde(s: Record<string, unknown>): Red {
  return {
    id: String(s.id), ajan: String(s.ajan), planBasligi: String(s.plan_basligi),
    sebep: String(s.sebep), reddeden: String(s.reddeden), olusturma: String(s.olusturma),
  };
}

export function listele(ajan?: string, limit = 20): Red[] {
  const d = baglan();
  const satirlar = (ajan
    ? d.prepare("SELECT * FROM red WHERE ajan = ? ORDER BY olusturma DESC, rowid DESC LIMIT ?").all(ajan, limit)
    : d.prepare("SELECT * FROM red ORDER BY olusturma DESC, rowid DESC LIMIT ?").all(limit)
  ) as Record<string, unknown>[];
  return satirlar.map(satiriRedde);
}

/**
 * Ajana verilecek baglam metni.
 *
 * Bos donerse istem hic degismez: gecmisi olmayan ajana bos bir
 * "reddedilenler" baslgi gostermenin anlami yok.
 */
export function baglamMetni(ajan: string, azami = 5): string {
  const kayitlar = listele(ajan, azami);
  if (!kayitlar.length) return "";

  return [
    "DAHA ONCE REDDEDILEN PLANLAR (ayni oneriyi tekrarlama):",
    ...kayitlar.map((r) => `  - "${r.planBasligi}" -- reddedilme sebebi: ${r.sebep}`),
  ].join("\n");
}

/** Test icin: bellek ici veritabanina gecer. */
export function _testIcinSifirla(): void {
  db?.close();
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE red (
      id TEXT PRIMARY KEY, ajan TEXT NOT NULL, plan_basligi TEXT NOT NULL,
      sebep TEXT NOT NULL, reddeden TEXT NOT NULL, olusturma TEXT NOT NULL
    )
  `);
}
