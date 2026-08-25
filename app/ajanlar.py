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


SAKILA_AJANLARI = [
    Ajan(
        kod="satis",
        ad="Satış Ajanı",
        aciklama=(
            "Kiralama islemleri, en cok/az kiralanan filmler, musteri satin alma "
            "davranisi, donem karsilastirmalari, magaza ve personel satis performansi."
        ),
        renk="#2f6fed",
        ornekler=[
            "En çok kiralanan 10 film hangileri?",
            "Mağazalara göre aylık kiralama sayısı",
            "En çok kiralama yapan 10 müşteri",
        ],
    ),
    Ajan(
        kod="finans",
        ad="Finans Ajanı",
        aciklama=(
            "Ciro, tahsilat, odeme tutarlari, ortalama sepet, gecikme ve iade "
            "edilmemis kiralamalarin mali etkisi, donemsel finansal ozetler."
        ),
        renk="#16a34a",
        ornekler=[
            "Aylara göre toplam ciro",
            "En çok harcama yapan 10 müşteri",
            "Ortalama ödeme tutarı nedir?",
        ],
    ),
    Ajan(
        kod="envanter",
        ad="Envanter Ajanı",
        aciklama=(
            "Film katalogu, kategoriler, stok/kopya sayilari, magaza bazli "
            "mevcudiyet, hic kiralanmamis veya dusuk dolasimli urunler."
        ),
        renk="#b45309",
        ornekler=[
            "Kategorilere göre film sayısı",
            "Hiç kiralanmamış film var mı?",
            "Mağazalarda kaç kopya var?",
        ],
    ),
    Ajan(
        kod="musteri",
        ad="Müşteri Ajanı",
        aciklama=(
            "Musteri kimligi, iletisim ve adres bilgileri, aktif/pasif durumu, "
            "sehir ve ulke dagilimi, musteri segmentleri."
        ),
        renk="#7c3aed",
        ornekler=[
            "Şehirlere göre aktif müşteri sayısı",
            "Kaç pasif müşterimiz var?",
            "Ülkelere göre müşteri dağılımı",
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

AJAN_TANIMLARI: dict[str, list[Ajan]] = {"sakila": SAKILA_AJANLARI}

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
