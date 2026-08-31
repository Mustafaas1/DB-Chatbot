import sql from "mssql";
import { dbAyari } from "./ayar.js";

let havuz: sql.ConnectionPool | null = null;

/**
 * Tek bir baglanti havuzu.
 *
 * Kullanici `ajan_okur`: veritabani seviyesinde db_datareader ve 8 hassas
 * tabloya DENY. Yani buradaki kod hatali olsa bile yazamaz ve yasakli
 * tabloyu goremez -- sinir kodda degil, veritabaninda.
 */
export async function havuzGetir(): Promise<sql.ConnectionPool> {
  if (havuz?.connected) return havuz;
  havuz = await new sql.ConnectionPool({
    server: dbAyari.sunucu,
    port: dbAyari.port,
    database: dbAyari.veritabani,
    user: dbAyari.kullanici,
    password: dbAyari.parola,
    options: { encrypt: true, trustServerCertificate: true, appName: "is-zekasi-ajan" },
    connectionTimeout: 15_000,
    requestTimeout: dbAyari.sorguZamanAsimiMs,
    pool: { min: 0, max: 4, idleTimeoutMillis: 30_000 },
  }).connect();
  return havuz;
}

export async function havuzKapat(): Promise<void> {
  if (havuz) { await havuz.close(); havuz = null; }
}
