"""Bolum ajanlari, planlayici ve orkestratorun ag gerektirmeyen parcalari."""

from __future__ import annotations

import json

import pytest

from app import sqlcache
from app.ajanlar import ajan_bul, ajanlari_getir
from app.planlayici import AZAMI_VERI_ADIMI, _json_ayikla, _tek_adim, plan_yap
from app.schema import schema_to_prompt


@pytest.fixture(autouse=True)
def sakila_ajanlari(monkeypatch):
    """Testler, gelistiricinin bagli oldugu veritabanina gore degismemeli.

    ajanlari_getir() aktif veritabanina bakiyor; burada Sakila ajan kumesini
    sabitliyoruz ki .env degisince testler kirilmasin.
    """
    import dataclasses
    from app import ajanlar as ajan_modulu
    from app import schema as sema_modulu

    sabit = dataclasses.replace(
        ajan_modulu.settings, db_type="mysql", mysql_database="sakila"
    )
    monkeypatch.setattr(ajan_modulu, "settings", sabit)
    monkeypatch.setattr(sema_modulu, "settings", sabit)
    yield


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


def test_ajan_sozlugu_isteme_giriyor(monkeypatch):
    """Bolum sozlugu ortak sozlugun ustune binmeli.

    Sema sahte: test hangi veritabanina bagli oldugumuzdan bagimsiz olmali.
    """
    from app import schema as sema_modulu

    sahte = {
        "database": "sakila",
        "db_type": "mysql",
        "tables": [{"name": "film", "schema": "", "row_count": 1000,
                    "columns": [{"name": "film_id", "type": "int", "nullable": False}],
                    "primary_key": ["film_id"], "foreign_keys": []}],
        "views": [],
    }
    monkeypatch.setattr(sema_modulu, "get_schema", lambda *a, **k: sahte)

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


# ------------------------------------------------- yarida kalan adim

class SahteCevap:
    """sohbet_et() yerine gecen minimal cevap nesnesi."""

    def __init__(self, tamamlandi, sonuc=None):
        self.cevap = "cevap metni"
        self.adimlar = [{"sql": "SELECT 1", "ok": True}]
        self.son_sonuc = sonuc
        self.gecmis = []
        self.kullanim = {"input_tokens": 10, "output_tokens": 2}
        self.tamamlandi = tamamlandi


class SahteSonuc:
    columns = ["A"]
    rows = [[1], [2]]
    row_count = 2

    def to_dict(self):
        return {"columns": self.columns, "rows": self.rows, "row_count": self.row_count}


def test_varsayilan_cevap_tamamlanmis_sayilir():
    from app.llm import ChatCevabi

    assert ChatCevabi("x", [], None, [], {}).tamamlandi is True


def test_yarida_kalan_adimin_sonucu_gonderilmez(monkeypatch):
    """Sorgu turleri tukenince elde kalan sonuc yarim bir denemeye ait
    olabilir; arayuze gecerli sonuc gibi gitmemeli."""
    from app import orkestra
    from app.planlayici import Adim

    monkeypatch.setattr(orkestra, "plan_yap", lambda s: [Adim(ajan_bul("satis"), "gorev")])
    monkeypatch.setattr(orkestra, "sohbet_et",
                        lambda *a, **k: SahteCevap(False, SahteSonuc()))

    v = orkestra.akis_calistir("soru")
    adim = v["adimlar"][0]
    assert adim["tamamlandi"] is False
    assert adim["result"] is None, "yarim adimin sonucu gonderilmemeli"


def test_tamamlanan_adimin_sonucu_gonderilir(monkeypatch):
    from app import orkestra
    from app.planlayici import Adim

    monkeypatch.setattr(orkestra, "plan_yap", lambda s: [Adim(ajan_bul("satis"), "gorev")])
    monkeypatch.setattr(orkestra, "sohbet_et",
                        lambda *a, **k: SahteCevap(True, SahteSonuc()))

    adim = orkestra.akis_calistir("soru")["adimlar"][0]
    assert adim["tamamlandi"] is True
    assert adim["result"]["row_count"] == 2


def test_yarida_kalan_adim_sonrakine_devredilmez(monkeypatch):
    """Guvenilmez bulgu ikinci ajani yanlis yonlendirmemeli."""
    from app import orkestra
    from app.planlayici import Adim

    gorevler = []
    monkeypatch.setattr(orkestra, "plan_yap", lambda s: [
        Adim(ajan_bul("satis"), "birinci"),
        Adim(ajan_bul("finans"), "ikinci"),
    ])

    def sahte(gorev, gecmis=None, ajan=None, azami_tur=None):
        gorevler.append(gorev)
        return SahteCevap(False, SahteSonuc())

    monkeypatch.setattr(orkestra, "sohbet_et", sahte)
    orkestra.akis_calistir("soru")

    assert "ONCEKI ADIMIN BULGUSU" not in gorevler[1]


def test_zincir_tur_siniri_uygulanir(monkeypatch):
    """Zincirde basarisiz bir adim 6 tur donerse cok pahaliya mal oluyor."""
    from app import orkestra
    from app.planlayici import Adim

    verilen = {}
    monkeypatch.setattr(orkestra, "plan_yap", lambda s: [Adim(ajan_bul("satis"), "gorev")])

    def sahte(gorev, gecmis=None, ajan=None, azami_tur=None):
        verilen["tur"] = azami_tur
        return SahteCevap(True)

    monkeypatch.setattr(orkestra, "sohbet_et", sahte)
    orkestra.akis_calistir("soru")
    assert verilen["tur"] == orkestra.ZINCIR_TUR_SINIRI


def test_grafik_adimina_bicim_yonergesi_eklenir():
    from app.orkestra import _gorev_metni
    from app.planlayici import Adim

    grafikli = _gorev_metni(Adim(ajan_bul("finans"), "gorev", True), "")
    duz = _gorev_metni(Adim(ajan_bul("finans"), "gorev", False), "")

    assert "ETIKET kolonu" in grafikli
    assert "ETIKET kolonu" not in duz
