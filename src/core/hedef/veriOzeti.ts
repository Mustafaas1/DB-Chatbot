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
 *
 * DURUM DEGERLERI DE SART. `degerler` parametresi vardi ama govdede HIC
 * KULLANILMIYORDU: agac kolon adlarini goruyor, iclerindeki degerleri
 * gormuyordu. Olculdu -- 8 olcumun 6'si bos donuyordu ve boslarin
 * basliklari "Aktif musterilerin toplam harcamasi" gibiydi. "Aktif"
 * gercekten var ama SOZLESMELERDE (ContractRecords.Asama), musteride
 * degil; agac bunu goremedigi icin uyduruyordu.
 *
 * Maliyet ~213 token; bosa giden tek bir olcum ~3.000 token.
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

  // Durum/tip kolonlarinin GERCEK degerleri. Ajan istemi bunu zaten
  // aliyordu; agac almadigi icin var olmayan durumlar uyduruyordu.
  const dv = degerlerMetni(degerler);
  if (dv) {
    satirlar.push(
      "",
      "DURUM KOLONLARININ GERCEK DEGERLERI (baskasini UYDURMA):",
      dv
    );
  }

  return satirlar.join("\n");
}
