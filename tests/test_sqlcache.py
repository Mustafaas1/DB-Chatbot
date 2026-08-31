"""Soru -> SQL onbelleginin testleri.

Odak: onbellegin VERISI DEGISEN bir veritabaninda yanlis sonuc uretmemesi.
Sirketin gercek veritabani statik degil; buradaki testler onbellegin eski
veri dondurmesini engelleyen guvenceleri kalici hale getirir.
"""

from __future__ import annotations

import json
import time

import pytest

from pybot import sqlcache


@pytest.fixture(autouse=True)
def gecici_onbellek(tmp_path, monkeypatch):
    """Her test kendi onbellek dosyasiyla calissin; gercek dosyaya dokunma."""
    monkeypatch.setattr(sqlcache, "DOSYA", tmp_path / "sql_cache.json")
    monkeypatch.setattr(sqlcache, "_parmak_izi", lambda: "SEMA1")
    yield


# ------------------------------------------------- en kritik guvence

def test_sonuc_satirlari_asla_saklanmaz():
    """Onbellekte yalnizca sorgu metni olmali.

    Sonuc saklansaydi, veri degistiginde eski satirlar donerdi.
    """
    sqlcache.yaz("kac musteri var", "SELECT COUNT(*) FROM customer")
    ham = json.loads(sqlcache.DOSYA.read_text(encoding="utf-8"))

    kayit = ham["kayitlar"]["kac musteri var"]
    assert set(kayit.keys()) == {"sql", "zaman"}
    # Dosyanin tamaminda satir/sonuc izi olmamali
    metin = sqlcache.DOSYA.read_text(encoding="utf-8").lower()
    for yasak in ("rows", "row_count", "satir", "sonuc", "result"):
        assert yasak not in metin


# ------------------------------------------------- sabit tarih tuzagi

SABIT_TARIHLI = [
    "SELECT * FROM sozlesme WHERE bitis <= '2026-09-24'",
    "SELECT * FROM fatura WHERE tarih BETWEEN '2026-08-01' AND '2026-08-31'",
    "SELECT * FROM r WHERE t > '24.09.2026'",
    "SELECT * FROM r WHERE t = 20260924",
]


@pytest.mark.parametrize("sql", SABIT_TARIHLI)
def test_sabit_tarihli_sorgu_onbellege_alinmaz(sql):
    """'1 ay icinde bitecek sozlesmeler' sorusu sabit tarihe cevrilirse
    yarin yanlis sonuc verir; boyle sorgular saklanmamali."""
    assert sqlcache.yaz("1 ay icinde bitecek sozlesmeler", sql) is False
    assert sqlcache.getir("1 ay icinde bitecek sozlesmeler") is None


GORECELI_TARIHLI = [
    "SELECT * FROM sozlesme WHERE bitis <= CURDATE() + INTERVAL 30 DAY",
    "SELECT * FROM sozlesme WHERE bitis <= DATEADD(day, 30, GETDATE())",
    "SELECT * FROM r WHERE t >= NOW() - INTERVAL 7 DAY",
]


@pytest.mark.parametrize("sql", GORECELI_TARIHLI)
def test_goreceli_tarihli_sorgu_onbellege_alinir(sql):
    """CURDATE()/GETDATE()/NOW() calisma aninda yeniden hesaplanir,
    dolayisiyla saklanmalari guvenlidir."""
    assert sqlcache.yaz("yaklasan sozlesmeler", sql) is True
    assert sqlcache.getir("yaklasan sozlesmeler") == sql


# ------------------------------------------------- sema degisimi

def test_sema_degisince_onbellek_duser(monkeypatch):
    """Kolon silinir/yeniden adlandirilirsa eski SQL patlardi; parmak izi
    degistigi an tum kayitlar gecersiz sayilmali."""
    sqlcache.yaz("kac film var", "SELECT COUNT(*) FROM film")
    assert sqlcache.getir("kac film var") is not None

    monkeypatch.setattr(sqlcache, "_parmak_izi", lambda: "SEMA2")
    assert sqlcache.getir("kac film var") is None


def test_sema_degisince_yeni_yazim_eskileri_temizler(monkeypatch):
    sqlcache.yaz("soru a", "SELECT 1")
    monkeypatch.setattr(sqlcache, "_parmak_izi", lambda: "SEMA2")
    sqlcache.yaz("soru b", "SELECT 2")

    ham = json.loads(sqlcache.DOSYA.read_text(encoding="utf-8"))
    assert ham["parmak_izi"] == "SEMA2"
    assert "soru a" not in ham["kayitlar"]
    assert "soru b" in ham["kayitlar"]


# ------------------------------------------------- omur

def test_suresi_dolan_kayit_kullanilmaz(monkeypatch):
    sqlcache.yaz("eski soru", "SELECT 1")
    monkeypatch.setattr(sqlcache, "_ttl", lambda: 0)
    time.sleep(0.01)
    assert sqlcache.getir("eski soru") is None


# ------------------------------------------------- eslestirme

def test_bosluk_ve_noktalama_farki_ayni_soru_sayilir():
    sqlcache.yaz("En cok kiralanan filmler?", "SELECT 1")
    assert sqlcache.getir("  EN   COK  kiralanan   filmler  ") == "SELECT 1"
    assert sqlcache.getir("en cok kiralanan filmler") == "SELECT 1"


def test_farkli_soru_eslesmez():
    sqlcache.yaz("en cok kiralanan filmler", "SELECT 1")
    assert sqlcache.getir("en az kiralanan filmler") is None


def test_turkce_karakterler_korunur():
    sqlcache.yaz("Kategorilere göre film sayısı", "SELECT 1")
    assert sqlcache.getir("kategorilere göre film sayısı") == "SELECT 1"
    # 't' ve 'n' harfleri normalizasyonda yutulmamali
    assert sqlcache.getir("kaegorilere göre film sayısı") is None


# ------------------------------------------------- kapali mod

def test_kapaliyken_ne_yazar_ne_okur(monkeypatch):
    monkeypatch.setattr(sqlcache, "_acik", lambda: False)
    assert sqlcache.yaz("soru", "SELECT 1") is False
    assert sqlcache.getir("soru") is None


def test_bozuk_dosya_cokmeye_yol_acmaz():
    sqlcache.DOSYA.write_text("{bozuk json", encoding="utf-8")
    assert sqlcache.getir("soru") is None
    assert sqlcache.yaz("soru", "SELECT 1") is True
