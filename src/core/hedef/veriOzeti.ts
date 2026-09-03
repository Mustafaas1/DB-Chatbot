import type { Tablo } from "../db/sema";
import type { KolonDegerleri } from "../db/degerler";
import { degerlerMetni } from "../db/degerler";

/**
 * Agac kurucuya verilen KOMPAKT veri ozeti.
 *
 * Yalnizca tablo ADLARI vermek yetmedi: model dogru tabloyu secip
 * icindeki kolonlari uyduruyordu ('Status'='Closed', 'ClosedBy'='Bot').
 * Kolon adlarini da gorunce olcumler gercek veriye oturuyor.
 *
 * Tam sema (~5.000 token) burada gereksiz; agac kurmak icin kolon TIPLERI
 * gerekmiyor, yalnizca neyin kaydedildigini bilmek yetiyor.
 */
export function dataOverview(
  tablolar: Tablo[],
  degerler: KolonDegerleri[] = [],
  azamiTablo = 18
): string {
  const onemli = [...tablolar]
    .filter((t) => t.satirSayisi > 0)
    .sort((a, b) => b.satirSayisi - a.satirSayisi)
    .slice(0, azamiTablo);

  const satirlar = onemli.map((t) => {
    // Gurultuyu at: Id/tarih/bayrak kolonlari olcum tasarlarken bilgi vermiyor.
    const anlamli = t.kolonlar
      .map((k) => k.ad)
      .filter((ad) => !/^(Id|.*Id|CreatedAt|UpdatedAt|IsDeleted|IsArchived|.*Sira)$/i.test(ad))
      .slice(0, 8);
    return `${t.ad} (${t.satirSayisi} kayit): ${anlamli.join(", ")}`;
  });

  const kalan = tablolar.length - onemli.length;
  if (kalan > 0) satirlar.push(`... ve ${kalan} tablo daha (cogu bos ya da yardimci)`);
  return satirlar.join("\n");
}
