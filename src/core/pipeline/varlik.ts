import type { Tablo } from "../db/sema";
import { veriSorgulaAraci } from "../db/aracSorgu";
import { pickAnalysisColumns, type AnalysisColumns } from "./nedenAnalizi";

/**
 * VARLIK COZUMLEME: "Fellas" -> gercekten hangi kayit?
 *
 * Soruda gecen adi MODEL cikariyor ama o ada GUVENMIYORUZ. Bu projede
 * modelin uydurdugu her kimlik (EXAMPLE_TEklif_001, AliYilmaz) kod
 * tarafinda dogrulanarak elendi; musteri adi da bir kimlik.
 *
 * Bu yuzden akis su: model bir PARCA verir, kod veritabaninda arar,
 * kullanici veritabanindan donen TAM adi gorur.
 *
 *   tek eslesme    -> profil kurulur
 *   birden fazla   -> kullaniciya sectirilir ("ADA" iki musteriye uyuyor)
 *   sifir eslesme  -> "boyle bir kayit yok" denir, uydurulmaz
 *
 * Arama TEK TABLO uzerinde ve LIKE ile; ad kolonu semadan bulunuyor,
 * tablo adina gore sabitlenmiyor.
 */

/** Cok kisa parca cok fazla seyle eslesir; "AS" tum sirketleri getirir. */
const MIN_QUERY_LENGTH = 3;

/** Bundan fazla eslesme varsa parca zaten ayirt edici degil. */
const MAX_MATCHES = 8;

export interface EntityMatch {
  /** Veritabanindaki TAM deger; kullaniciya bu gosterilir. */
  value: string;
  records: number;
}

export interface EntityResolution {
  /** Soruda gecen, aranan parca. */
  query: string;
  table: string;
  column: string;
  matches: EntityMatch[];
}

/**
 * Metin sabitini kacislar.
 *
 * Tek tirnak ikilenir (T-SQL kurali) ve kontrol karakterleri atilir.
 * Guard metin sabitlerini zaten notrlestiriyor; burasi ONDEKI kapi.
 */
export function sqlLiteral(v: string): string {
  // Kontrol karakterleri kacis dizisi YERINE kod noktasiyla eleniyor:
  // kaynakta ham kontrol bayti birakmak bu projede daha once dort kez
  // sessiz hataya yol acti.
  const temiz = [...v]
    .filter((c) => {
      const kod = c.codePointAt(0)!;
      return kod >= 32 && kod !== 127;
    })
    .join("");
  return `'${temiz.replace(/'/g, "''")}'`;
}

/** LIKE deseninde joker karakterler VERI olarak kalmali. */
function likePattern(v: string): string {
  const kacis = v.replace(/[\\%_[\]]/g, (c) => `\\${c}`);
  return sqlLiteral(`%${kacis}%`);
}

function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

/**
 * Ad parcasini arayan sorgu.
 *
 * ESCAPE '\' sart: musteri adinda gecen `%` ya da `_` joker sayilirsa
 * "A_B" arayan kullaniciya "AXB" de doner.
 */
export function buildEntityLookupQuery(k: AnalysisColumns, parca: string): string {
  return [
    `SELECT TOP (${MAX_MATCHES + 1}) ${quote(k.varlik)} AS [Deger], COUNT(*) AS [Kayit]`,
    `FROM dbo.${quote(k.tablo)}`,
    `WHERE ${k.silinmisVar ? "IsDeleted = 0 AND " : ""}` +
      `${quote(k.varlik)} LIKE ${likePattern(parca)} ESCAPE '\\'`,
    `GROUP BY ${quote(k.varlik)}`,
    "ORDER BY [Kayit] DESC",
  ].join(" ");
}

/**
 * Sorudaki adi veritabanindaki gercek kayitla esler.
 *
 * `null` doner: aranacak parca yok, tabloda ad kolonu yok, ya da
 * eslesme cok fazla. Hicbirinde tahmin yurutmuyoruz.
 */
export async function resolveEntity(
  tablo: Tablo, parca: string, izId: string
): Promise<EntityResolution | null> {
  const temiz = parca.trim();
  if (temiz.length < MIN_QUERY_LENGTH) return null;

  const k = pickAnalysisColumns(tablo);
  if (!k) return null;

  const sonuc = await veriSorgulaAraci.calistir(
    { sorgu: buildEntityLookupQuery(k, temiz) },
    { izId, provaMi: false }
  );

  const matches = readEntityMatches(sonuc.kolonlar, sonuc.satirlar);
  // Sinirin uzerindeyse parca ayirt edici degil: "san" yuzlerce sirkete
  // uyar. Rastgele birini secmektense hic secmemek dogru.
  if (matches.length > MAX_MATCHES) return null;

  return { query: temiz, table: k.tablo, column: k.varlik, matches };
}

export function readEntityMatches(kolonlar: string[], satirlar: unknown[][]): EntityMatch[] {
  const i = (ad: string) => kolonlar.findIndex((k) => k.toLowerCase() === ad.toLowerCase());
  const iDeger = i("Deger"), iKayit = i("Kayit");
  if (iDeger < 0) return [];

  return satirlar
    .filter((s) => typeof s[iDeger] === "string" && String(s[iDeger]).trim() !== "")
    .map((s) => ({
      value: String(s[iDeger]),
      records: typeof s[iKayit] === "number" ? s[iKayit] : 0,
    }));
}

/**
 * Tam esitlik varsa onu sec, yoksa belirsizlik KULLANICIYA birakilir.
 *
 * "ADA" iki musteriye birden uyuyor; birini secip digerini gizlemek,
 * kaynak tablo seciminde reddedilen davranisin aynisi olurdu.
 */
export function pickSingleMatch(cozum: EntityResolution): EntityMatch | null {
  if (cozum.matches.length === 1) return cozum.matches[0]!;

  const tam = cozum.matches.filter(
    (m) => m.value.toLocaleLowerCase("tr") === cozum.query.toLocaleLowerCase("tr")
  );
  return tam.length === 1 ? tam[0]! : null;
}
