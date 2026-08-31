"""API kimlik dogrulama testleri.

Gercek sirket verisiyle calisirken /api/* uclarinin korumasiz kalmamasi
gerekir. Bu testler korumanin acilip kapanmasini ve dogru calistigini
guvence altina alir.
"""

from __future__ import annotations

import dataclasses

import pytest
from fastapi import HTTPException

from pybot import guvenlik

ANAHTAR = "gizli-deneme-anahtari-1234567890"


@pytest.fixture
def token_ayarla(monkeypatch):
    def ayarla(deger: str):
        monkeypatch.setattr(
            guvenlik, "settings",
            dataclasses.replace(guvenlik.settings, api_token=deger),
        )
    return ayarla


# ------------------------------------------------- koruma kapali

def test_anahtar_tanimsizsa_herkes_gecer(token_ayarla):
    """Yerel denemede kurulum bozulmasin diye koruma varsayilan olarak kapali."""
    token_ayarla("")
    assert guvenlik.dogrula(authorization=None, x_api_token=None) is None


# ------------------------------------------------- koruma acik

def test_anahtarsiz_istek_reddedilir(token_ayarla):
    token_ayarla(ANAHTAR)
    with pytest.raises(HTTPException) as e:
        guvenlik.dogrula(authorization=None, x_api_token=None)
    assert e.value.status_code == 401


@pytest.mark.parametrize("yanlis", ["yanlis", ANAHTAR[:-1], ANAHTAR + "x", "", "   "])
def test_yanlis_anahtar_reddedilir(token_ayarla, yanlis):
    token_ayarla(ANAHTAR)
    with pytest.raises(HTTPException) as e:
        guvenlik.dogrula(authorization=f"Bearer {yanlis}", x_api_token=None)
    assert e.value.status_code == 401


def test_dogru_bearer_kabul_edilir(token_ayarla):
    token_ayarla(ANAHTAR)
    assert guvenlik.dogrula(authorization=f"Bearer {ANAHTAR}", x_api_token=None) is None


def test_bearer_buyuk_kucuk_harf_duyarsiz(token_ayarla):
    token_ayarla(ANAHTAR)
    assert guvenlik.dogrula(authorization=f"bearer {ANAHTAR}", x_api_token=None) is None
    assert guvenlik.dogrula(authorization=f"BEARER {ANAHTAR}", x_api_token=None) is None


def test_x_api_token_basligi_kabul_edilir(token_ayarla):
    token_ayarla(ANAHTAR)
    assert guvenlik.dogrula(authorization=None, x_api_token=ANAHTAR) is None


def test_bearer_oneki_olmadan_authorization_reddedilir(token_ayarla):
    """Ciplak anahtar Authorization basliginda kabul edilmemeli."""
    token_ayarla(ANAHTAR)
    with pytest.raises(HTTPException):
        guvenlik.dogrula(authorization=ANAHTAR, x_api_token=None)


def test_bosluklar_kirpilir(token_ayarla):
    token_ayarla(ANAHTAR)
    assert guvenlik.dogrula(authorization=f"Bearer  {ANAHTAR}  ", x_api_token=None) is None


# ------------------------------------------------- uctan uca

def test_tum_api_uclari_korumali():
    """Yeni bir /api/* ucu eklenirse korumasiz unutulmasin."""
    from pybot.main import app

    korumasiz = []
    for rota in app.routes:
        yol = getattr(rota, "path", "")
        if not yol.startswith("/api/"):
            continue
        bagimliliklar = [
            getattr(d, "dependency", None) for d in getattr(rota, "dependencies", [])
        ]
        if guvenlik.dogrula not in bagimliliklar:
            korumasiz.append(yol)
    assert not korumasiz, f"korumasiz uclar: {korumasiz}"


def test_ham_sql_varsayilan_kapali():
    from pybot.config import settings
    assert settings.allow_raw_sql is False, "ALLOW_RAW_SQL varsayilan kapali olmali"


def test_koruma_durumu_bildirilir(token_ayarla):
    token_ayarla(ANAHTAR)
    d = guvenlik.koruma_durumu()
    assert d["api_korumali"] is True
    token_ayarla("")
    assert guvenlik.koruma_durumu()["api_korumali"] is False
