import { config as envYukle } from "dotenv";

envYukle();

function gerekli(ad: string): string {
  const d = process.env[ad];
  if (!d) throw new Error(`.env icinde ${ad} tanimli degil.`);
  return d;
}

function sayi(ad: string, varsayilan: number): number {
  const ham = process.env[ad];
  if (!ham) return varsayilan;
  const n = Number(ham);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${ad} pozitif sayi olmali: ${ham}`);
  return n;
}

export const dbAyari = {
  sunucu: process.env.MSSQL_HOST ?? "localhost",
  port: sayi("MSSQL_PORT", 14330),
  veritabani: gerekli("MSSQL_DATABASE"),
  kullanici: gerekli("MSSQL_USER"),
  parola: gerekli("MSSQL_PASSWORD"),
  /** Sunucu tarafi sorgu zaman asimi. */
  sorguZamanAsimiMs: sayi("QUERY_TIMEOUT", 30) * 1000,
  /** Tek sorgudan donebilecek azami satir. */
  azamiSatir: sayi("MAX_ROWS", 500),
} as const;
