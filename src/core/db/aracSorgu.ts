import { z } from "zod";
import type { AracTanimi } from "../tools/tipler.js";
import { dbAyari } from "./ayar.js";
import { havuzGetir } from "./havuz.js";
import { sqlDogrula } from "./guard.js";

/**
 * Yasakli tablolar. Veritabaninda zaten DENY var; burasi ONDEKI kapi,
 * amaci sorgu hic gonderilmeden anlamli hata vermek.
 */
function yasakliTablolar(): ReadonlySet<string> {
  const ham = process.env.SCHEMA_EXCLUDE_TABLES ?? "";
  return new Set(ham.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
}

export const SorguGirdisi = z.object({
  sorgu: z.string().min(1).describe("Calistirilacak T-SQL SELECT sorgusu."),
  azamiSatir: z.number().int().positive().max(5000).optional()
    .describe("Donecek azami satir sayisi (varsayilan MAX_ROWS)."),
});
export type SorguGirdisi = z.infer<typeof SorguGirdisi>;

export interface SorguSonucu {
  kolonlar: string[];
  satirlar: unknown[][];
  satirSayisi: number;
  kirpildi: boolean;
  sureMs: number;
  calisanSql: string;
}

/**
 * Salt-okunur SQL calistiran arac.
 *
 * Uc katman: (1) sqlDogrula, (2) veritabani izinleri (ajan_okur),
 * (3) satir/sure siniri. Ilki asilsa bile ikincisi durdurur.
 */
export const veriSorgulaAraci: AracTanimi<SorguGirdisi, SorguSonucu> = {
  ad: "veri_sorgula",
  aciklama:
    "CRM veritabaninda salt-okunur bir T-SQL SELECT calistirir. " +
    "Yalnizca SELECT ve WITH kabul edilir; yazma ifadeleri reddedilir.",
  kaynak: "yerel",
  yanEtki: "okuma",
  girdiSemasi: SorguGirdisi,

  async calistir(girdi, baglam): Promise<SorguSonucu> {
    const guvenli = sqlDogrula(girdi.sorgu, { yasakliTablolar: yasakliTablolar() });
    const sinir = girdi.azamiSatir ?? dbAyari.azamiSatir;

    if (baglam.provaMi) {
      return {
        kolonlar: [], satirlar: [], satirSayisi: 0, kirpildi: false,
        sureMs: 0, calisanSql: guvenli,
      };
    }

    const t0 = Date.now();
    const havuz = await havuzGetir();
    const istek = havuz.request();
    istek.arrayRowMode = true;
    const yanit = await istek.query(guvenli);

    // mssql'de columns bir DIZI degil, kolon adina gore anahtarlanmis nesnedir;
    // sirayi korumak icin index alanina gore siralanir.
    const ust = yanit.recordset?.columns ?? {};
    const kolonlar = Object.values(ust)
      .sort((a, b) => a.index - b.index)
      .map((k) => k.name);
    const tumu = (yanit.recordset as unknown as unknown[][]) ?? [];
    const kirpildi = tumu.length > sinir;

    return {
      kolonlar,
      satirlar: kirpildi ? tumu.slice(0, sinir) : tumu,
      satirSayisi: kirpildi ? sinir : tumu.length,
      kirpildi,
      sureMs: Date.now() - t0,
      calisanSql: guvenli,
    };
  },
};
