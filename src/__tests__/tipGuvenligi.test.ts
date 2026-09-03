import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `any` YASAK (çalışma kuralı 4).
 *
 * Proje ESLint kullanmiyor; bagimlilik eklemek yerine kurali testle
 * zorluyoruz. Bir kural derleyici ya da test tarafindan zorlanmiyorsa
 * er ya da gec bozulur -- bu projede duzyazi kurallarin tutmadigi
 * defalarca goruldu.
 */

const KOK = join(process.cwd(), "src");

/** Bu dosyanin kendisi haric: desen metni burada gecmek zorunda. */
const MUAF = new Set(["__tests__/tipGuvenligi.test.ts"]);

function tsDosyalari(dizin: string): string[] {
  const sonuc: string[] = [];
  for (const g of readdirSync(dizin, { withFileTypes: true })) {
    const yol = join(dizin, g.name);
    if (g.isDirectory()) sonuc.push(...tsDosyalari(yol));
    else if (/\.tsx?$/.test(g.name)) sonuc.push(yol);
  }
  return sonuc;
}

/** Yorum satirlarini atar: yorumda "any" gecmesi ihlal degil. */
function koduAyikla(icerik: string): string {
  return icerik
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((s) => !s.trim().startsWith("//"))
    .join("\n");
}

// Tip konumundaki `any`: ": any", "as any", "<any>", "any[]".
const ANY_DESENI = new RegExp(
  [":\\s*any\\b", "\\bas\\s+any\\b", "<\\s*any\\s*>", "\\bany\\s*\\[\\]"].join("|")
);

describe("tip guvenligi", () => {
  it("hicbir kaynak dosyada `any` yok", () => {
    const ihlaller: string[] = [];

    for (const yol of tsDosyalari(KOK)) {
      const goreli = relative(KOK, yol).replace(/\\/g, "/");
      if (MUAF.has(goreli)) continue;

      const kod = koduAyikla(readFileSync(yol, "utf8"));
      kod.split("\n").forEach((satir, i) => {
        if (ANY_DESENI.test(satir)) ihlaller.push(`${goreli}:${i + 1}  ${satir.trim()}`);
      });
    }

    expect(ihlaller, `\n${ihlaller.join("\n")}\n`).toEqual([]);
  });

  it("desen gercekten yakaliyor", () => {
    // Bekci testinin kendisi calisiyor mu: bos bir regex her seyi gecirirdi.
    for (const kotu of ["const x: any = 1;", "y as any", "Promise<any>", "let z: any[] = []"]) {
      expect(ANY_DESENI.test(kotu), kotu).toBe(true);
    }
    for (const iyi of ["const x: unknown = 1;", "company: string", "many: number"]) {
      expect(ANY_DESENI.test(iyi), iyi).toBe(false);
    }
  });
});
