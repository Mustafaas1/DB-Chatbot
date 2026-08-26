"""Ozet cumlesinin uzunlugu KODDA sinirlanir.

Model talimatla kisaltilamadi: bes ayri denemede ya kisalmadi ya da baska
bir davranisi bozdu (bir seferinde toplami yanlis hesapladi). Bu yuzden
uzunluk artik deterministik olarak kodda kesiliyor.
"""

from __future__ import annotations

from app.orkestra import OZET_AZAMI_HARF, _ilk_cumle


def test_ikinci_cumle_atilir():
    uzun = ('151 teklif var; TRY 44.580.647,07 TL, USD 7.026,70 USD. '
            'TRY tarafinda en yuksek tutar Gonderildi durumunda.')
    assert _ilk_cumle(uzun) == '151 teklif var; TRY 44.580.647,07 TL, USD 7.026,70 USD.'


def test_tek_cumle_dokunulmaz():
    tek = 'Su anda 59 acik destek bileti var; bunlarin cogu beklemede.'
    assert _ilk_cumle(tek) == tek


def test_cok_uzun_tek_cumle_kirpilir():
    uzun = 'Kelime ' * 60
    c = _ilk_cumle(uzun)
    assert len(c) <= OZET_AZAMI_HARF + 1
    assert c.endswith('…')


def test_kirpma_kelime_ortasindan_bolmez():
    uzun = 'Ankara Istanbul Izmir Bursa Antalya ' * 8
    c = _ilk_cumle(uzun)
    assert '  ' not in c
    # Son kelime tam olmali (kirpma isareti haric)
    assert c.rstrip('…').split()[-1] in uzun.split()


def test_soru_ve_unlem_de_cumle_sonu():
    assert _ilk_cumle('Kayit bulunamadi! Baska bir filtre deneyin.') == 'Kayit bulunamadi!'
    assert _ilk_cumle('Bu mu demek istediniz? Evet ise tekrar sorun.') == 'Bu mu demek istediniz?'


def test_ondalik_sayi_cumle_sonu_sanilmaz():
    """44.580.647,07 icindeki noktalar cumleyi bolmemeli."""
    c = _ilk_cumle('Toplam 44.580.647,07 TL tutarinda teklif var. Ikinci cumle.')
    assert c == 'Toplam 44.580.647,07 TL tutarinda teklif var.'


def test_bos_ve_none():
    assert _ilk_cumle('') == ''
    assert _ilk_cumle(None) is None


def test_satir_sonlari_tek_bosluga_iner():
    c = _ilk_cumle('Ilk satir' + chr(10) + 'ikinci satir.')
    assert chr(10) not in c
