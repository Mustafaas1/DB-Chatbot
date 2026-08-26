"""Toplami MODEL DEGIL KOD hesaplar.

Model gruplu sonuclarda toplami kafadan atiyordu: 103+32+2+14 icin "147"
dedi (dogrusu 151). Talimatla uc kez duzeltmeye calisildi, her seferinde
baska bir yeri bozdu. Artik toplam kodda hesaplanip arac sonucuna
ekleniyor; model yalnizca aktariyor.
"""

from __future__ import annotations

from app.llm import _hesaplanmis_ozet


class SahteSonuc:
    def __init__(self, columns, rows):
        self.columns = columns
        self.rows = rows
        self.row_count = len(rows)
        self.truncated = False
        self.duration_ms = 1


def test_tek_olcu_toplami():
    o = _hesaplanmis_ozet(SahteSonuc(
        ["Durum", "Teklif Sayisi"],
        [["Gonderildi", 103], ["Kazanildi", 32], ["Kaybedildi", 2], ["Teklif", 14]],
    ))
    assert len(o) == 1
    assert "151" in o[0]
    assert "4 grup" in o[0]


def test_para_birimi_ayri_toplanir():
    """TRY ile USD tek toplamda birlesmemeli."""
    o = _hesaplanmis_ozet(SahteSonuc(
        ["Para Birimi", "Toplam Tutar"],
        [["TRY", 44580647.07], ["USD", 7026.70]],
    ))
    assert len(o) == 1
    assert "TRY" in o[0] and "USD" in o[0]
    assert "birim bazinda" in o[0]
    # Iki tutar toplanmis olmamali
    assert "44,587,673" not in o[0]


def test_ayni_birimde_gruplar_toplanir():
    o = _hesaplanmis_ozet(SahteSonuc(
        ["Durum", "Para Birimi", "Tutar"],
        [["A", "TRY", 100.0], ["B", "TRY", 50.0], ["C", "USD", 7.0]],
    ))
    assert "TRY: 150" in o[0]
    assert "USD: 7" in o[0]


def test_kimlik_kolonu_olcu_sayilmaz():
    """Musteri ID sayisaldir ama toplanacak bir olcu degildir."""
    o = _hesaplanmis_ozet(SahteSonuc(
        ["Musteri ID", "Musteri Adi", "Tutar"],
        [[1, "A", 10], [2, "B", 20]],
    ))
    assert "30" in o[0]


def test_iki_olcu_varsa_toplam_verilmez():
    """Hangisinin toplanacagi belirsiz; yanlis sayi vermektense hic verme."""
    assert _hesaplanmis_ozet(SahteSonuc(
        ["Durum", "Adet", "Tutar"], [["A", 1, 10], ["B", 2, 20]]
    )) == []


def test_tek_satirda_toplam_verilmez():
    assert _hesaplanmis_ozet(SahteSonuc(["Durum", "Adet"], [["A", 5]])) == []


def test_bilimsel_gosterim_kullanilmaz():
    o = _hesaplanmis_ozet(SahteSonuc(
        ["Durum", "Tutar"], [["A", 44580647.07], ["B", 1.0]],
    ))
    assert "e+" not in o[0].lower()
