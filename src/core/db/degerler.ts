import { havuzGetir } from "./havuz";
import type { Tablo } from "./sema";

/**
 * Dusuk kardinaliteli durum kolonlarinin GERCEK degerleri.
 *
 * Neden: modele kolon ADI vermek yetmiyor. "Asama" kolonunu gorup
 * degerlerini uyduruyordu ("Asama-1 (Yeni)", "Durum='Acik'"). Gercek
 * degerleri (Beklemede / Islemde / Tamamlandi) gorunce hem hedef agaci
 * hem SQL dogru oturuyor.
 *
 * Yalnizca durum/tip benzeri kolonlar taranir ve en fazla ESIK farkli
 * deger varsa yazilir; isim/aciklama gibi serbest metin kolonlari
 * anlamsiz oldugu icin disarida kalir.
 */

const ADAY_KOLON = /^(asama|durum|statu|tip|kanal|kategori|seviye|rol)$/i;
const ESIK = 12;
const AZAMI_TABLO = 22;   // veriOzeti'ndeki tablolari kapsayacak kadar genis

export interface KolonDegerleri {
  tablo: string;
  kolon: string;
  degerler: string[];
}

let onbellek: { veri: KolonDegerleri[]; zaman: number } | null = null;
const TTL_MS = Number(process.env.SCHEMA_TTL ?? 900) * 1000;

export async function durumDegerleri(tablolar: Tablo[], zorla = false): Promise<KolonDegerleri[]> {
  if (!zorla && onbellek && Date.now() - onbellek.zaman < TTL_MS) return onbellek.veri;

  const havuz = await havuzGetir();
  const sonuc: KolonDegerleri[] = [];

  const secili = [...tablolar]
    .filter((t) => t.satirSayisi > 0)
    .sort((a, b) => b.satirSayisi - a.satirSayisi)
    .slice(0, AZAMI_TABLO);

  for (const t of secili) {
    for (const k of t.kolonlar) {
      if (!ADAY_KOLON.test(k.ad)) continue;
      if (!/char/i.test(k.tip)) continue;

      try {
        // Tanimlayici [] ile sarilir; adlar semadan geldigi icin guvenli,
        // yine de kapali koseli parantez kacirilir.
        const tam = `[${t.sema}].[${t.ad.replace(/]/g, "]]")}]`;
        const kolon = `[${k.ad.replace(/]/g, "]]")}]`;
        const y = await havuz.request().query(
          `SELECT TOP ${ESIK + 1} ${kolon} AS deger FROM ${tam} ` +
          `WHERE ${kolon} IS NOT NULL GROUP BY ${kolon} ORDER BY COUNT(*) DESC`
        );
        const degerler = (y.recordset as { deger: unknown }[]).map((r) => String(r.deger));
        if (degerler.length && degerler.length <= ESIK) {
          sonuc.push({ tablo: t.ad, kolon: k.ad, degerler });
        }
      } catch {
        // Tek kolonun okunamamasi ozeti bozmasin (izin, tip vb.).
      }
    }
  }

  onbellek = { veri: sonuc, zaman: Date.now() };
  return sonuc;
}

export function degerlerMetni(degerler: KolonDegerleri[]): string {
  if (!degerler.length) return "";
  return degerler
    .map((d) => `${d.tablo}.${d.kolon} = ${d.degerler.map((v) => `'${v}'`).join(", ")}`)
    .join("\n");
}
