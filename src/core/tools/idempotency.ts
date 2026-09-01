import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Idempotency defteri.
 *
 * "Ayni aksiyon iki kez calismasin" sartinin uygulamasi.
 *
 * Neden gerekli: agin kopmasi, kullanicinin iki kez tiklamasi ya da bir
 * retry ayni aksiyonu tekrar tetikleyebilir. "Bileti ata" iki kez
 * calisirsa zararsiz, ama "fatura kes" ya da "e-posta gonder" iki kez
 * calisirsa geri alinamaz.
 *
 * Kayit KALICI (SQLite): surec yeniden baslasa bile tekrar engellenir.
 * Bellekte tutmak, en cok ihtiyac duyuldugu ana -- cokme sonrasi retry --
 * karsi korumasiz birakirdi.
 */

const YOL = resolve(process.env.IDEMPOTENCY_DB ?? "./veri/idempotency.db");
let db: DatabaseSync | null = null;

function baglan(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(YOL), { recursive: true });
  db = new DatabaseSync(YOL);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency (
      anahtar TEXT PRIMARY KEY,
      arac TEXT NOT NULL,
      girdi_ozeti TEXT NOT NULL,
      sonuc TEXT,
      durum TEXT NOT NULL,
      olusturma TEXT NOT NULL
    )
  `);
  return db;
}

/**
 * Girdinin parmak izi.
 *
 * Ayni anahtarla FARKLI girdi gelirse bu bir hatadir: cagiran taraf
 * anahtari yeniden kullaniyor demektir. Sessizce ilk sonucu donmek
 * yanlis veri dondurmek olurdu.
 */
function girdiOzeti(girdi: unknown): string {
  return createHash("sha256").update(JSON.stringify(girdi ?? null)).digest("hex").slice(0, 32);
}

export class IdempotencyCakismasi extends Error {
  constructor(anahtar: string) {
    super(
      `Idempotency anahtari "${anahtar}" daha once FARKLI bir girdiyle ` +
      "kullanilmis. Ayni anahtar farkli girdi icin kullanilamaz."
    );
    this.name = "IdempotencyCakismasi";
  }
}

export type KayitDurumu = "calisiyor" | "tamamlandi" | "basarisiz";

export interface OncekiCagri {
  durum: KayitDurumu;
  sonuc: unknown;
}

/**
 * Anahtari kayda alir.
 *
 * Doner:
 *   null              -> ilk cagri, arac calistirilmali
 *   OncekiCagri       -> bu anahtar zaten kullanilmis, sonucu don
 *
 * Farkli girdiyle ayni anahtar gelirse firlatir.
 */
export function baslat(anahtar: string, arac: string, girdi: unknown): OncekiCagri | null {
  const ozet = girdiOzeti(girdi);
  const d = baglan();

  const mevcut = d.prepare("SELECT * FROM idempotency WHERE anahtar = ?").get(anahtar) as
    Record<string, unknown> | undefined;

  if (mevcut) {
    if (String(mevcut.girdi_ozeti) !== ozet) throw new IdempotencyCakismasi(anahtar);
    let sonuc: unknown = null;
    try { sonuc = mevcut.sonuc ? JSON.parse(String(mevcut.sonuc)) : null; } catch { /* bozuksa null */ }
    return { durum: String(mevcut.durum) as KayitDurumu, sonuc };
  }

  d.prepare(
    "INSERT INTO idempotency (anahtar, arac, girdi_ozeti, durum, olusturma) VALUES (?,?,?,'calisiyor',?)"
  ).run(anahtar, arac, ozet, new Date().toISOString());
  return null;
}

export function tamamla(anahtar: string, sonuc: unknown): void {
  baglan().prepare("UPDATE idempotency SET durum = 'tamamlandi', sonuc = ? WHERE anahtar = ?")
    .run(JSON.stringify(sonuc ?? null), anahtar);
}

/**
 * Basarisiz cagriyi kayittan DUSURUR.
 *
 * Basarisizligi kalici kaydetmek, gecici bir hatadan sonra aksiyonun
 * bir daha hic denenememesine yol acardi. Tekrar denenebilmeli.
 */
export function basarisiz(anahtar: string): void {
  baglan().prepare("DELETE FROM idempotency WHERE anahtar = ?").run(anahtar);
}

/** Test icin: bellek ici veritabanina gecer. */
export function _testIcinSifirla(): void {
  db?.close();
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE idempotency (
      anahtar TEXT PRIMARY KEY, arac TEXT NOT NULL, girdi_ozeti TEXT NOT NULL,
      sonuc TEXT, durum TEXT NOT NULL, olusturma TEXT NOT NULL
    )
  `);
}
