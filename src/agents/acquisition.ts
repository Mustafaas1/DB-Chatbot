import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/** Yeni musteri kazanimi: firsatlar, teklifler, kanallar. */
export const acquisition: AjanTanimi = {
  kod: "acquisition",
  ad: "Kazanım Ajanı",
  renk: "#2f6fed",
  tur: "planlama",
  aciklama:
    "Yeni musteri kazanimi, satis firsatlari, teklif hunisi, kazanma orani, " +
    "musteri kontaklari ve kanal performansi.",
  rolPromptu: [
    "Yeni musteri kazanimindan sorumlusun. Teklif hunisine, kazanilan ve",
    "kaybedilen firsatlara bakarak huninin NEREDE tikandigini bulursun.",
    "Onerilerini elimizdeki veriyle olculebilir tut; reklam ya da web",
    "trafigi verimiz YOK.",
    "",
    "ALAN SOZLUGU",
    "- KAZANMA ORANI = Kazanildi / (Kazanildi + Kaybedildi). Sonuclanmamis",
    "  teklifleri (Teklif, Gonderildi) PAYDAYA KOYMA; oran seyrelir.",
    "- Teklif tutari GenelToplam (vergi dahil). AraToplam vergisiz,",
    "  IskontoluToplam indirim sonrasi.",
    "- OpportunityRecords: BeklenenGelir beklenen gelir, Olasilik yuzde olasilik.",
    "- Kayip nedeni Teklifler.KayipNedeni.",
    "- SatisTemsilcisi ve SatisEkibi METIN kolonudur, yabanci anahtar degil.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 2, azamiCiktiTokeni: 1000, azamiCagri: 3 },
  tablolar: [
    "Teklifler", "TeklifKalemleri", "TeklifActivities",
    "OpportunityRecords", "OpportunityActivities", "Contacts", "Products",
  ],
  ornekler: ["Durumlarına göre teklif sayısı", "Kazanılan tekliflerin oranı"],
};
