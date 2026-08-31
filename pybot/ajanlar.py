"""Bolum ajanlari.

Her ajan ayni veritabanini gorur; farkli olan TERIM SOZLUGU, ornek sorular
ve kimliktir. Boylece "ciro" sorusu finans ajanina, "en cok kiralanan"
sorusu satis ajanina dogru terimlerle gider.

Sozlukler kod disinda tutulur: ajanlar/<veritabani>/<kod>.md
Boylece sirket kendi bolumlerini kod degistirmeden tanimlayabilir.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .config import settings

__all__ = ["Ajan", "ajanlari_getir", "ajan_bul", "VARSAYILAN_AJAN"]


@dataclass(frozen=True)
class Ajan:
    kod: str
    ad: str
    #: Planlayici bu aciklamaya bakarak soruyu dogru ajana yonlendirir.
    aciklama: str
    renk: str
    ornekler: list[str] = field(default_factory=list)
    #: Ajanin gorebilecegi tablolar. Bos ise tum tablolar (kucuk semalar icin).
    tablolar: list[str] = field(default_factory=list)

    @property
    def sozluk_yolu(self) -> Path:
        return settings.base_dir / "ajanlar" / settings.database_name.lower() / f"{self.kod}.md"

    def sozluk(self) -> str:
        """Ajanin terim sozlugu. Dosya yoksa bos doner (sorun degil)."""
        yol = self.sozluk_yolu
        try:
            return yol.read_text(encoding="utf-8").strip() if yol.exists() else ""
        except OSError:
            return ""


# --- Gokkusagi CRM ---
# Sema 66 sorgulanabilir tablo iceriyor; tamamini her ajana gondermek soru
# basina ~5300 token demekti. Her ajan yalnizca kendi bolumunun tablolarini
# gorur. Bolumler arasi sorular planlayici tarafindan zincire bolunur.

CRM_AJANLARI = [
    Ajan(
        kod="satis",
        ad="Satış Ajanı",
        aciklama=(
            "Teklifler, teklif kalemleri, satis firsatlari, musteri kontaklari, "
            "urun katalogu, satis temsilcisi performansi, kazanilan/kaybedilen teklifler."
        ),
        renk="#2f6fed",
        tablolar=[
            "Teklifler", "TeklifKalemleri", "TeklifActivities",
            "OpportunityRecords", "OpportunityActivities",
            "Contacts", "Products", "CustomerProducts",
        ],
        ornekler=[
            "Durumlarına göre teklif sayısı",
            "En yüksek tutarlı 10 teklif",
            "Satış temsilcisine göre kazanılan teklifler",
        ],
    ),
    Ajan(
        kod="destek",
        ad="Destek Ajanı",
        aciklama=(
            "Destek biletleri (ticket), bilet asamalari ve oncelikleri, destek "
            "kanallari, atanan kisiler, bilet gecmisi ve cozum sureleri."
        ),
        renk="#b45309",
        tablolar=["TicketRecords", "TicketActivities", "TicketImportLog", "Contacts"],
        ornekler=[
            "Aşamalarına göre bilet sayısı",
            "En çok bilet atanan 10 kişi",
            "Kanallara göre destek talepleri",
        ],
    ),
    Ajan(
        kod="finans",
        ad="Finans Ajanı",
        aciklama=(
            "Faturalar, fatura kalemleri, sozlesmeler, tutarlar ve para birimleri, "
            "sozlesme yenileme tarihleri, faturalanacak/kesilen tutarlar."
        ),
        renk="#16a34a",
        tablolar=[
            "Invoices", "InvoiceKalemleri",
            "ContractRecords", "ContractActivities",
            "Products",
            # Teklif ve firsat TUTARLARI da finansin isi. Bunlar kapsamda
            # olmadan "su tekliflerin tutarini getir" gibi tamamlayici
            # adimlar calisamiyordu: ajan tabloyu goremeyip baska tabloya
            # tahminle gidiyordu.
            "Teklifler", "TeklifKalemleri", "OpportunityRecords",
        ],
        ornekler=[
            "Durumlarına göre fatura tutarları",
            "Bu yıl bitecek sözleşmeler",
            "Para birimine göre toplam fatura tutarı",
        ],
    ),
    Ajan(
        kod="proje",
        ad="Proje Ajanı",
        aciklama=(
            "Projeler, is paketleri, proje gorevleri, ilerleme durumlari, "
            "kanban panosu gorevleri ve atamalar."
        ),
        renk="#7c3aed",
        tablolar=[
            "Projects", "ProjectTasks", "ProjectWorkPackages",
            "ProjectActivities", "ProjectSupportItems",
            "KanbanTasks", "KanbanTaskNotes",
        ],
        ornekler=[
            "Durumlarına göre proje görevi sayısı",
            "Tamamlanmamış görevleri olan projeler",
            "Kanban panosunda önceliğe göre görev dağılımı",
        ],
    ),
    Ajan(
        kod="ik",
        ad="İK Ajanı",
        aciklama=(
            "Izin talepleri ve onay durumlari, nobet cizelgeleri, giris-cikis "
            "kayitlari, takvim etkinlikleri, calisan onerileri."
        ),
        renk="#0891b2",
        tablolar=[
            "LeaveRequests", "DutySchedules", "AttendanceRecords",
            "CalendarEvents", "CalendarEventAttendees",
            "Suggestions", "SuggestionVotes", "PersonalTodos",
        ],
        ornekler=[
            "İzin türlerine göre talep sayısı",
            "Aylara göre izin gün sayısı",
            "Onay bekleyen izin talepleri",
        ],
    ),
]


# Bolumleri tanimlanmamis veritabanlarinda tek bir genel ajan kullanilir.
GENEL_AJAN = Ajan(
    kod="genel",
    ad="Veri Asistanı",
    aciklama="Veritabanindaki her konuda genel sorgulama.",
    renk="#3452d8",
)

AJAN_TANIMLARI: dict[str, list[Ajan]] = {"gokkusagi_passwordvault": CRM_AJANLARI}

VARSAYILAN_AJAN = GENEL_AJAN


def ajanlari_getir() -> list[Ajan]:
    """Aktif veritabani icin tanimli ajanlar. Tanim yoksa tek genel ajan."""
    return AJAN_TANIMLARI.get(settings.database_name.lower(), [GENEL_AJAN])


def ajan_bul(kod: str | None) -> Ajan:
    """Koda gore ajan dondurur; bulunamazsa ilk ajana duser."""
    ajanlar = ajanlari_getir()
    for a in ajanlar:
        if a.kod == (kod or "").strip().lower():
            return a
    return ajanlar[0]
