/**
 * LLM'in urettigi SQL'i calistirmadan once dogrulayan katman.
 *
 * Kural: yalnizca okuma. Bu, veritabani seviyesindeki izinlerin (ajan_okur
 * kullanicisi db_datareader + 8 tabloya DENY) TEKRARI degil, ONUNDEKI
 * kapidir. Veritabani son sozu soyler; burasi hatayi kullaniciya anlamli
 * bir mesajla, sorgu hic gonderilmeden bildirir.
 *
 * Python surumunden (app/sqlguard.py) port edildi. Orada bulunan iki gercek
 * bypass burada da kapali; ikisi icin de test var:
 *   1. Metin sabitinin icindeki "--" gercek yorum sanilip satirin geri kalani
 *      siliniyordu: SELECT * FROM T WHERE a = 'x--' ; DROP TABLE U
 *      Cozum: tek gecisli tarayici (tirnak ve yorum sinirlarini birlikte yorumlar).
 *   2. Koseli parantezli tanimlayici tarama oncesi _id_ ile degistigi icin
 *      yasakli tablo [Users] diye yazilarak gizlenebiliyordu.
 *      Cozum: yasakli tablo taramasi HAM sql uzerinde de yapilir.
 */

export class SqlGuardHatasi extends Error {
  constructor(mesaj: string) {
    super(mesaj);
    this.name = "SqlGuardHatasi";
  }
}

/** Veriyi/semayi degistirebilen ya da sunucuda komut calistirabilen kelimeler. */
const YASAKLI_KELIMELER = new Set([
  "insert", "update", "delete", "merge", "truncate", "drop", "alter",
  "create", "grant", "revoke", "deny", "exec", "execute", "sp_executesql",
  "backup", "restore", "shutdown", "reconfigure", "openrowset", "opendatasource",
  "openquery", "bulk", "waitfor", "kill", "dbcc", "into",
]);

/** Tehlikeli sistem proseduru onekleri. */
const YASAKLI_ONEKLER = ["xp_", "sp_oa", "sys.sp_"];

const KELIME = /[A-Za-z_][A-Za-z0-9_]*/g;
/**
 * sys.sp_who gibi nitelikli adlar. KELIME nokta icermedigi icin bunlar ayrica
 * taranmali; yoksa "sys.sp_" oneki hicbir zaman eslesmez (Python surumunde
 * bu bir olu kuraldi, testle yakalandi).
 */
const NITELIKLI_AD = /[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)+/g;

/**
 * Yorumlari, metin sabitlerini ve tirnakli tanimlayicilari zararsiz
 * doldurmaya cevirir. TEK GECISTE soldan saga -- sirali temizlik yukaridaki
 * 1 numarali bypass'i uretiyordu.
 */
function yorumVeMetinleriTemizle(sql: string): string {
  const cikti: string[] = [];
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const c = sql[i]!;

    // Metin sabiti: '...'  ('' ikilenmis tirnaktir, sabiti bitirmez)
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (j + 1 < n && sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      cikti.push(" '' ");
      i = j < n ? j + 1 : n;
      continue;
    }

    // Tirnakli tanimlayici: [x] / "x" / `x`
    if (c === "[" || c === '"' || c === "`") {
      const kapanis = c === "[" ? "]" : c;
      const j = sql.indexOf(kapanis, i + 1);
      cikti.push(" _id_ ");
      i = j !== -1 ? j + 1 : n;
      continue;
    }

    // Satir yorumu
    if (c === "-" && i + 1 < n && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      cikti.push(" ");
      i = j === -1 ? n : j;
      continue;
    }

    // Blok yorumu
    if (c === "/" && i + 1 < n && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      cikti.push(" ");
      i = j === -1 ? n : j + 2;
      continue;
    }

    cikti.push(c);
    i += 1;
  }

  return cikti.join("");
}

function ifadeSayisi(temiz: string): number {
  return temiz.split(";").map((p) => p.trim()).filter(Boolean).length;
}

function tumEslesmeler(metin: string, desen: RegExp): string[] {
  return [...metin.matchAll(desen)].map((m) => m[0]);
}

/** Ham SQL'den tirnakli tanimlayici adlarini cikarir ([Users] -> users). */
function tirnakliAdlar(sql: string): string[] {
  const adlar: string[] = [];
  // g bayragi SART: matchAll onsuz TypeError firlatir.
  for (const desen of [/\[[^\]]*\]/g, /"[^"]*"/g, /`[^`]*`/g]) {
    for (const ham of tumEslesmeler(sql, desen)) {
      adlar.push(ham.slice(1, -1).trim().toLowerCase());
    }
  }
  return adlar;
}

export interface GuardSecenekleri {
  /** Sorgulanmasi tamamen yasak tablolar (kucuk harf). */
  yasakliTablolar?: ReadonlySet<string>;
}

/** SQL'i dogrular ve normalize edilmis halini dondurur; gecersizse firlatir. */
export function sqlDogrula(hamSql: string, secenek: GuardSecenekleri = {}): string {
  if (!hamSql || !hamSql.trim()) throw new SqlGuardHatasi("Bos SQL sorgusu.");

  let sql = hamSql.trim();

  // Model bazen ```sql ... ``` bloguyla donuyor.
  if (sql.startsWith("```")) {
    sql = sql.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }

  const temiz = yorumVeMetinleriTemizle(sql);

  if (ifadeSayisi(temiz) > 1) {
    throw new SqlGuardHatasi(
      "Tek seferde yalnizca bir SELECT ifadesi calistirilabilir; noktali virgulle ayrilmis birden fazla ifade var."
    );
  }

  const ilk = temiz.match(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!ilk || !["select", "with"].includes(ilk[0].toLowerCase())) {
    throw new SqlGuardHatasi("Yalnizca SELECT (veya WITH ile baslayan CTE) sorgularina izin verilir.");
  }

  const kelimeler = new Set(tumEslesmeler(temiz, KELIME).map((k) => k.toLowerCase()));

  const yasakli = [...kelimeler].filter((k) => YASAKLI_KELIMELER.has(k)).sort();
  if (yasakli.length) {
    throw new SqlGuardHatasi(
      `Yasakli SQL ifadesi: ${yasakli.join(", ").toUpperCase()}. Bu sistem yalnizca veri okuyabilir.`
    );
  }

  const nitelikli = new Set(
    tumEslesmeler(temiz, NITELIKLI_AD).map((a) => a.replace(/\s*\.\s*/g, ".").toLowerCase())
  );

  const yasakTablolar = secenek.yasakliTablolar;
  if (yasakTablolar?.size) {
    const adaylar = new Set(kelimeler);
    for (const ad of nitelikli) adaylar.add(ad.split(".").pop()!);
    // Tirnakli tanimlayicilar temiz metinde _id_ oldugu icin HAM sql'den de bakilir.
    for (const ad of tirnakliAdlar(sql)) adaylar.add(ad);

    const dokunulan = [...adaylar].filter((a) => yasakTablolar.has(a)).sort();
    if (dokunulan.length) {
      throw new SqlGuardHatasi(`Bu tabloya erisim kapalidir: ${dokunulan.join(", ")}`);
    }
  }

  for (const ad of [...kelimeler, ...nitelikli].sort()) {
    if (YASAKLI_ONEKLER.some((o) => ad.startsWith(o))) {
      throw new SqlGuardHatasi(`Yasakli sistem proseduru: ${ad}`);
    }
  }

  return sql.replace(/;+\s*$/, "").trim();
}
