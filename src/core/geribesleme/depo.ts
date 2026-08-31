import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { OlcumBaglami, OlcumSnapshot } from "./tipler";

/**
 * Snapshot deposu.
 *
 * Denetim kaydiyla (denetim.db) AYNI veritabanini kullaniyor.
 * Her uygulanan islem icin olcum snapshot'lari (once/sonra) burada
 * saklanir. Olcum baglami da ayri tabloda tutulur.
 *
 * KAYITLAR ASLA SILINMEZ — denetim kaydiyla ayni ilke.
 */

const YOL = resolve(process.env.DENETIM_DB ?? "./veri/denetim.db");

let db: DatabaseSync | null = null;

function baglan(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(YOL), { recursive: true });
  db = new DatabaseSync(YOL);
  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS olcum_snapshot (
      id TEXT PRIMARY KEY,
      denetim_id TEXT NOT NULL,
      dugum_id TEXT NOT NULL,
      ajan_kod TEXT NOT NULL,
      soru TEXT NOT NULL,
      sql_sorgu TEXT,
      kolonlar TEXT,
      satirlar TEXT,
      satir_sayisi INTEGER NOT NULL,
      tur TEXT NOT NULL,
      olusturma TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS ix_snapshot_denetim ON olcum_snapshot(denetim_id, tur)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS olcum_baglami (
      id TEXT PRIMARY KEY,
      denetim_id TEXT NOT NULL,
      dugum_id TEXT NOT NULL,
      ajan_kod TEXT NOT NULL,
      soru TEXT NOT NULL,
      sql_sorgu TEXT NOT NULL,
      tablolar TEXT NOT NULL,
      olusturma TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS ix_baglam_denetim ON olcum_baglami(denetim_id)");

  return db;
}

function satirToSnapshot(s: Record<string, unknown>): OlcumSnapshot {
  const coz = (v: unknown): unknown => {
    if (typeof v !== "string" || !v) return [];
    try { return JSON.parse(v); } catch { return []; }
  };
  return {
    id: String(s.id),
    denetimId: String(s.denetim_id),
    dugumId: String(s.dugum_id),
    ajanKod: String(s.ajan_kod),
    soru: String(s.soru),
    sqlSorgu: String(s.sql_sorgu ?? ""),
    kolonlar: coz(s.kolonlar) as string[],
    satirlar: coz(s.satirlar) as unknown[][],
    satirSayisi: Number(s.satir_sayisi ?? 0),
    tur: String(s.tur) as "once" | "sonra",
    olusturma: String(s.olusturma),
  };
}

function satirToBaglam(s: Record<string, unknown>): OlcumBaglami {
  const coz = (v: unknown): string[] => {
    if (typeof v !== "string" || !v) return [];
    try { return JSON.parse(v) as string[]; } catch { return []; }
  };
  return {
    dugumId: String(s.dugum_id),
    ajanKod: String(s.ajan_kod),
    soru: String(s.soru),
    sql: String(s.sql_sorgu),
    tablolar: coz(s.tablolar),
  };
}

// ---------- Snapshot CRUD ----------

export function snapshotKaydet(
  denetimId: string,
  dugumId: string,
  ajanKod: string,
  soru: string,
  sqlSorgu: string,
  kolonlar: string[],
  satirlar: unknown[][],
  tur: "once" | "sonra"
): string {
  const id = randomUUID();
  const simdi = new Date().toISOString();
  baglan().prepare(`
    INSERT INTO olcum_snapshot (id, denetim_id, dugum_id, ajan_kod, soru,
                                sql_sorgu, kolonlar, satirlar, satir_sayisi, tur, olusturma)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, denetimId, dugumId, ajanKod, soru, sqlSorgu,
    JSON.stringify(kolonlar), JSON.stringify(satirlar),
    satirlar.length, tur, simdi
  );
  return id;
}

export function snapshotlariGetir(denetimId: string, tur?: "once" | "sonra"): OlcumSnapshot[] {
  const d = baglan();
  let satirlar: Record<string, unknown>[];
  if (tur) {
    satirlar = d.prepare(
      "SELECT * FROM olcum_snapshot WHERE denetim_id = ? AND tur = ? ORDER BY olusturma"
    ).all(denetimId, tur) as Record<string, unknown>[];
  } else {
    satirlar = d.prepare(
      "SELECT * FROM olcum_snapshot WHERE denetim_id = ? ORDER BY tur, olusturma"
    ).all(denetimId) as Record<string, unknown>[];
  }
  return satirlar.map(satirToSnapshot);
}

export function snapshotSayisi(denetimId: string): { once: number; sonra: number } {
  const d = baglan();
  const onceSay = d.prepare(
    "SELECT COUNT(*) AS sayi FROM olcum_snapshot WHERE denetim_id = ? AND tur = 'once'"
  ).get(denetimId) as { sayi: number } | undefined;
  const sonraSay = d.prepare(
    "SELECT COUNT(*) AS sayi FROM olcum_snapshot WHERE denetim_id = ? AND tur = 'sonra'"
  ).get(denetimId) as { sayi: number } | undefined;
  return {
    once: Number(onceSay?.sayi ?? 0),
    sonra: Number(sonraSay?.sayi ?? 0),
  };
}

// ---------- Bağlam CRUD ----------

export function baglamKaydet(
  denetimId: string,
  baglam: OlcumBaglami
): string {
  const id = randomUUID();
  const simdi = new Date().toISOString();
  baglan().prepare(`
    INSERT INTO olcum_baglami (id, denetim_id, dugum_id, ajan_kod, soru,
                                sql_sorgu, tablolar, olusturma)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, denetimId, baglam.dugumId, baglam.ajanKod, baglam.soru,
    baglam.sql, JSON.stringify(baglam.tablolar), simdi
  );
  return id;
}

export function baglamlariGetir(denetimId: string): OlcumBaglami[] {
  const satirlar = baglan().prepare(
    "SELECT * FROM olcum_baglami WHERE denetim_id = ? ORDER BY olusturma"
  ).all(denetimId) as Record<string, unknown>[];
  return satirlar.map(satirToBaglam);
}

// ---------- Geri besleme sonuclarini listele ----------

export interface GeriBeslemeDurumu {
  denetimId: string;
  onceVar: boolean;
  sonraVar: boolean;
  sonOlcum: string | null;
}

export function geriBeslemeDurumlari(denetimIdleri: string[]): GeriBeslemeDurumu[] {
  if (!denetimIdleri.length) return [];
  const d = baglan();
  return denetimIdleri.map((denetimId) => {
    const say = snapshotSayisi(denetimId);
    const son = d.prepare(
      "SELECT olusturma FROM olcum_snapshot WHERE denetim_id = ? ORDER BY olusturma DESC LIMIT 1"
    ).get(denetimId) as { olusturma: string } | undefined;
    return {
      denetimId,
      onceVar: say.once > 0,
      sonraVar: say.sonra > 0,
      sonOlcum: son?.olusturma ?? null,
    };
  });
}

// ---------- Test yardımcısı ----------

export function _testIcinSifirla(): void {
  db?.close();
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE olcum_snapshot (
      id TEXT PRIMARY KEY, denetim_id TEXT NOT NULL, dugum_id TEXT NOT NULL,
      ajan_kod TEXT NOT NULL, soru TEXT NOT NULL, sql_sorgu TEXT,
      kolonlar TEXT, satirlar TEXT, satir_sayisi INTEGER NOT NULL,
      tur TEXT NOT NULL, olusturma TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE olcum_baglami (
      id TEXT PRIMARY KEY, denetim_id TEXT NOT NULL, dugum_id TEXT NOT NULL,
      ajan_kod TEXT NOT NULL, soru TEXT NOT NULL, sql_sorgu TEXT NOT NULL,
      tablolar TEXT NOT NULL, olusturma TEXT NOT NULL
    )
  `);
}
