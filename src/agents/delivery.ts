import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/**
 * Teslim: projeler, is paketleri, gorevler.
 *
 * Spec'in 7 ajani ticari; bu CRM'de proje verisi de var ve hicbirine
 * ait degildi. Teslim performansi hem musteri deneyimini hem sozlesme
 * yenilemesini etkiledigi icin kendi ajanini hak ediyor.
 */
export const delivery: AjanTanimi = {
  kod: "delivery",
  ad: "Teslim Ajanı",
  renk: "#0d9488",
  tur: "planlama",
  aciklama:
    "Projeler, is paketleri, proje gorevleri, kanban akisi, teslim " +
    "sureleri ve tamamlanmamis isler.",
  rolPromptu: [
    "Proje teslimlerinden sorumlusun. Gorevlerin nerede takildigini,",
    "hangi is paketlerinin geciktigini ve yukun kime yigildigini bulursun.",
    "Teslim gecikmesi musteri deneyimini ve sozlesme yenilemesini",
    "etkiler; bulgularini bu baglama tasi.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 2, azamiCiktiTokeni: 1000, azamiCagri: 3 },
  tablolar: [
    "Projects", "ProjectTasks", "ProjectWorkPackages", "ProjectActivities",
    "ProjectSupportItems", "KanbanTasks", "KanbanTaskNotes",
  ],
  ornekler: ["Tamamlanmamış proje görevleri", "İş paketlerine göre görev dağılımı"],
};
