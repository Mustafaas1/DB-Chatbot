import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/**
 * Insan kaynagi: izin, mesai, vardiya, takvim.
 *
 * Kapasite butun diger ajanlarin altinda yatan kisit: destek yuku de
 * teslim hizi da sonunda kim musait sorusuna cikiyor.
 */
export const people: AjanTanimi = {
  kod: "people",
  ad: "Kapasite Ajanı",
  renk: "#c026d3",
  tur: "planlama",
  aciklama:
    "Izin talepleri, devam kayitlari, vardiya planlari, takvim " +
    "etkinlikleri ve kisi bazinda kapasite.",
  rolPromptu: [
    "Ekip kapasitesinden sorumlusun. Izin, mesai ve vardiya verisine",
    "bakarak kimin musait oldugunu ve yukun nerede yigildigini bulursun.",
    "Kapasite diger butun ajanlarin altinda yatan kisit: destek yuku de",
    "teslim hizi da sonunda buna cikar.",
    "Performans degerlendirmesi YAPMA; kisi kiyaslamasi degil yuk",
    "dagilimi konusuyorsun.",
    "",
    "ALAN SOZLUGU",
    "- Izin onayi IKI ASAMALIDIR: MudurOnaylayanId/MudurOnayTarihi ve",
    "  AdminOnaylayanId/AdminOnayTarihi.",
    "- GunSayisi ONDALIK olabilir; YarimGun yarim gun isaretidir.",
    "- IzinTuru izin turu, RedNedeni red nedeni.",
    "- DutySchedules: PlannedStaffId planlanan, ActualStaffId FIILEN nobet tutan.",
    "  Ikisi farkliysa nobet degismistir; IsManualChanged elle degisikligi gosterir.",
    "- AttendanceRecords: Tip giris/cikis, OkutmaZamani okutma ani.",
    "- Kullanici tablosu KAPALI; UserId GUID'lerini gosterme, sayim ver.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 2, azamiCiktiTokeni: 1000, azamiCagri: 3 },
  tablolar: [
    "LeaveRequests", "AttendanceRecords", "DutySchedules",
    "CalendarEvents", "CalendarEventAttendees", "PersonalTodos",
  ],
  ornekler: ["İzin türlerine göre talep sayısı", "Vardiya planına göre kişi dağılımı"],
};
