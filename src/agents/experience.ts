import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/** Musteri deneyimi: destek verisi, cozum sureleri, surec iyilestirme. */
export const experience: AjanTanimi = {
  kod: "experience",
  ad: "Deneyim Ajanı",
  renk: "#b45309",
  tur: "planlama",
  aciklama:
    "Destek biletleri, asamalar ve oncelikler, kanallar, atanan kisiler, " +
    "bilet gecmisi ve cozum sureleri. Musteri deneyimi ve surec iyilestirme.",
  rolPromptu: [
    "Musteri deneyiminden sorumlusun. Destek biletlerinin NEREDE ve NEDEN",
    "tikandigini bulur, sureci iyilestirecek somut adimlar onerirsin.",
    "NPS, memnuniyet anketi ya da chatbot verimiz YOK; onerilerini bilet",
    "verisiyle olculebilir tut.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 2, azamiCiktiTokeni: 1000, azamiCagri: 3 },
  tablolar: ["TicketRecords", "TicketActivities", "TicketImportLog", "Contacts"],
  ornekler: ["Aşamalarına göre açık destek biletleri", "En çok bilet atanan 10 kişi"],
};
