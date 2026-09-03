import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DenetimKaydi, IslemDurumu, Prova } from "./tipler";

/**
 * Denetim kaydi (audit log).
 *
 * Her yazma DENEMESI buraya yazilir -- reddedilenler ve basarisizlar dahil.
 * Yalnizca basarililari kaydetmek denetimi ise yaramaz hale getirirdi:
 * "neyin engellendigini" gormek en az "neyin yapildigini" gormek kadar
 * onemli.
 *
 * Kayitlar ASLA silinmez, yalnizca durum guncellenir.
 */

const YOL = resolve(process.env.DENETIM_DB ?? "./veri/denetim.db");

let db: DatabaseSync | null = null;

function baglan(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(YOL), { recursive: true });
  db = new DatabaseSync(YOL);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS denetim (
      id TEXT PRIMARY KEY,
      islem_kodu TEXT NOT NULL,
      islem_adi TEXT NOT NULL,
      hedef_tablo TEXT NOT NULL,
      parametreler TEXT NOT NULL,
      durum TEXT NOT NULL,
      prova TEXT,
      onceki_durum TEXT,
      onaylayan TEXT,
      hata TEXT,
      olusturma TEXT NOT NULL,
      guncelleme TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS ix_denetim_zaman ON denetim(olusturma DESC)");

  // Kolon sonradan eklendi. Mevcut denetim kayitlari silinmemeli:
  // audit log gecmisi kaybedilemez, o yuzden tablo yeniden kurulmuyor.
  const kolonlar = (db.prepare("PRAGMA table_info(denetim)").all() as { name: string }[])
    .map((k) => k.name);
  if (!kolonlar.includes("otonomi_modu")) {
    db.exec("ALTER TABLE denetim ADD COLUMN otonomi_modu TEXT");
  }
  return db;
}

function satiriKayda(s: Record<string, unknown>): DenetimKaydi {
  const coz = (v: unknown) => {
    if (typeof v !== "string" || !v) return null;
    try { return JSON.parse(v); } catch { return null; }
  };
  return {
    id: String(s.id),
    islemKodu: String(s.islem_kodu),
    islemAdi: String(s.islem_adi),
    hedefTablo: String(s.hedef_tablo),
    parametreler: coz(s.parametreler),
    durum: String(s.durum) as IslemDurumu,
    prova: coz(s.prova) as Prova | null,
    oncekiDurum: coz(s.onceki_durum),
    onaylayan: s.onaylayan == null ? null : String(s.onaylayan),
    otonomiModu: s.otonomi_modu == null ? null : String(s.otonomi_modu),
    hata: s.hata == null ? null : String(s.hata),
    olusturma: String(s.olusturma),
    guncelleme: String(s.guncelleme),
  };
}

export function oneriKaydet(
  islemKodu: string, islemAdi: string, hedefTablo: string,
  parametreler: unknown, prova: Prova
): string {
  const id = randomUUID();
  const simdi = new Date().toISOString();
  baglan().prepare(`
    INSERT INTO denetim (id, islem_kodu, islem_adi, hedef_tablo, parametreler,
                         durum, prova, olusturma, guncelleme)
    VALUES (?, ?, ?, ?, ?, 'oneri', ?, ?, ?)
  `).run(id, islemKodu, islemAdi, hedefTablo,
         JSON.stringify(parametreler), JSON.stringify(prova), simdi, simdi);
  return id;
}

export function durumGuncelle(
  id: string, durum: IslemDurumu,
  ek: { onaylayan?: string; oncekiDurum?: unknown; hata?: string; otonomiModu?: string } = {}
): void {
  const k = getir(id);
  if (!k) throw new Error(`Denetim kaydi yok: ${id}`);
  baglan().prepare(`
    UPDATE denetim SET durum = ?, onaylayan = ?, onceki_durum = ?, hata = ?,
                      otonomi_modu = ?, guncelleme = ?
    WHERE id = ?
  `).run(
    durum,
    ek.onaylayan ?? k.onaylayan,
    ek.oncekiDurum !== undefined ? JSON.stringify(ek.oncekiDurum) : JSON.stringify(k.oncekiDurum),
    ek.hata ?? k.hata,
    ek.otonomiModu ?? k.otonomiModu,
    new Date().toISOString(),
    id
  );
}

export function getir(id: string): DenetimKaydi | null {
  const s = baglan().prepare("SELECT * FROM denetim WHERE id = ?").get(id);
  return s ? satiriKayda(s as Record<string, unknown>) : null;
}

export function listele(limit = 50): DenetimKaydi[] {
  const satirlar = baglan()
    .prepare("SELECT * FROM denetim ORDER BY olusturma DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return satirlar.map(satiriKayda);
}

/** Test icin: bellek ici veritabanina gecer. */
export function _testIcinSifirla(): void {
  db?.close();
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE denetim (
      id TEXT PRIMARY KEY, islem_kodu TEXT NOT NULL, islem_adi TEXT NOT NULL,
      hedef_tablo TEXT NOT NULL, parametreler TEXT NOT NULL, durum TEXT NOT NULL,
      prova TEXT, onceki_durum TEXT, onaylayan TEXT, hata TEXT,
      olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL, otonomi_modu TEXT
    )
  `);
}
