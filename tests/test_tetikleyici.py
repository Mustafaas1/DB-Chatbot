"""Ajanlar arasi tetikleme (dinamik zincir) testleri.

Tetik, zinciri BULGUYA bakarak uzatir. Buradaki testler iki seyi guvence
altina alir:
  1. Tetik basarisiz olursa zincir sessizce durur; eldeki cevap kaybolmaz.
  2. Zincir kendini tekrar etmez ve sinirsiz uzamaz.
"""

from __future__ import annotations

import dataclasses
import json

import pytest

from app import tetikleyici
from app.ajanlar import ajan_bul
from app.config import settings
from app.planlayici import Adim


class SahteMesaj:
    def __init__(self, icerik):
        self.content = icerik


class SahteSecim:
    def __init__(self, icerik, finish_reason="stop"):
        self.message = SahteMesaj(icerik)
        self.finish_reason = finish_reason


class SahteKullanim:
    prompt_tokens = 120
    completion_tokens = 40


class SahteYanit:
    def __init__(self, icerik):
        self.choices = [SahteSecim(icerik)]
        self.usage = SahteKullanim()


class SahteIstemci:
    """client.chat.completions.create(...) cagrisini taklit eder."""

    def __init__(self, icerik=None, hata=None):
        self.icerik = icerik
        self.hata = hata
        self.cagri_sayisi = 0

        istemci = self

        class _Completions:
            def create(self, **_kwargs):
                istemci.cagri_sayisi += 1
                if istemci.hata:
                    raise istemci.hata
                return SahteYanit(istemci.icerik)

        class _Chat:
            completions = _Completions()

        self.chat = _Chat()


SONUC = {
    "columns": ["Asama", "Adet"],
    "rows": [["Beklemede", 47], ["Islemde", 12]],
}


@pytest.fixture
def biten():
    return Adim(ajan_bul("destek"), "Acik biletleri asamalarina gore say")


@pytest.fixture(autouse=True)
def dinamik_acik(monkeypatch):
    monkeypatch.setattr(
        tetikleyici, "settings", dataclasses.replace(settings, zincir_dinamik=True)
    )


def _karar(icerik, biten, kullanilmis=("destek",)):
    return tetikleyici.sonraki_adim(
        soru="Destek yukumuzu nasil azaltiriz?",
        biten=biten,
        cevap_metni="59 acik bilet var.",
        sonuc=SONUC,
        kullanilmis=list(kullanilmis),
        client=SahteIstemci(icerik),
    )


def test_gecerli_tetik_zinciri_uzatir(biten):
    karar = _karar(json.dumps({
        "devam": True,
        "ajan": "proje",
        "gorev": "Tamamlanmamis proje gorevlerini durumlarina gore say",
        "gerekce": "Biletlerin cogu beklemede; kaynagi bitmemis gorevler olabilir.",
        "grafik": True,
    }), biten)
    assert karar.devam
    assert karar.adim.ajan.kod == "proje"
    assert karar.adim.grafik is True
    assert "beklemede" in karar.gerekce.lower()
    # Gerekce adima da islenmeli: arayuz gecmisten yeniden cizerken kullaniyor.
    assert karar.adim.gerekce == karar.gerekce
    assert karar.adim.to_dict()["gerekce"] == karar.gerekce


def test_devam_false_zinciri_durdurur(biten):
    assert not _karar(json.dumps({"devam": False}), biten).devam


def test_zaten_calismis_ajan_secilemez(biten):
    # Model yine destek derse zincir uzamamali; ayni ajani tekrarlamak
    # ping-pong dongusu ve bosuna token demek.
    karar = _karar(json.dumps({
        "devam": True, "ajan": "destek", "gorev": "Tekrar say", "gerekce": "x",
    }), biten)
    assert not karar.devam


def test_taninmayan_ajan_kodu_reddedilir(biten):
    karar = _karar(json.dumps({
        "devam": True, "ajan": "pazarlama", "gorev": "Bir sey yap", "gerekce": "x",
    }), biten)
    assert not karar.devam


def test_bos_gorev_reddedilir(biten):
    karar = _karar(json.dumps({
        "devam": True, "ajan": "proje", "gorev": "   ", "gerekce": "x",
    }), biten)
    assert not karar.devam


def test_bozuk_json_zinciri_durdurur_hata_firlatmaz(biten):
    assert not _karar("bu JSON degil", biten).devam


def test_kod_blogu_icindeki_json_okunur(biten):
    icerik = '```json\n{"devam": true, "ajan": "finans", "gorev": "Tutari getir", "gerekce": "y"}\n```'
    karar = _karar(icerik, biten)
    assert karar.devam and karar.adim.ajan.kod == "finans"


def test_kota_hatasi_zinciri_sessizce_durdurur(biten, monkeypatch):
    import httpx
    import openai

    istek = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    istemci = SahteIstemci(hata=openai.RateLimitError(
        "kota", response=httpx.Response(429, request=istek), body=None
    ))
    karar = tetikleyici.sonraki_adim(
        soru="s", biten=biten, cevap_metni="c", sonuc=SONUC,
        kullanilmis=["destek"], client=istemci,
    )
    # Eldeki cevap gecerli; tetik hatasi onu cope atmamali.
    assert not karar.devam


def test_verisi_olmayan_adim_tetik_uretmez(biten):
    istemci = SahteIstemci(json.dumps({"devam": True, "ajan": "proje", "gorev": "x"}))
    karar = tetikleyici.sonraki_adim(
        soru="s", biten=biten, cevap_metni="c", sonuc=None,
        kullanilmis=["destek"], client=istemci,
    )
    assert not karar.devam
    # Bulgusuz adimda modele hic gidilmemeli (bosuna token).
    assert istemci.cagri_sayisi == 0


def test_tum_ajanlar_kullanildiysa_model_cagrilmaz(biten):
    from app.ajanlar import ajanlari_getir

    hepsi = [a.kod for a in ajanlari_getir()]
    istemci = SahteIstemci(json.dumps({"devam": True, "ajan": "proje", "gorev": "x"}))
    karar = tetikleyici.sonraki_adim(
        soru="s", biten=biten, cevap_metni="c", sonuc=SONUC,
        kullanilmis=hepsi, client=istemci,
    )
    assert not karar.devam
    assert istemci.cagri_sayisi == 0


def test_dinamik_kapaliyken_tetik_calismaz(biten, monkeypatch):
    monkeypatch.setattr(
        tetikleyici, "settings", dataclasses.replace(settings, zincir_dinamik=False)
    )
    istemci = SahteIstemci(json.dumps({"devam": True, "ajan": "proje", "gorev": "x"}))
    karar = tetikleyici.sonraki_adim(
        soru="s", biten=biten, cevap_metni="c", sonuc=SONUC,
        kullanilmis=["destek"], client=istemci,
    )
    assert not karar.devam
    assert istemci.cagri_sayisi == 0


# --- Orkestratordeki dinamik zincir ------------------------------------


class SahteSonuc:
    columns = ["Asama", "Adet"]
    rows = [["Beklemede", 47], ["Islemde", 12]]
    row_count = 2

    def to_dict(self):
        return {"columns": self.columns, "rows": self.rows, "row_count": self.row_count}


class SahteCevap:
    def __init__(self, tamamlandi=True):
        self.cevap = "Iki asama var."
        self.adimlar = []
        self.tamamlandi = tamamlandi
        self.son_sonuc = SahteSonuc() if tamamlandi else None
        self.kullanim = {"input_tokens": 1, "output_tokens": 1}
        self.gecmis = []


def _zinciri_kur(monkeypatch, tetikler, azami=4, tamamlandi=True):
    """akis_uret'i sahte ajan ve sahte tetiklerle calistirir."""
    import dataclasses

    from app import orkestra
    from app.ajanlar import ajan_bul as _bul
    from app.config import settings as _ayar

    monkeypatch.setattr(
        orkestra, "settings",
        dataclasses.replace(_ayar, zincir_dinamik=True, zincir_azami_adim=azami),
    )
    monkeypatch.setattr(orkestra, "plan_yap", lambda s: [
        Adim(_bul("destek"), "birinci"),
        Adim(_bul("finans"), "planlayicinin ikinci adimi"),
    ])
    monkeypatch.setattr(orkestra, "sohbet_et",
                        lambda *a, **k: SahteCevap(tamamlandi))
    monkeypatch.setattr(orkestra, "analiz_yap",
                        lambda **k: type("A", (), {"bos_mu": lambda self: True})())

    sirasi = iter(tetikler)

    def sahte_tetik(**kwargs):
        try:
            return next(sirasi)
        except StopIteration:
            return tetikleyici.TetikKarari(None)

    monkeypatch.setattr(orkestra, "sonraki_adim", sahte_tetik)
    return list(orkestra.akis_uret("soru"))


def _tetik(kod, gorev, gerekce):
    from app.ajanlar import ajan_bul as _bul

    return tetikleyici.TetikKarari(Adim(_bul(kod), gorev, False, gerekce), gerekce)


def test_dinamik_modda_planlayicinin_ikinci_adimi_kullanilmaz(monkeypatch):
    kayitlar = _zinciri_kur(monkeypatch, [])
    plan = next(k for k in kayitlar if k["tur"] == "plan")
    assert plan["dinamik"] is True
    assert len(plan["adimlar"]) == 1
    adimlar = [k for k in kayitlar if k["tur"] == "adim"]
    assert [a["ajan"] for a in adimlar] == ["destek"]


def test_tetik_zinciri_uzatir_ve_gerekce_yayinlanir(monkeypatch):
    kayitlar = _zinciri_kur(monkeypatch, [
        _tetik("proje", "Bitmemis gorevleri say", "Biletler beklemede takildi."),
        _tetik("ik", "Yuku kisi basina dagit", "Yigilma kapasite sorunu olabilir."),
    ])
    adimlar = [k for k in kayitlar if k["tur"] == "adim"]
    tetikler = [k for k in kayitlar if k["tur"] == "tetik"]

    assert [a["ajan"] for a in adimlar] == ["destek", "proje", "ik"]
    assert [(t["kaynak"], t["hedef"]) for t in tetikler] == [
        ("destek", "proje"), ("proje", "ik"),
    ]
    assert tetikler[0]["gerekce"] == "Biletler beklemede takildi."
    # Gerekce adimin kendisine de islenmeli (sayfa yenilenince kaybolmasin).
    assert adimlar[1]["gerekce"] == "Biletler beklemede takildi."
    assert adimlar[0]["gerekce"] == ""


def test_zincir_azami_adimi_asmaz(monkeypatch):
    sonsuz = [_tetik("proje", "g", "r"), _tetik("ik", "g", "r"), _tetik("satis", "g", "r")]
    kayitlar = _zinciri_kur(monkeypatch, sonsuz, azami=2)
    adimlar = [k for k in kayitlar if k["tur"] == "adim"]
    assert len(adimlar) == 2
    # Sinira gelindiginde bosuna tetik kaydi yayinlanmamali.
    assert len([k for k in kayitlar if k["tur"] == "tetik"]) == 1


def test_yarida_kalan_adim_zinciri_uzatmaz(monkeypatch):
    kayitlar = _zinciri_kur(
        monkeypatch, [_tetik("proje", "g", "r")], tamamlandi=False
    )
    assert [k for k in kayitlar if k["tur"] == "tetik"] == []
    assert len([k for k in kayitlar if k["tur"] == "adim"]) == 1


def test_tetikli_adimin_gorevine_gerekce_eklenir():
    from app.orkestra import _gorev_metni
    from app.ajanlar import ajan_bul as _bul

    metin = _gorev_metni(
        Adim(_bul("proje"), "Gorevleri say", False, "Biletler beklemede."),
        "onceki bulgu",
    )
    assert "BU ADIMIN GEREKCESI" in metin
    assert "Biletler beklemede." in metin


def test_kota_durumu_ayirt_edilir(biten):
    import httpx
    import openai

    istek = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    istemci = SahteIstemci(hata=openai.RateLimitError(
        "kota", response=httpx.Response(429, request=istek), body=None
    ))
    karar = tetikleyici.sonraki_adim(
        soru="s", biten=biten, cevap_metni="c", sonuc=SONUC,
        kullanilmis=["destek"], client=istemci,
    )
    assert karar.durum == "kota"


def test_modelin_dur_karari_kotadan_ayrilir(biten):
    assert _karar(json.dumps({"devam": False}), biten).durum == "dur"


def test_bozuk_json_hata_durumu_verir(biten):
    assert _karar("JSON degil", biten).durum == "hata"


def test_kota_durunca_zincir_durdu_kaydi_yayinlanir(monkeypatch):
    kayitlar = _zinciri_kur(
        monkeypatch, [tetikleyici.TetikKarari(None, durum="kota")]
    )
    durdu = [k for k in kayitlar if k["tur"] == "zincir_durdu"]
    assert len(durdu) == 1
    assert durdu[0]["sebep"] == "kota"
    # Tamamlanmis adim yine de yayinlanmis olmali.
    assert len([k for k in kayitlar if k["tur"] == "adim"]) == 1


def test_modelin_dur_karari_bildirim_uretmez(monkeypatch):
    kayitlar = _zinciri_kur(
        monkeypatch, [tetikleyici.TetikKarari(None, durum="dur")]
    )
    assert [k for k in kayitlar if k["tur"] == "zincir_durdu"] == []


def test_tetik_maliyeti_toplama_eklenir(monkeypatch):
    kayitlar = _zinciri_kur(monkeypatch, [
        tetikleyici.TetikKarari(
            None, durum="dur", kullanim={"input_tokens": 900, "output_tokens": 60}
        )
    ])
    bitti = next(k for k in kayitlar if k["tur"] == "bitti")
    # Sahte ajan adim basina 1/1 token bildiriyor; tetigin maliyeti eklenmeli.
    assert bitti["usage"]["input_tokens"] == 1 + 900
    assert bitti["usage"]["output_tokens"] == 1 + 60
