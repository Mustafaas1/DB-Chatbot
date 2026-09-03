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
  goal: "kullanıcının asıl amacı",
  lever: "hedefi hareket ettiren kaldıraç (nedensel ya da matematiksel)",
  metric: "VERİTABANINDAN ÖLÇÜLEBİLİR somut soru",
  action: "bulguya dayanan somut, uygulanabilir aksiyon",
  resource: "kaldıracı kullanmak için gereken kaynak ya da kısıt",
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
    "- DIL: 'baslik', 'gerekce' ve 'olcumSorusu' alanlarini DUZGUN",
    "  TURKCE yaz ve Turkce karakterleri kullan (ç ğ ı ö ş ü). Bu",
    "  metinler kullaniciya oldugu gibi gosteriliyor.",
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
      girdi: "DUGUM (goal): Destek yükümüzü azaltmak",
      cikti: JSON.stringify([
        { baslik: "Gelen bilet sayısını düşürmek", gerekce: "Yük önce hacimden gelir; hiç açılmayan bilet en ucuzudur.", olcumSorusu: "" },
        { baslik: "Bilet çözüm süresini kısaltmak", gerekce: "Aynı hacim daha hızlı kapanırsa birikme oluşmaz.", olcumSorusu: "" },
        { baslik: "Yükü ekibe dengeli dağıtmak", gerekce: "Toplam makul olsa bile birkaç kişide yığılma darboğaz yaratır.", olcumSorusu: "" },
      ]),
    }];
  }

  if (hedefTur === "metric") {
    return [{
      girdi: "DUGUM (lever): Gelen bilet sayısını düşürmek",
      cikti: JSON.stringify([
        { baslik: "Biletlerin konu dağılımı", gerekce: "Hacmi hangi konuların ürettiğini bilmeden azaltılamaz.", olcumSorusu: "Destek biletlerini kategorilerine göre say" },
        { baslik: "Açık biletlerin aşama dağılımı", gerekce: "Biletlerin nerede takıldığını gösterir.", olcumSorusu: "Aşamalarına göre açık destek biletleri" },
      ]),
    }];
  }

  return [{
    girdi: "DUGUM (metric): Açık biletlerin aşama dağılımı\nBULGU: 59 açık biletin 47'si Beklemede.",
    cikti: JSON.stringify([
      { baslik: "Beklemede takılan biletlere sahip atamak", gerekce: "Biletlerin %80'i beklemede; sahipsizlik en olası sebep.", olcumSorusu: "" },
      { baslik: "Bekleme süresi için eşik ve uyarı kurmak", gerekce: "Eşik aşıldığında uyarı, birikmeyi erken yakalar.", olcumSorusu: "" },
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
