import type { DugumTuru } from "../../schemas/index";
import type { GoalNodeGenis } from "./tipler";

/**
 * Genisletme istemi.
 *
 * Bu modelde uzun JSON yarida kesiliyor, duzyazi kural da tutmuyor.
 * Bu yuzden: (1) tek seferde YALNIZCA bir dugumun cocuklari isteniyor,
 * (2) kural yerine ORNEK veriliyor, (3) cikti kucuk ve sabit sekilli.
 */

/** Bir sonraki katmanin turu. Aksiyondan sonra dallanma biter. */
export function nextKind(tur: DugumTuru): DugumTuru | null {
  switch (tur) {
    case "goal": return "lever";       // hedefi hareket ettiren kaldiraclar
    case "lever": return "metric";     // kaldiracin olculebilir gostergeleri
    case "metric": return "action";    // olcume dayanan somut aksiyon
    case "action": return null;
    // "resource" agac kurucusu tarafindan uretilmiyor; kaldiraci
    // kullanmak icin gereken kisiti isaretlemek uzere sema duzeyinde
    // tanimli ve elle eklenebiliyor.
    case "resource": return null;
  }
}

const TUR_ACIKLAMA: Record<DugumTuru, string> = {
  goal: "kullanicinin asil amaci",
  lever: "hedefi hareket ettiren kaldirac (nedensel ya da matematiksel)",
  metric: "VERITABANINDAN OLCULEBILIR somut soru",
  action: "bulguya dayanan somut, uygulanabilir aksiyon",
  resource: "kaldiraci kullanmak icin gereken kaynak ya da kisit",
};

export function expansionPrompt(hedefTur: DugumTuru, veriOzetiMetni?: string): string {
  // "olcum" katmani VERIYE BAGLANMALI. Tablo listesi verilmedigi ilk
  // denemede model "SSS sayfasi ziyaretci sayisi", "chatbot yanit suresi"
  // gibi bu veritabaninda KARSILIGI OLMAYAN olcumler uretti; sonraki
  // adimlar bos donerdi.
  // Yalnizca tablo ADI vermek yetmedi: model dogru tabloyu secip icindeki
  // kolonlari uyduruyordu. Kolon adlari da veriliyor.
  const veriKisiti =
    veriOzetiMetni && (hedefTur === "metric" || hedefTur === "lever")
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
    hedefTur === "metric"
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
export function examples(hedefTur: DugumTuru): { girdi: string; cikti: string }[] {
  if (hedefTur === "lever") {
    return [{
      girdi: "DUGUM (goal): Destek yukumuzu azaltmak",
      cikti: JSON.stringify([
        { baslik: "Gelen bilet sayisini dusurmek", gerekce: "Yuk once hacimden gelir; hic acilmayan bilet en ucuzudur.", olcumSorusu: "" },
        { baslik: "Bilet cozum suresini kisaltmak", gerekce: "Ayni hacim daha hizli kapanirsa birikme olusmaz.", olcumSorusu: "" },
        { baslik: "Yuku ekibe dengeli dagitmak", gerekce: "Toplam makul olsa bile birkac kiside yigilma darbogaz yaratir.", olcumSorusu: "" },
      ]),
    }];
  }

  if (hedefTur === "metric") {
    return [{
      girdi: "DUGUM (lever): Gelen bilet sayisini dusurmek",
      cikti: JSON.stringify([
        { baslik: "Biletlerin konu dagilimi", gerekce: "Hacmi hangi konularin urettigini bilmeden azaltilamaz.", olcumSorusu: "Destek biletlerini kategorilerine gore say" },
        { baslik: "Acik biletlerin asama dagilimi", gerekce: "Biletlerin nerede takildigini gosterir.", olcumSorusu: "Asamalarina gore acik destek biletleri" },
      ]),
    }];
  }

  return [{
    girdi: "DUGUM (metric): Acik biletlerin asama dagilimi\nBULGU: 59 acik biletin 47'si Beklemede.",
    cikti: JSON.stringify([
      { baslik: "Beklemede takilan biletlere sahip atamak", gerekce: "Biletlerin %80'i beklemede; sahipsizlik en olasi sebep.", olcumSorusu: "" },
      { baslik: "Bekleme suresi icin esik ve uyari kurmak", gerekce: "Esik asildiginda uyari, birikmeyi erken yakalar.", olcumSorusu: "" },
    ]),
  }];
}

/** Genisletilecek dugumu ve gerekiyorsa bulgusunu anlatir. */
export function nodeText(dugum: GoalNodeGenis, asilSoru: string): string {
  const parcalar = [
    "ASIL SORU: " + asilSoru,
    `DUGUM (${dugum.type}): ${dugum.statement}`,
  ];
  if (dugum.rationale) parcalar.push("BU DUGUMUN GEREKCESI: " + dugum.rationale);
  // Olculduyse deger de veriliyor: aksiyon katmani bulguya dayanmali.
  if (dugum.currentValue != null) parcalar.push("OLCULEN DEGER: " + dugum.currentValue);
  return parcalar.join("\n");
}
