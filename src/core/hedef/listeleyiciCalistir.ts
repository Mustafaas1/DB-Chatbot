import type { Tablo } from "../db/sema";
import { veriSorgulaAraci } from "../db/aracSorgu";
import type { OlcumSonucu } from "../ajan/olcum";
import { dataAnalyst } from "../../agents/data-analyst";

/**
 * Listeleyici olcumun SQL'ini KOD uretir ve dogrudan calistirir.
 *
 * Ajana yazdirmak degiskendi: ayni olcum bir kosuda 20 satir donduruyor,
 * digerinde 0. Bu olcumun isi bir KPI cevaplamak degil -- aksiyonun
 * baglanacagi somut kimlikleri uretmek. Cevabi sabit oldugu icin
 * modelden gecmesinin bir faydasi yok, zarari var.
 *
 * Yan kazanc: token harcamiyor ve arac cagrisi sinirina takilmiyor.
 *
 * Sorgu yine sqlDogrula'dan geciyor (veriSorgulaAraci uzerinden):
 * kod urettigi icin guvenli varsaymiyoruz, ayni kapidan geciriyoruz.
 */

/** Sirali listeleme icin tarih kolonu; yoksa siralama yapilmaz. */
const TARIH_ONCELIGI = [
  /^CreatedAt$/i, /^OlusturmaTarihi$/i, /^KayitTarihi$/i,
  /Tarihi$/i, /^UpdatedAt$/i, /Date$/i,
];

function dateColumn(tablo: Tablo): string | null {
  for (const desen of TARIH_ONCELIGI) {
    const k = tablo.kolonlar.find((c) => desen.test(c.ad) && /date|time/i.test(c.tip));
    if (k) return k.ad;
  }
  return null;
}

/** Kolon adini koseli parantezle kacisla; ] iki kez yazilir. */
function quote(ad: string): string {
  return `[${ad.replace(/]/g, "]]")}]`;
}

export interface ListingQuery {
  sql: string;
  kolonlar: string[];
}

/**
 * Somut kayit listeleyen SELECT'i uretir.
 *
 * Kolon adlari SEMADAN geliyor, disaridan gelen metinden degil; yine de
 * koseli parantezle kaciliyorlar.
 */
export function buildListingQuery(
  tablo: Tablo,
  kimlik: string,
  etiket: string | null,
  azami = 20
): ListingQuery {
  const secilenler = [kimlik, ...(etiket ? [etiket] : [])];
  const tarih = dateColumn(tablo);
  const silinmisVar = tablo.kolonlar.some((c) => /^IsDeleted$/i.test(c.ad));

  const sql = [
    `SELECT TOP (${azami}) ${secilenler.map(quote).join(", ")}`,
    `FROM dbo.${quote(tablo.ad)}`,
    // Silinmis kayda aksiyon onerilmemeli.
    silinmisVar ? "WHERE IsDeleted = 0" : "",
    // Kimligi bos olan satir aksiyona baglanamaz.
    `${silinmisVar ? "AND" : "WHERE"} ${quote(kimlik)} IS NOT NULL`,
    tarih ? `ORDER BY ${quote(tarih)} DESC` : "",
  ].filter(Boolean).join(" ");

  return { sql, kolonlar: secilenler };
}

/**
 * Sorguyu calistirip OlcumSonucu bicimine cevirir.
 *
 * Boru hattinin geri kalani (teshis, plan, somut kayit) bu bicimi
 * bekliyor; ayri bir yol acmak iki kod yolu demek olurdu.
 */
export async function runListingMeasurement(
  dugumId: string,
  baslik: string,
  tablo: Tablo,
  kimlik: string,
  etiket: string | null
): Promise<OlcumSonucu> {
  const { sql } = buildListingQuery(tablo, kimlik, etiket);
  const t0 = Date.now();

  const sonuc = await veriSorgulaAraci.calistir(
    { sorgu: sql },
    { izId: dugumId, provaMi: false }
  );

  return {
    dugumId,
    // Kesisen analist: yazma islemi olan tablolarin hepsini goruyor.
    ajanKod: dataAnalyst.kod,
    ajanAd: dataAnalyst.ad,
    renk: dataAnalyst.renk,
    baslik,
    soru: `${tablo.ad} tablosundan güncel kayıtlar`,
    cevap: `${sonuc.satirSayisi} kayıt listelendi.`,
    sql: sonuc.calisanSql,
    kolonlar: sonuc.kolonlar,
    satirlar: sonuc.satirlar,
    satirSayisi: sonuc.satirSayisi,
    bosMu: sonuc.satirSayisi === 0,
    belirsiz: false,
    sureMs: Date.now() - t0,
    // Model cagrilmadi: token harcanmadi.
    kullanim: { girdiTokeni: 0, ciktiTokeni: 0 },
  };
}
