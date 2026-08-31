/**
 * Bolum ajanlari.
 *
 * Python surumunden (pybot/ajanlar.py) port edildi. Hepsi ayni
 * veritabanini gorur; farkli olan TABLO KAPSAMI ve kimliktir.
 *
 * Kapsam bir optimizasyon degil zorunluluk: 66 tablolik semayi her ajana
 * gondermek soru basina ~5.000 token demek, Groq ucretsiz katmani ise
 * dakikada 8.000 veriyor.
 */

export interface Ajan {
  kod: string;
  ad: string;
  renk: string;
  /** Olcum dugumlerini dogru ajana yonlendirmek icin kullanilir. */
  aciklama: string;
  tablolar: string[];
  ornekler: string[];
}

export const AJANLAR: readonly Ajan[] = [
  {
    kod: "satis",
    ad: "Satış Ajanı",
    renk: "#2f6fed",
    aciklama:
      "Teklifler, teklif kalemleri, satis firsatlari, musteri kontaklari, urun katalogu, satis temsilcisi performansi, kazanilan/kaybedilen teklifler.",
    tablolar: ["Teklifler", "TeklifKalemleri", "TeklifActivities", "OpportunityRecords", "OpportunityActivities", "Contacts", "Products", "CustomerProducts"],
    ornekler: ["Durumlarına göre teklif sayısı", "En yüksek tutarlı 10 teklif", "Satış temsilcisine göre kazanılan teklifler"],
  },
  {
    kod: "destek",
    ad: "Destek Ajanı",
    renk: "#b45309",
    aciklama:
      "Destek biletleri (ticket), bilet asamalari ve oncelikleri, destek kanallari, atanan kisiler, bilet gecmisi ve cozum sureleri.",
    tablolar: ["TicketRecords", "TicketActivities", "TicketImportLog", "Contacts"],
    ornekler: ["Aşamalarına göre bilet sayısı", "En çok bilet atanan 10 kişi", "Kanallara göre destek talepleri"],
  },
  {
    kod: "finans",
    ad: "Finans Ajanı",
    renk: "#16a34a",
    aciklama:
      "Faturalar, fatura kalemleri, sozlesmeler, tutarlar ve para birimleri, sozlesme yenileme tarihleri, faturalanacak/kesilen tutarlar.",
    tablolar: ["Invoices", "InvoiceKalemleri", "ContractRecords", "ContractActivities", "Products", "Teklifler", "TeklifKalemleri", "OpportunityRecords"],
    ornekler: ["Durumlarına göre fatura tutarları", "Bu yıl bitecek sözleşmeler", "Para birimine göre toplam fatura tutarı"],
  },
  {
    kod: "proje",
    ad: "Proje Ajanı",
    renk: "#7c3aed",
    aciklama:
      "Projeler, is paketleri, proje gorevleri, ilerleme durumlari, kanban panosu gorevleri ve atamalar.",
    tablolar: ["Projects", "ProjectTasks", "ProjectWorkPackages", "ProjectActivities", "ProjectSupportItems", "KanbanTasks", "KanbanTaskNotes"],
    ornekler: ["Durumlarına göre proje görevi sayısı", "Tamamlanmamış görevleri olan projeler", "Kanban panosunda önceliğe göre görev dağılımı"],
  },
  {
    kod: "ik",
    ad: "İK Ajanı",
    renk: "#0891b2",
    aciklama:
      "Izin talepleri ve onay durumlari, nobet cizelgeleri, giris-cikis kayitlari, takvim etkinlikleri, calisan onerileri.",
    tablolar: ["LeaveRequests", "DutySchedules", "AttendanceRecords", "CalendarEvents", "CalendarEventAttendees", "Suggestions", "SuggestionVotes", "PersonalTodos"],
    ornekler: ["İzin türlerine göre talep sayısı", "Aylara göre izin gün sayısı", "Onay bekleyen izin talepleri"],
  },
] as const;

export function ajanBul(kod: string): Ajan | undefined {
  return AJANLAR.find((a) => a.kod === kod);
}
