import sql from "mssql";
import { config as envYukle } from "dotenv";

envYukle();

/**
 * YAZMA baglantisi.
 *
 * Okuma havuzundan (havuz.ts) AYRI ve farkli bir kullaniciyla acilir:
 *   ajan_okur  -> db_datareader, hicbir sey yazamaz
 *   ajan_yazar -> hicbir tabloya yazma yetkisi YOK; yalnizca beyaz
 *                 listedeki sakli yordamlara EXECUTE
 *
 * Ayirmanin sebebi: okuma yolu (her soruda calisan LLM dongusu) yazma
 * yetkisi olan bir baglantiya asla dokunmasin. Kod hatasi ya da istem
 * enjeksiyonu okuma yolundan yazmaya sizamaz.
 */

export class YazmaKapaliHatasi extends Error {
  constructor() {
    super(
      "Yazma yapilandirilmamis. .env icinde MSSQL_YAZAR_USER ve " +
      "MSSQL_YAZAR_PASSWORD tanimli olmali; ayrica sql/f5_yazma.sql " +
      "calistirilmis olmali. Sistem su an yalnizca PROVA yapabilir."
    );
    this.name = "YazmaKapaliHatasi";
  }
}

export function yazmaAcikMi(): boolean {
  return Boolean(process.env.MSSQL_YAZAR_USER && process.env.MSSQL_YAZAR_PASSWORD);
}

let havuz: sql.ConnectionPool | null = null;

export async function yazmaHavuzuGetir(): Promise<sql.ConnectionPool> {
  if (!yazmaAcikMi()) throw new YazmaKapaliHatasi();
  if (havuz?.connected) return havuz;

  havuz = await new sql.ConnectionPool({
    server: process.env.MSSQL_HOST ?? "localhost",
    port: Number(process.env.MSSQL_PORT ?? 14330),
    database: process.env.MSSQL_DATABASE!,
    user: process.env.MSSQL_YAZAR_USER!,
    password: process.env.MSSQL_YAZAR_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true, appName: "is-zekasi-yazar" },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: { min: 0, max: 2, idleTimeoutMillis: 30_000 },
  }).connect();
  return havuz;
}

export async function yazmaHavuzuKapat(): Promise<void> {
  if (havuz) { await havuz.close(); havuz = null; }
}
