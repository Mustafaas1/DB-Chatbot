"""Bolum ajanlari, planlayici ve orkestratorun ag gerektirmeyen parcalari."""

from __future__ import annotations

import json

import pytest

from app import sqlcache
from app.ajanlar import ajan_bul, ajanlari_getir
from app.planlayici import AZAMI_VERI_ADIMI, _json_ayikla, _tek_adim, plan_yap
from app.schema import schema_to_prompt


@pytest.fixture(autouse=True)
def crm_ajanlari(monkeypatch):
    """Testler, gelistiricinin bagli oldugu veritabanina gore degismemeli.

    ajanlari_getir() aktif veritabanina bakiyor; burada CRM ajan kumesini
    sabitliyoruz ki .env degisince testler kirilmasin.
    """
    import dataclasses
    from app import ajanlar as ajan_modulu
    from app import schema as sema_modulu

    sabit = dataclasses.replace(
        ajan_modulu.settings, db_type="mssql", mssql_database="gokkusagi_passwordvault"
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
        "database": "gokkusagi_passwordvault",
        "db_type": "mssql",
        "tables": [{"name": "Teklifler", "schema": "dbo", "row_count": 190,
                    "columns": [{"name": "Id", "type": "uniqueidentifier", "nullable": False}],
                    "primary_key": ["Id"], "foreign_keys": []}],
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
            finish_reason = "stop"   # kesilme yok

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


def test_kota_hatasi_gizlenmez():
    """Kota dolunca sessizce ilk ajana dusmek yaniltici olur: kullanici
    yanlis yonlendirme sanir, oysa sorun API kotasinda."""
    import httpx
    import openai

    class KotaDolu:
        def __init__(self):
            self.chat = self
            self.completions = self

        def create(self, **kwargs):
            raise openai.RateLimitError(
                "limit", response=httpx.Response(429, request=httpx.Request("POST", "http://x")),
                body=None,
            )

    with pytest.raises(openai.RateLimitError):
        plan_yap("bir soru", client=KotaDolu())


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
    import dataclasses

    from app import orkestra
    from app.config import settings
    from app.planlayici import Adim

    # Statik plan yolu test ediliyor: dinamik zincir acikken planlayicinin
    # ikinci adimi dusuruluyor ve zinciri tetikleyici kuruyor.
    monkeypatch.setattr(
        orkestra, "settings", dataclasses.replace(settings, zincir_dinamik=False)
    )

    gorevler = []
    monkeypatch.setattr(orkestra, "plan_yap", lambda s: [
        Adim(ajan_bul("satis"), "birinci"),
        Adim(ajan_bul("finans"), "ikinci"),
    ])

    def sahte(gorev, gecmis=None, ajan=None, azami_tur=None, **_):
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

    def sahte(gorev, gecmis=None, ajan=None, azami_tur=None, **_):
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

    assert "grafikle de gosterilebilir" in grafikli
    assert "grafikle de gosterilebilir" not in duz
    # Yonerge bir TAVSIYE olmali: sorguyu engellememeli.
    assert "sorguyu calistirmadan" in grafikli


# ------------------------------------------------- sozde etiket kolonu

def test_sabit_etiket_kolonu_atilir():
    """Model talimata ragmen her satirda ayni degeri tasiyan 'Etiket' kolonu
    ekliyordu; uc kez talimatla denendi, kodda ayikliyoruz."""
    from app.orkestra import _sonucu_temizle

    c = _sonucu_temizle({
        "columns": ["Durum", "Sayi", "Etiket"],
        "rows": [["A", 1, "X"], ["B", 2, "X"]],
        "row_count": 2,
    })
    assert c["columns"] == ["Durum", "Sayi"]
    assert c["rows"] == [["A", 1], ["B", 2]]


def test_degisen_etiket_kolonu_korunur():
    from app.orkestra import _sonucu_temizle

    c = _sonucu_temizle({
        "columns": ["Durum", "Etiket"],
        "rows": [["A", "X"], ["B", "Y"]],
        "row_count": 2,
    })
    assert c["columns"] == ["Durum", "Etiket"]


def test_anlamli_sabit_kolon_korunur():
    """Tek para birimi donen bir sorguda 'Para Birimi' sabittir ama anlamlidir."""
    from app.orkestra import _sonucu_temizle

    c = _sonucu_temizle({
        "columns": ["Durum", "Para Birimi", "Tutar"],
        "rows": [["A", "TRY", 1], ["B", "TRY", 2]],
        "row_count": 2,
    })
    assert c["columns"] == ["Durum", "Para Birimi", "Tutar"]


def test_tek_satirda_dokunulmaz():
    from app.orkestra import _sonucu_temizle

    g = {"columns": ["Durum", "Etiket"], "rows": [["A", "X"]], "row_count": 1}
    assert _sonucu_temizle(g)["columns"] == ["Durum", "Etiket"]


def test_ayni_ajana_iki_adim_verilmez():
    """Tek sorguda donebilecek is icin iki tur token yakmak anlamsiz."""
    ham = json.dumps({"adimlar": [
        {"ajan": "ik", "gorev": "talep sayisi"},
        {"ajan": "ik", "gorev": "toplam gun"},
    ]})
    plan = plan_yap("bir soru", client=SahtePlanlayici(ham))
    assert len(plan) == 1
    assert plan[0].ajan.kod == "ik"


def test_farkli_ajanlar_korunur():
    ham = json.dumps({"adimlar": [
        {"ajan": "satis", "gorev": "teklif sayisi"},
        {"ajan": "finans", "gorev": "teklif tutari"},
    ]})
    plan = plan_yap("bir soru", client=SahtePlanlayici(ham))
    assert [a.ajan.kod for a in plan] == ["satis", "finans"]


def test_kesilen_cikti_genis_butceyle_tekrar_denenir():
    """PLAN_BUTCESI yetmeyince JSON yarida kesiliyor ve plan sessizce tek
    adima dusuyordu; kesilme tespit edilip bir kez daha denenmeli."""
    denemeler = []

    class KesilenSonraTam:
        def __init__(self):
            self.chat = self
            self.completions = self

        def create(self, **kwargs):
            denemeler.append(kwargs.get("max_tokens"))
            ilk = len(denemeler) == 1
            icerik = ('{"adimlar":[{"ajan":"satis","gorev":"Teklif'
                      if ilk else
                      json.dumps({"adimlar": [{"ajan": "satis", "gorev": "Teklifleri say"}]}))

            class M:
                content = icerik

            class S:
                message = M()
                finish_reason = "length" if ilk else "stop"

            class Y:
                choices = [S()]

            return Y()

    plan = plan_yap("bir soru", client=KesilenSonraTam())
    assert len(denemeler) == 2, "kesilme sonrasi tekrar denenmedi"
    assert denemeler[1] > denemeler[0], "ikinci deneme daha genis butceyle olmali"
    assert plan[0].gorev == "Teklifleri say"


# --- Zincirde kapsam devri -------------------------------------------------
# Tetiklenen ajan, onceki adimin bulgusunu inceleyecegi icin o adimin
# tablolarini da gormeli. Aksi halde "boyle bir tablo yok" deyip bos donuyordu
# (Proje Ajani'nin destek biletlerini gorememesi hatasi).

def test_kapsam_ek_tablolarla_genisler():
    from app.llm import _ajan_kapsami
    from app.ajanlar import ajan_bul

    proje = ajan_bul("proje")
    kendi = _ajan_kapsami(proje)
    genis = _ajan_kapsami(proje, {"TicketRecords"})

    assert "TicketRecords" not in kendi
    assert "TicketRecords" in genis
    assert kendi < genis


def test_tetiklenen_ajan_onceki_tablonun_semasini_gorur():
    """Kapsam kumesi degil, ISTEME GIDEN SEMA metni sinanir.

    Hata tam olarak buradaydi: sozluk cumlesi TicketRecords'tan soz
    ediyordu ama tablo TANIMI semada olmadigi icin Proje Ajani
    "boyle bir tablo yok" diyordu.
    """
    from app.llm import _ajan_kapsami
    from app.ajanlar import ajan_bul
    from app.schema import schema_to_prompt

    proje = ajan_bul("proje")
    destek = ajan_bul("destek")

    dar = schema_to_prompt(sadece=_ajan_kapsami(proje))
    genis = schema_to_prompt(sadece=_ajan_kapsami(proje, destek.tablolar))

    assert "dbo.TicketRecords(" not in dar
    assert "dbo.TicketRecords(" in genis
    # Kendi tablolarini kaybetmemeli.
    assert "dbo.ProjectTasks(" in genis


def test_kapsamsiz_ajan_daraltilmaz():
    from app.llm import _ajan_kapsami

    # Tablolari olmayan ajan tum semayi gorur; ek tablo bunu daraltmamali.
    assert _ajan_kapsami(None) is None
    assert _ajan_kapsami(None, {"TicketRecords"}) is None


# --- Ozet cumlesi: dusen ilk parca ------------------------------------


def test_ilk_parca_dusunce_koddan_cumle_kurulur():
    """Kalan parca onceki parcaya geri gonderme yapiyor olabilir.

    'bunlarin cogu (125) Bekliyor' tek basina havada kaliyordu.
    """
    from app.orkestra import _rakam_yigilmasini_at
    from app.db import QueryResult

    sonuc = QueryResult(
        columns=["Durum", "Görev Sayısı"],
        rows=[["Bekliyor", 125], ["Tamamlandı", 39], ["Devam Ediyor", 11]],
        truncated=False,
        sql="",
        duration_ms=1,
    )
    cumle = "Toplam 175 görev var, 3 kategoride; bunların çoğu (125) Bekliyor."
    cikti = _rakam_yigilmasini_at(cumle, sonuc)

    assert not cikti.startswith("bunların")
    assert "175" in cikti or "Görev" in cikti


def test_ilk_parca_kalinca_model_cumlesi_korunur():
    """Asil davranis bozulmamali: ilk parca duruyorsa o kullanilir."""
    from app.orkestra import _rakam_yigilmasini_at
    from app.db import QueryResult

    sonuc = QueryResult(
        columns=["Durum", "Adet"],
        rows=[["Gönderildi", 103], ["Kazanıldı", 32]],
        truncated=False,
        sql="",
        duration_ms=1,
    )
    cumle = "151 teklif var; 103 gönderildi, 32 kazanıldı, 14 reddedildi."
    cikti = _rakam_yigilmasini_at(cumle, sonuc)

    assert cikti.startswith("151 teklif var")
