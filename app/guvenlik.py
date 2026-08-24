"""API kimlik dogrulama.

API_TOKEN bos birakilirsa uclar korumasizdir; bu yalnizca yerel deneme
icindir. Gercek veriyle calisirken mutlaka doldurulmalidir.

SINIR: Tarayiciya gonderilen bir anahtar gizli degildir -- sayfayi
gorebilen herkes onu okuyabilir. Bu koruma, internete acik bir sunucuda
yetkisiz erisimi ve API kotasinin tuketilmesini engeller; portalin kendi
kullanicilarini birbirinden ayirmaz. Kullanici bazli yetki gerekiyorsa
istekler portalin kendi sunucusu uzerinden vekillenmelidir.
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from .config import settings

__all__ = ["dogrula", "koruma_durumu"]


def dogrula(
    authorization: str | None = Header(default=None),
    x_api_token: str | None = Header(default=None),
) -> None:
    """API_TOKEN tanimliysa istegi dogrular."""
    beklenen = settings.api_token
    if not beklenen:
        return  # koruma kapali

    verilen = ""
    if authorization and authorization.lower().startswith("bearer "):
        verilen = authorization[7:].strip()
    elif x_api_token:
        verilen = x_api_token.strip()

    # compare_digest: dogru anahtarin ne kadarinin tuttugu sureden anlasilmasin
    if not verilen or not secrets.compare_digest(verilen, beklenen):
        raise HTTPException(
            status_code=401,
            detail="Gecersiz veya eksik API anahtari. Authorization: Bearer <anahtar> gonderin.",
        )


def koruma_durumu() -> dict[str, bool]:
    return {
        "api_korumali": bool(settings.api_token),
        "ham_sql_acik": settings.allow_raw_sql,
    }
