import { havuzGetir } from "./havuz.js";

export interface Kolon { ad: string; tip: string; bosOlabilir: boolean; }
export interface Tablo {
  sema: string;
  ad: string;
  kolonlar: Kolon[];
  satirSayisi: number;
}

/**
 * Sema onbellegi.
 *
 * Python surumundeki ders: sema onbellegi HIC yenilenmiyordu, bu yuzden
 * tablo degistiginde ajan sonsuza dek eski semayla calisiyordu. Burada
 * TTL zorunlu ve yenileme disaridan tetiklenebilir.
 */
let onbellek: { tablolar: Tablo[]; zaman: number } | null = null;
const TTL_MS = Number(process.env.SCHEMA_TTL ?? 900) * 1000;

function kisaTip(veriTipi: string, uzunluk: number | null): string {
  if (veriTipi === "nvarchar" || veriTipi === "varchar") {
    return uzunluk === -1 ? `${veriTipi}(max)` : veriTipi;
  }
  return veriTipi;
}

export async function semaGetir(zorla = false): Promise<Tablo[]> {
  if (!zorla && onbellek && Date.now() - onbellek.zaman < TTL_MS) return onbellek.tablolar;

  const havuz = await havuzGetir();
  // Yasakli tablolar veritabaninda DENY'li; INFORMATION_SCHEMA yine de adlarini
  // gosterir, bu yuzden ayrica suzuluyorlar.
  const yanit = await havuz.request().query(`
    SELECT c.TABLE_SCHEMA AS sema, c.TABLE_NAME AS tablo, c.COLUMN_NAME AS kolon,
           c.DATA_TYPE AS tip, c.CHARACTER_MAXIMUM_LENGTH AS uzunluk,
           c.IS_NULLABLE AS bos, c.ORDINAL_POSITION AS sira,
           ISNULL(p.rows, 0) AS satir
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
     AND t.TABLE_TYPE = 'BASE TABLE'
    LEFT JOIN (
      SELECT o.name AS tablo, s.name AS sema, MAX(pt.rows) AS rows
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      JOIN sys.partitions pt ON pt.object_id = o.object_id AND pt.index_id IN (0, 1)
      GROUP BY o.name, s.name
    ) p ON p.tablo = c.TABLE_NAME AND p.sema = c.TABLE_SCHEMA
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
  `);

  const yasak = new Set(
    (process.env.SCHEMA_EXCLUDE_TABLES ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
  );

  const harita = new Map<string, Tablo>();
  for (const s of yanit.recordset as any[]) {
    if (yasak.has(String(s.tablo).toLowerCase())) continue;
    const anahtar = `${s.sema}.${s.tablo}`;
    let t = harita.get(anahtar);
    if (!t) {
      t = { sema: s.sema, ad: s.tablo, kolonlar: [], satirSayisi: Number(s.satir) };
      harita.set(anahtar, t);
    }
    t.kolonlar.push({ ad: s.kolon, tip: kisaTip(s.tip, s.uzunluk), bosOlabilir: s.bos === "YES" });
  }

  const tablolar = [...harita.values()].sort((a, b) => a.ad.localeCompare(b.ad));
  onbellek = { tablolar, zaman: Date.now() };
  return tablolar;
}

/**
 * Semayi isteme girecek kompakt metne cevirir.
 *
 * `sadece` verilirse yalnizca o tablolar yazilir. Bu bir optimizasyon
 * degil zorunluluk: tum sema ~6000 token ve Groq ucretsiz katmani
 * dakikada 8000 token veriyor.
 */
export function semaMetni(tablolar: Tablo[], sadece?: ReadonlySet<string>): string {
  const secili = sadece?.size
    ? tablolar.filter((t) => sadece.has(t.ad) || sadece.has(t.ad.toLowerCase()))
    : tablolar;

  return secili
    .map((t) => {
      const k = t.kolonlar
        .map((c) => `${c.ad}:${c.tip}${c.bosOlabilir ? "?" : ""}`)
        .join(", ");
      return `${t.sema}.${t.ad}(${k})  ~${t.satirSayisi} satir`;
    })
    .join("\n");
}
