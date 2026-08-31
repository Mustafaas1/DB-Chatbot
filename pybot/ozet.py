"""Portal panosundaki ozet kartlari.

Rakamlar veritabanindan CANLI okunur; sayfaya gomulu sabit deger yoktur.
Yapay zekaya gidilmedigi icin token harcamaz.

Aktif veritabani icin tanim yoksa bos doner ve arayuz o bolumu gizler --
uydurma rakam gosterilmez.
"""

from __future__ import annotations

import time
from typing import Any

from .config import settings
from .db import run_select

__all__ = ["ozet_getir", "onbellegi_bosalt"]

# Canli veritabaninda rakamlar surekli degisir; her sayfa acilisinda
# COUNT(*) calistirmamak icin kisa omurlu bir onbellek.
ONBELLEK_OMRU = 60.0
_onbellek: dict[str, Any] = {}


# Tum sorgular IsDeleted = 0 filtresi kullanir: bu veritabaninda kayitlar
# fiziksel silinmez, isaretlenir. Filtresiz sayilar yanlis cikar.
CRM = {
    "kartlar": [
        {
            "etiket": "Açık Destek Bileti",
            "sql": "SELECT COUNT(*) FROM TicketRecords WHERE IsDeleted=0 AND Asama <> N'Tamamlandı'",
            "alt_sql": "SELECT COUNT(*) FROM TicketRecords WHERE IsDeleted=0",
            "alt_bicim": "toplam {} bilet",
            "dusus": True,
        },
        {
            "etiket": "Açık Teklif",
            "sql": "SELECT COUNT(*) FROM Teklifler WHERE IsDeleted=0 AND Durum IN (N'Teklif', N'Gönderildi')",
            "alt_sql": "SELECT COUNT(*) FROM Teklifler WHERE IsDeleted=0",
            "alt_bicim": "toplam {} teklif",
        },
        {
            "etiket": "Faturalanacak Tutar",
            "sql": "SELECT ROUND(SUM(Tutar), 2) FROM Invoices WHERE IsDeleted=0 AND Durum=N'Faturalanacak'",
            "alt_sql": "SELECT COUNT(*) FROM Invoices WHERE IsDeleted=0 AND Durum=N'Faturalanacak'",
            "alt_bicim": "{} fatura (karışık para birimi)",
        },
        {
            "etiket": "Aktif Sözleşme",
            "sql": "SELECT COUNT(*) FROM ContractRecords WHERE IsDeleted=0",
            "alt_sql": "SELECT COUNT(*) FROM Contacts WHERE IsDeleted=0",
            "alt_bicim": "{} kontak kaydı",
        },
    ],
    "hareketler_sql": """
        SELECT TOP 5
               BiletNo   AS [Bilet No],
               Baslik    AS [Konu],
               Musteri   AS [Musteri],
               Asama     AS [Durum]
        FROM TicketRecords
        WHERE IsDeleted = 0
        ORDER BY OlusturmaTarihi DESC
    """,
}


TANIMLAR: dict[str, dict[str, Any]] = {"gokkusagi_passwordvault": CRM}


def _tek_deger(sql: str) -> Any:
    """Tek hucrelik sorguyu calistirir. run_select uzerinden gittigi icin
    sqlguard dogrulamasindan ve satir/zaman limitlerinden gecer."""
    sonuc = run_select(sql)
    if not sonuc.rows or not sonuc.rows[0]:
        return None
    return sonuc.rows[0][0]


def _kart_uret(tanim: dict[str, Any]) -> dict[str, Any]:
    deger = _tek_deger(tanim["sql"])
    alt = tanim.get("alt_bicim") or ""
    if tanim.get("alt_sql"):
        try:
            alt = alt.format(_bicimle(_tek_deger(tanim["alt_sql"])))
        except Exception:  # noqa: BLE001 - yan bilgi; kart yine de gosterilsin
            alt = ""
    return {
        "etiket": tanim["etiket"],
        "deger": _bicimle(deger) + tanim.get("birim", ""),
        "alt": alt,
        "dusus": bool(tanim.get("dusus")),
    }


def _hucre(deger: Any) -> str:
    """Tablo hucresini okunabilir hale getirir (ISO tarihleri gun.ay.yil saat)."""
    if deger is None:
        return "—"
    metin = str(deger)
    # run_select tarihleri ISO metne cevirir: 2006-02-14T15:16:03
    if len(metin) >= 19 and metin[4] == "-" and metin[7] == "-" and metin[10] in "T ":
        try:
            g, s_ = metin[:10], metin[11:16]
            return f"{g[8:10]}.{g[5:7]}.{g[:4]} {s_}"
        except (IndexError, ValueError):
            return metin
    return metin


def _bicimle(deger: Any) -> str:
    if deger is None:
        return "—"
    if isinstance(deger, int):
        return f"{deger:,}".replace(",", ".")
    if isinstance(deger, float):
        tam = f"{deger:,.2f}".replace(",", "#").replace(".", ",").replace("#", ".")
        return tam
    return str(deger)


def ozet_getir() -> dict[str, Any]:
    """Pano ozetini dondurur. Tanimsiz veritabaninda bos liste doner."""
    ad = settings.database_name.lower()
    tanim = TANIMLAR.get(ad)
    if not tanim:
        return {"tanimli": False, "database": settings.database_name,
                "kartlar": [], "hareketler": None}

    simdi = time.time()
    if _onbellek.get("ad") == ad and simdi - _onbellek.get("zaman", 0) < ONBELLEK_OMRU:
        return _onbellek["veri"]

    kartlar = []
    for kart_tanimi in tanim["kartlar"]:
        try:
            kartlar.append(_kart_uret(kart_tanimi))
        except Exception:  # noqa: BLE001 - bir kart patlarsa digerleri gosterilsin
            continue

    hareketler = None
    if tanim.get("hareketler_sql"):
        try:
            sonuc = run_select(tanim["hareketler_sql"])
            hareketler = {
                "kolonlar": sonuc.columns,
                "satirlar": [[_hucre(h) for h in s] for s in sonuc.rows],
            }
        except Exception:  # noqa: BLE001
            hareketler = None

    veri = {"tanimli": True, "database": settings.database_name,
            "kartlar": kartlar, "hareketler": hareketler}
    _onbellek.update({"ad": ad, "zaman": simdi, "veri": veri})
    return veri


def onbellegi_bosalt() -> None:
    _onbellek.clear()
