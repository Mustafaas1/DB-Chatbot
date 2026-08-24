"""Kalici oturum deposu testleri.

Oturumlar bellekte tutuldugunda sunucu her yeniden baslatildiginda
konusmalar siliniyordu. Bu testler kaliciligi ve -- dinamik veritabani
acisindan onemlisi -- sema tasiyan sistem mesajinin saklanmadigini
guvence altina alir.
"""

from __future__ import annotations

import dataclasses
import time

import pytest

from app import oturum


@pytest.fixture(autouse=True)
def gecici_depo(tmp_path, monkeypatch):
    monkeypatch.setattr(oturum, "DOSYA", tmp_path / "oturumlar.db")
    monkeypatch.setattr(oturum, "_kuruldu", False)
    yield


def ayarla(monkeypatch, **degisiklikler):
    monkeypatch.setattr(
        oturum, "settings", dataclasses.replace(oturum.settings, **degisiklikler)
    )


ORNEK = [
    {"role": "system", "content": "--- VERITABANI SEMASI --- film(...)"},
    {"role": "user", "content": "Kategorilere göre film sayısı"},
    {"role": "assistant", "content": "",
     "tool_calls": [{"id": "a1", "type": "function",
                     "function": {"name": "sql_calistir", "arguments": "{}"}}]},
    {"role": "tool", "tool_call_id": "a1", "name": "sql_calistir", "content": "16 satir"},
    {"role": "assistant", "content": "16 kategori bulundu."},
]


# ------------------------------------------------- en kritik guvence

def test_sistem_mesaji_saklanmaz():
    """Sistem mesaji semayi tasir. Saklansaydi, oturum basladiktan sonra
    sema degistiginde o konusma sonsuza dek eski semayi kullanirdi."""
    oturum.kaydet("o1", ORNEK)
    okunan = oturum.getir("o1")

    assert all(m["role"] != "system" for m in okunan)
    assert len(okunan) == len(ORNEK) - 1
    assert "VERITABANI SEMASI" not in str(okunan)


# ------------------------------------------------- kalicilik

def test_kaydet_getir_turu_bozmaz():
    oturum.kaydet("o1", ORNEK)
    okunan = oturum.getir("o1")

    assert [m["role"] for m in okunan] == ["user", "assistant", "tool", "assistant"]
    assert okunan[0]["content"] == "Kategorilere göre film sayısı"
    assert okunan[1]["tool_calls"][0]["id"] == "a1"
    assert okunan[2]["tool_call_id"] == "a1"


def test_yeni_baglantida_veri_durur():
    """Sunucu yeniden baslasa da (yeni baglanti) gecmis okunabilmeli."""
    oturum.kaydet("o1", ORNEK)
    oturum._kuruldu = False           # yeniden baslatmayi taklit et
    assert len(oturum.getir("o1")) == 4


def test_ayni_oturum_uzerine_yazilir():
    oturum.kaydet("o1", ORNEK)
    oturum.kaydet("o1", ORNEK + [{"role": "user", "content": "ikinci soru"}])
    assert len(oturum.getir("o1")) == 5


def test_olmayan_oturum_bos_doner():
    assert oturum.getir("yok") == []
    assert oturum.getir("") == []


def test_silme():
    oturum.kaydet("o1", ORNEK)
    oturum.sil("o1")
    assert oturum.getir("o1") == []


# ------------------------------------------------- omur ve sinir

def test_suresi_dolan_oturum_dondurulmez(monkeypatch):
    oturum.kaydet("o1", ORNEK)
    ayarla(monkeypatch, session_ttl=0)
    time.sleep(0.01)
    assert oturum.getir("o1") == []


def test_bakim_eski_oturumlari_siler(monkeypatch):
    oturum.kaydet("eski", ORNEK)
    ayarla(monkeypatch, session_ttl=0)
    time.sleep(0.01)
    oturum.bakim()
    ayarla(monkeypatch, session_ttl=86400)
    assert oturum.istatistik()["oturum_sayisi"] == 0


def test_bakim_sayi_sinirini_uygular(monkeypatch):
    ayarla(monkeypatch, max_sessions=3, session_ttl=86400)
    for i in range(6):
        oturum.kaydet(f"o{i}", ORNEK)
        time.sleep(0.005)   # guncelleme damgalari ayrissin
    oturum.bakim()

    assert oturum.istatistik()["oturum_sayisi"] == 3
    # En yeniler kalmali
    assert oturum.getir("o5") != []
    assert oturum.getir("o0") == []


# ------------------------------------------------- dayaniklilik

def test_bozuk_kayit_cokmeye_yol_acmaz():
    oturum.kaydet("o1", ORNEK)
    with oturum._baglanti() as conn:
        conn.execute("UPDATE oturumlar SET gecmis = ? WHERE id = ?", ("{bozuk", "o1"))
        conn.commit()
    assert oturum.getir("o1") == []


def test_istatistik():
    oturum.kaydet("o1", ORNEK)
    d = oturum.istatistik()
    assert d["oturum_sayisi"] == 1
    assert d["depo"] == "sqlite"
