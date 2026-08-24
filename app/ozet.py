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


SAKILA = {
    "kartlar": [
        {
            "etiket": "Aktif Müşteri",
            "sql": "SELECT COUNT(*) FROM customer WHERE active = 1",
            "alt_sql": "SELECT COUNT(*) FROM customer",
            "alt_bicim": "{} kayıtlı müşteri",
        },
        {
            "etiket": "Katalogdaki Film",
            "sql": "SELECT COUNT(*) FROM film",
            "alt_sql": "SELECT COUNT(*) FROM category",
            "alt_bicim": "{} kategori",
        },
        {
            "etiket": "Toplam Tahsilat",
            "sql": "SELECT ROUND(SUM(amount), 2) FROM payment",
            "birim": " $",
            "alt_sql": "SELECT COUNT(*) FROM payment",
            "alt_bicim": "{} ödeme",
        },
        {
            "etiket": "İade Edilmemiş",
            "sql": "SELECT COUNT(*) FROM rental WHERE return_date IS NULL",
            "alt_bicim": "takip gerekiyor",
            "dusus": True,
        },
    ],
    "hareketler_sql": """
        SELECT CONCAT(c.first_name, ' ', c.last_name) AS Musteri,
               f.title AS Film,
               r.rental_date AS Tarih,
               CASE WHEN r.return_date IS NULL THEN 'Dışarıda' ELSE 'İade edildi' END AS Durum
        FROM rental r
        JOIN customer c ON c.customer_id = r.customer_id
        JOIN inventory i ON i.inventory_id = r.inventory_id
        JOIN film f ON f.film_id = i.film_id
        ORDER BY r.rental_date DESC
        LIMIT 5
    """,
}

TANIMLAR: dict[str, dict[str, Any]] = {"sakila": SAKILA}


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
