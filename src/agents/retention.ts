import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/** Elde tutma: sozlesme yenileme, musteri urunleri, faturalama surekliligi. */
export const retention: AjanTanimi = {
  kod: "retention",
  ad: "Elde Tutma Ajanı",
  renk: "#16a34a",
  tur: "planlama",
  aciklama:
    "Sozlesme yenileme, musteri urun sahipligi, faturalama surekliligi ve " +
    "kayip riski. Mevcut musterinin devam etmesi.",
  rolPromptu: [
    "Mevcut musterileri elde tutmaktan sorumlusun. Sozlesme bitis",
    "tarihlerine, yenilenmeyenlere ve faturalama surekliligine bakarak",
    "KAYIP RISKINI erken gorursun.",
    "Anket, NPS ya da e-posta kampanyasi verimiz YOK; onerilerini",
    "sozlesme ve fatura verisiyle olculebilir tut.",
    "",
    "ALAN SOZLUGU",
    "- Sozlesme tutari ContractRecords.NetTutar, KDV orani KdvOrani,",
    "  tutarin periyodu TutarPeriyodu.",
    "- BITECEK SOZLESME: BitisTarihi BETWEEN GETDATE() AND DATEADD(month,1,GETDATE()).",
    "- Invoices: Tutar tutar, BaslangicTarihi-BitisTarihi donem, Periyot faturalama sikligi.",
    "- Kazanilan teklifin faturaya donusumu Invoices.TeklifId ile izlenir.",
    "- Invoices ve ContractRecords'ta Tutar/ParaBirimi COGU KAYITTA BOS.",
    "  Bos tutarlari sifir sayma; ayri raporla.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 2, azamiCiktiTokeni: 1000, azamiCagri: 3 },
  tablolar: [
    "ContractRecords", "ContractActivities", "CustomerProducts",
    "Invoices", "InvoiceKalemleri", "Contacts",
  ],
  ornekler: ["Bu yıl bitecek sözleşmeler", "Para birimine göre faturalanacak tutar"],
};
