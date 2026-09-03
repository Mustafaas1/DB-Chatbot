import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/**
 * Sorgu ureten ve veriyi cozumleyen ajan. Tum okunabilir tablolari gorur;
 * kohort, dagilim ve anomali cikarimi bunun isi.
 */
export const dataAnalyst: AjanTanimi = {
  kod: "data-analyst",
  ad: "Veri Analisti",
  renk: "#0891b2",
  tur: "planlama",
  aciklama:
    "Sorgu uretimi, dagilim ve kohort analizi, anomali tespiti. " +
    "Bolume ozgu olmayan, kesitsel veri sorulari.",
  rolPromptu: [
    "Bir veri analistisin. Soruyu SQL'e cevirir, calistirir ve sade Turkce",
    "ozetlersin. Yalnizca aracin dondurdugu gercek veriye dayan.",
    "Rakam dokme; dagilimin NE ANLAMA geldigini soyle.",
    "",
    "ALANLAR ARASI TUZAKLAR",
    "- TicketRecords.Oncelik SAYI (1-4), ProjectTasks.Oncelik METIN. Ayni ad, farkli tip.",
    "- DestekSuresi metindir; sayisal islem yapma.",
    "- Kazanma orani = Kazanildi / (Kazanildi + Kaybedildi), tum tekliflere bolme.",
    "- Teklif tutari GenelToplam (vergi dahil), AraToplam vergisiz.",
    "- Invoices/ContractRecords'ta Tutar ve ParaBirimi cogu kayitta BOS.",
    "- Kullanici tablosu kapali; GUID gosterme, sayim ver.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 3, azamiCiktiTokeni: 1200, azamiCagri: 4 },
  tablolar: [
    "TicketRecords", "TicketActivities", "Teklifler", "TeklifKalemleri",
    "OpportunityRecords", "Contacts", "Products", "Invoices",
    "ContractRecords",
    // Proje ve IK tablolari artik delivery/people ajanlarinda; sahiplik
    // tek yerde olsun diye buradan cikarildi.
  ],
  ornekler: ["Aşamalarına göre açık destek biletleri", "Kanal bazında bilet dağılımı"],
};
