"""Sema tazeligi testleri.

Sirketin veritabani canli: kolon eklenebilir, silinebilir, adi degisebilir.
Bu testler semanin bayat kalmamasini ve bayat semanin SQL onbellegini
sessizce yaniltmamasini guvence altina alir.
"""

from __future__ import annotations

import dataclasses
import time

import pytest

from pybot import schema as sema_modulu
from pybot import sqlcache
from pybot.schema import sema_hatasi_mi, _bayat


def tmp_yol():
    """Var olmayan bir onbellek yolu: disk kopyasi devreye girmesin."""
    from pathlib import Path
    return Path(__file__).parent / "olmayan_sema_onbellegi.json"


@pytest.fixture
def ttl_ayarla(monkeypatch):
    """settings donmus bir dataclass; kopya uretip modul referansini degistir."""
    def ayarla(deger: int):
        monkeypatch.setattr(
            sema_modulu,
            "settings",
            dataclasses.replace(sema_modulu.settings, schema_ttl=deger),
        )
    return ayarla


# ------------------------------------------------- sema hatasi tanima

SEMA_HATALARI = [
    "(1054, \"Unknown column 'musteri_adi' in 'field list'\")",
    "(1146, \"Table 'sirket.eski_tablo' doesn't exist\")",
    "(1109, \"Unknown table 'x' in field list\")",
    "[42S22] [Microsoft][ODBC Driver 18] Invalid column name 'Bakiye'.",
    "[42S02] [Microsoft][ODBC Driver 18] Invalid object name 'dbo.Musteriler'.",
]


@pytest.mark.parametrize("hata", SEMA_HATALARI)
def test_sema_hatalari_taninir(hata):
    assert sema_hatasi_mi(hata) is True


SEMA_DISI_HATALAR = [
    "Yasakli SQL ifadesi tespit edildi: DROP",
    "(2013, 'Lost connection to MySQL server during query')",
    "Query execution was interrupted, maximum statement execution time exceeded",
    "(1064, \"You have an error in your SQL syntax\")",
    "",
]


@pytest.mark.parametrize("hata", SEMA_DISI_HATALAR)
def test_ilgisiz_hatalar_sema_hatasi_sayilmaz(hata):
    """Sozdizimi/baglanti hatasinda semayi bosuna yeniden taramamaliyiz."""
    assert sema_hatasi_mi(hata) is False


# ------------------------------------------------- omur

def test_omru_dolan_sema_bayat_sayilir(ttl_ayarla):
    ttl_ayarla(3600)
    assert _bayat({"alindi": time.time() - 7200}) is True
    assert _bayat({"alindi": time.time() - 60}) is False


def test_zaman_damgasi_olmayan_sema_bayat_sayilir(ttl_ayarla):
    ttl_ayarla(3600)
    assert _bayat({}) is True
    assert _bayat(None) is True


def test_ttl_sifir_eskimeyi_kapatir(ttl_ayarla):
    """Statik semali kurulumlarda gereksiz tarama yapilmasin."""
    ttl_ayarla(0)
    assert _bayat({"alindi": 0}) is False


def test_bayat_sema_yeniden_taranir(monkeypatch, ttl_ayarla):
    """get_schema, omru dolmus onbellegi kullanmayip yeniden taramali."""
    cagrildi = []

    def sahte_refresh():
        cagrildi.append(1)
        return {"database": "x", "db_type": "mysql", "tables": [], "alindi": time.time()}

    monkeypatch.setattr(sema_modulu, "refresh_schema", sahte_refresh)
    monkeypatch.setattr(sema_modulu, "_bellek_onbellegi", {"alindi": time.time() - 99999})
    ttl_ayarla(60)
    monkeypatch.setattr(sema_modulu, "CACHE_PATH", tmp_yol())

    sema_modulu.get_schema()
    assert cagrildi, "bayat sema yeniden taranmadi"


# ------------------------------------------------- otomatik yenileme sinirlama

def test_otomatik_yenileme_art_arda_tetiklenmez(monkeypatch):
    """Model art arda hatali sorgu yazarsa veritabanini yormamali."""
    sayac = []
    monkeypatch.setattr(sema_modulu, "refresh_schema", lambda: sayac.append(1))
    monkeypatch.setattr(sema_modulu, "_son_otomatik_yenileme", 0.0)

    assert sema_modulu.otomatik_yenile() is True
    assert sema_modulu.otomatik_yenile() is False   # aralik dolmadi
    assert len(sayac) == 1


def test_yenileme_hatasi_akisi_kesmez(monkeypatch):
    def patlat():
        raise RuntimeError("veritabani erisilemez")

    monkeypatch.setattr(sema_modulu, "refresh_schema", patlat)
    monkeypatch.setattr(sema_modulu, "_son_otomatik_yenileme", 0.0)
    assert sema_modulu.otomatik_yenile() is False


# ------------------------------------------------- sema <-> SQL onbellegi baglantisi

def test_sema_degisince_sql_onbellegi_duser(tmp_path, monkeypatch):
    """EN KRITIK: kolon adi degisirse eski SQL calismaya devam etmemeli.

    SQL onbelleginin anahtari semanin parmak izini icerir; sema metni
    degisince kayitlar gecersiz olmali.
    """
    monkeypatch.setattr(sqlcache, "DOSYA", tmp_path / "sql_cache.json")

    monkeypatch.setattr(sema_modulu, "schema_to_prompt", lambda: "musteri(id:int, ad:varchar)")
    sqlcache.yaz("musteri adlari", "SELECT ad FROM musteri")
    assert sqlcache.getir("musteri adlari") == "SELECT ad FROM musteri"

    # kolon yeniden adlandirildi: ad -> unvan
    monkeypatch.setattr(sema_modulu, "schema_to_prompt", lambda: "musteri(id:int, unvan:varchar)")
    assert sqlcache.getir("musteri adlari") is None


def test_sema_ayni_kalirsa_onbellek_korunur(tmp_path, monkeypatch):
    """Sema yenilenip icerigi degismediyse onbellek bosuna dusmemeli."""
    monkeypatch.setattr(sqlcache, "DOSYA", tmp_path / "sql_cache.json")
    monkeypatch.setattr(sema_modulu, "schema_to_prompt", lambda: "musteri(id:int, ad:varchar)")

    sqlcache.yaz("musteri adlari", "SELECT ad FROM musteri")
    assert sqlcache.getir("musteri adlari") == "SELECT ad FROM musteri"
