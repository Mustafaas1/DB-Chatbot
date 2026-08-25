"""Bolum ajanlari, planlayici ve orkestratorun ag gerektirmeyen parcalari."""

from __future__ import annotations

import json

import pytest

from app import sqlcache
from app.ajanlar import ajan_bul, ajanlari_getir
from app.planlayici import AZAMI_VERI_ADIMI, _json_ayikla, _tek_adim, plan_yap
from app.schema import schema_to_prompt


@pytest.fixture(autouse=True)
def izole_onbellek(tmp_path, monkeypatch):
    """Testler gercek sql_cache.json dosyasina dokunmasin.

    Plan onbellegi eklendikten sonra testler birbirinin planini okuyordu.
    """
    monkeypatch.setattr(sqlcache, "DOSYA", tmp_path / "sql_cache.json")
    monkeypatch.setattr(sqlcache, "_parmak_izi", lambda: "TEST")
    yield


# ------------------------------------------------- ajan profilleri

def test_ajanlar_tanimli():
    ajanlar = ajanlari_getir()
    assert len(ajanlar) >= 2
    kodlar = {a.kod for a in ajanlar}
    assert {"satis", "finans"} <= kodlar


def test_her_ajanin_sozlugu_var():
    for a in ajanlari_getir():
        assert a.sozluk(), f"{a.kod} sozlugu bos"


def test_bilinmeyen_kod_ilk_ajana_duser():
    assert ajan_bul("olmayan").kod == ajanlari_getir()[0].kod
    assert ajan_bul(None).kod == ajanlari_getir()[0].kod


def test_ajan_sozlugu_isteme_giriyor():
    """Bolum sozlugu ortak sozlugun ustune binmeli."""
    temel = schema_to_prompt()
    finans = schema_to_prompt(ek_sozluk=ajan_bul("finans").sozluk())

    assert "BOLUM SOZLUGU" in finans
    assert "BOLUM SOZLUGU" not in temel
    assert len(finans) > len(temel)
    # Ortak kurallar kaybolmamali
    assert "IS KURALLARI" in finans


# ------------------------------------------------- onbellek ajan boyutu

def test_onbellek_anahtari_ajana_gore_ayrisir(tmp_path, monkeypatch):
    """Ayni soru farkli ajanlara farkli SQL urettirebilir."""
    monkeypatch.setattr(sqlcache, "DOSYA", tmp_path / "c.json")
    monkeypatch.setattr(sqlcache, "_parmak_izi", lambda: "S1")

    sqlcache.yaz("ozet ver", "SELECT 1", "satis")
    assert sqlcache.getir("ozet ver", "satis") == "SELECT 1"
    assert sqlcache.getir("ozet ver", "finans") is None
    assert sqlcache.getir("ozet ver") is None


# ------------------------------------------------- planlayici ayristirma

def test_json_ayikla_duz():
    assert _json_ayikla('{"adimlar":[]}') == {"adimlar": []}


def test_json_ayikla_kod_blogu():
    ham = "```json" + chr(10) + '{"adimlar":[{"ajan":"satis"}]}' + chr(10) + "```"
    assert _json_ayikla(ham)["adimlar"][0]["ajan"] == "satis"


def test_json_ayikla_aciklama_icinde():
    ham = 'Iste plan: {"adimlar":[]} umarim yardimci olur'
    assert _json_ayikla(ham) == {"adimlar": []}


@pytest.mark.parametrize("ham", ["", "bos", "{bozuk", "[]"])
def test_json_ayikla_basarisiz(ham):
    assert _json_ayikla(ham) in (None, {})


# ------------------------------------------------- planlayici dayanikliligi

class SahtePlanlayici:
    def __init__(self, icerik):
        self.icerik = icerik
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        class M:
            content = self.icerik

        class S:
            message = M()

        class Y:
            choices = [S()]

        return Y()


def test_plan_bozuk_cikti_tek_adima_duser():
    plan = plan_yap("bir soru", client=SahtePlanlayici("saçma sapan cevap"))
    assert len(plan) == 1
    assert plan[0].gorev == "bir soru"


def test_plan_taninmayan_ajan_atlanir():
    ham = json.dumps({"adimlar": [{"ajan": "olmayanbolum", "gorev": "x"}]})
    plan = plan_yap("bir soru", client=SahtePlanlayici(ham))
    assert len(plan) == 1
    assert plan[0].gorev == "bir soru"      # guvenli varsayilana dustu


def test_plan_adim_sayisi_sinirli():
    ham = json.dumps({"adimlar": [
        {"ajan": "satis", "gorev": "a"},
        {"ajan": "finans", "gorev": "b"},
        {"ajan": "envanter", "gorev": "c"},
        {"ajan": "musteri", "gorev": "d"},
    ]})
    plan = plan_yap("bir soru", client=SahtePlanlayici(ham))
    assert len(plan) == AZAMI_VERI_ADIMI, "token limiti icin adim sayisi sinirli olmali"


def test_plan_istemci_patlarsa_tek_adim():
    class Patlayan:
        def __init__(self):
            self.chat = self
            self.completions = self

        def create(self, **kwargs):
            raise RuntimeError("ag hatasi")

    plan = plan_yap("bir soru", client=Patlayan())
    assert len(plan) == 1


def test_tek_adim_varsayilani():
    plan = _tek_adim("soru")
    assert len(plan) == 1 and plan[0].gorev == "soru"


def test_adim_to_dict():
    d = _tek_adim("soru")[0].to_dict()
    assert {"ajan", "ajan_adi", "renk", "gorev", "grafik"} <= set(d)
