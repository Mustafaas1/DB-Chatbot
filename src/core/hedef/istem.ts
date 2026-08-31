import type { DugumTuru, HedefDugumu } from "./tipler";

/**
 * Genisletme istemi.
 *
 * Bu modelde uzun JSON yarida kesiliyor, duzyazi kural da tutmuyor.
 * Bu yuzden: (1) tek seferde YALNIZCA bir dugumun cocuklari isteniyor,
 * (2) kural yerine ORNEK veriliyor, (3) cikti kucuk ve sabit sekilli.
 */

/** Bir sonraki katmanin turu. Aksiyondan sonra dallanma biter. */
export function sonrakiTur(tur: DugumTuru): DugumTuru | null {
  switch (tur) {
    case "hedef": return "surucu";
    case "surucu": return "olcum";
    case "olcum": return "aksiyon";
    case "aksiyon": return null;
  }
}

const TUR_ACIKLAMA: Record<DugumTuru, string> = {
  hedef: "kullanicinin asil amaci",
  surucu: "hedefi belirleyen bilesen (nedensel ya da matematiksel)",
  olcum: "VERITABANINDAN OLCULEBILIR somut soru",
  aksiyon: "bulguya dayanan somut, uygulanabilir aksiyon",
};

export function genisletmeIstemi(hedefTur: DugumTuru, veriOzetiMetni?: string): string {
  // "olcum" katmani VERIYE BAGLANMALI. Tablo listesi verilmedigi ilk
  // denemede model "SSS sayfasi ziyaretci sayisi", "chatbot yanit suresi"
  // gibi bu veritabaninda KARSILIGI OLMAYAN olcumler uretti; sonraki
  // adimlar bos donerdi.
  // Yalnizca tablo ADI vermek yetmedi: model dogru tabloyu secip icindeki
  // kolonlari uyduruyordu. Kolon adlari da veriliyor.
  const veriKisiti =
    veriOzetiMetni && (hedefTur === "olcum" || hedefTur === "surucu")
      ? [
          "",
          "ELDEKI VERI (yalnizca bunlar var; tablo: kolonlar):",
          veriOzetiMetni,
          "",
          "- Onerilerin YUKARIDAKI veriyle olculebilir olmali.",
          "- Karsiligi olmayan sey ONERME: web trafigi, chatbot, anket,",
          "  self-servis portal, egitim katilimi gibi verilerimiz YOK.",
          "- Kolon adi UYDURMA; yukarida yazmayan kolona atif yapma.",
        ]
      : [];

  return [
    "Bir is zekasi analistisin. Sana bir hedef agacinin TEK dugumu verilir;",
    "gorevin o dugumun altina " + TUR_ACIKLAMA[hedefTur] + " olan cocuklari yazmak.",
    "",
    "KURALLAR",
    "- 2 ile 4 arasi cocuk yaz. Az ve isabetli olsun; doldurma yapma.",
    "- Her cocuk ust dugumden MANTIKEN turemeli; 'gerekce' bu bagi tek",
    "  cumleyle kurmali.",
    "- Cocuklar birbirinden FARKLI olmali; ayni seyi iki kez yazma.",
    hedefTur === "olcum"
      ? "- Her cocuk icin 'olcumSorusu' yaz: veritabanina sorulabilecek, tek ve net bir soru."
      : "- 'olcumSorusu' alanini bos birak.",
    "",
    ...veriKisiti,
    "",
    "YALNIZCA JSON dizi dondur, baska hicbir sey yazma:",
    '[{"baslik":"...","gerekce":"...","olcumSorusu":"..."}]',
  ].join("\n");
}

/** Ornekler kurallardan baskin; her tur icin bir tane. */
export function ornekler(hedefTur: DugumTuru): { girdi: string; cikti: string }[] {
  if (hedefTur === "surucu") {
    return [{
      girdi: "DUGUM (hedef): Destek yukumuzu azaltmak",
      cikti: JSON.stringify([
        { baslik: "Gelen bilet sayisini dusurmek", gerekce: "Yuk once hacimden gelir; hic acilmayan bilet en ucuzudur.", olcumSorusu: "" },
        { baslik: "Bilet cozum suresini kisaltmak", gerekce: "Ayni hacim daha hizli kapanirsa birikme olusmaz.", olcumSorusu: "" },
        { baslik: "Yuku ekibe dengeli dagitmak", gerekce: "Toplam makul olsa bile birkac kiside yigilma darbogaz yaratir.", olcumSorusu: "" },
      ]),
    }];
  }

  if (hedefTur === "olcum") {
    return [{
      girdi: "DUGUM (surucu): Gelen bilet sayisini dusurmek",
      cikti: JSON.stringify([
        { baslik: "Biletlerin konu dagilimi", gerekce: "Hacmi hangi konularin urettigini bilmeden azaltilamaz.", olcumSorusu: "Destek biletlerini kategorilerine gore say" },
        { baslik: "Acik biletlerin asama dagilimi", gerekce: "Biletlerin nerede takildigini gosterir.", olcumSorusu: "Asamalarina gore acik destek biletleri" },
      ]),
    }];
  }

  return [{
    girdi: "DUGUM (olcum): Acik biletlerin asama dagilimi\nBULGU: 59 acik biletin 47'si Beklemede.",
    cikti: JSON.stringify([
      { baslik: "Beklemede takilan biletlere sahip atamak", gerekce: "Biletlerin %80'i beklemede; sahipsizlik en olasi sebep.", olcumSorusu: "" },
      { baslik: "Bekleme suresi icin esik ve uyari kurmak", gerekce: "Esik asildiginda uyari, birikmeyi erken yakalar.", olcumSorusu: "" },
    ]),
  }];
}

/** Genisletilecek dugumu ve gerekiyorsa bulgusunu anlatir. */
export function dugumMetni(dugum: HedefDugumu, asilSoru: string): string {
  const parcalar = [
    "ASIL SORU: " + asilSoru,
    `DUGUM (${dugum.tur}): ${dugum.baslik}`,
  ];
  if (dugum.gerekce) parcalar.push("BU DUGUMUN GEREKCESI: " + dugum.gerekce);
  if (dugum.bulgu?.ozet) parcalar.push("BULGU: " + dugum.bulgu.ozet);
  return parcalar.join("\n");
}
