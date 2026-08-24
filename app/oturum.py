"""Sohbet oturumlarinin kalici deposu (SQLite).

Neden bellekte degil:
  - Sunucu her yeniden baslatildiginda tum konusmalar siliniyordu
    (--reload acikken her dosya kaydinda oluyordu)
  - Birden fazla worker calistirildiginda her worker'in kendi sozlugu olur
    ve kullanicilar rastgele baglam kaybeder

SQLite secildi: ek bagimlilik yok, dosya tabanli, ayni makinedeki tum
worker'lar ayni veriyi gorur.

ONEMLI: Sistem mesaji SAKLANMAZ. Sistem mesaji veritabani semasini icerir;
saklansaydi, oturum baslamadan sonra sema degistiginde o konusma sonsuza
dek eski semayi kullanirdi. Her istekte guncel semayla yeniden uretiliyor.
Bu ayni zamanda saklanan veriyi ~%86 kucultuyor.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from .config import settings

__all__ = ["getir", "kaydet", "sil", "istatistik", "bakim"]

DOSYA: Path = settings.base_dir / "oturumlar.db"

_kilit = threading.Lock()
_kuruldu = False


def _baglanti() -> sqlite3.Connection:
    global _kuruldu
    conn = sqlite3.connect(DOSYA, timeout=5.0)
    if not _kuruldu:
        # WAL: birden fazla worker ayni dosyaya paralel erisebilsin
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS oturumlar ("
            " id TEXT PRIMARY KEY,"
            " gecmis TEXT NOT NULL,"
            " guncelleme REAL NOT NULL)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_guncelleme ON oturumlar(guncelleme)"
        )
        conn.commit()
        _kuruldu = True
    return conn


def _sistemsiz(gecmis: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sistem mesajini ayiklar; her istekte guncel semayla yeniden uretilir."""
    return [m for m in gecmis if m.get("role") != "system"]


def getir(oturum_id: str) -> list[dict[str, Any]]:
    """Oturumun gecmisini dondurur (sistem mesaji haric). Yoksa bos liste."""
    if not oturum_id:
        return []
    try:
        with _kilit, _baglanti() as conn:
            satir = conn.execute(
                "SELECT gecmis, guncelleme FROM oturumlar WHERE id = ?", (oturum_id,)
            ).fetchone()
    except sqlite3.Error:
        return []
    if not satir:
        return []
    if time.time() - satir[1] > settings.session_ttl:
        sil(oturum_id)
        return []
    try:
        return json.loads(satir[0])
    except json.JSONDecodeError:
        return []


def kaydet(oturum_id: str, gecmis: list[dict[str, Any]]) -> None:
    """Gecmisi saklar. Sistem mesaji bilincli olarak atilir."""
    if not oturum_id:
        return
    veri = json.dumps(_sistemsiz(gecmis), ensure_ascii=False)
    try:
        with _kilit, _baglanti() as conn:
            conn.execute(
                "INSERT INTO oturumlar (id, gecmis, guncelleme) VALUES (?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET gecmis = excluded.gecmis, "
                "guncelleme = excluded.guncelleme",
                (oturum_id, veri, time.time()),
            )
            conn.commit()
    except sqlite3.Error:
        pass  # depo yazilamazsa sohbet yine de calismali


def sil(oturum_id: str) -> None:
    try:
        with _kilit, _baglanti() as conn:
            conn.execute("DELETE FROM oturumlar WHERE id = ?", (oturum_id,))
            conn.commit()
    except sqlite3.Error:
        pass


def bakim() -> int:
    """Suresi dolmus ve sayiyi asan oturumlari siler. Silinen sayisini doner."""
    try:
        with _kilit, _baglanti() as conn:
            sinir = time.time() - settings.session_ttl
            imlec = conn.execute("DELETE FROM oturumlar WHERE guncelleme < ?", (sinir,))
            silinen = imlec.rowcount or 0
            # En yeni N oturumu tut; gerisini dus.
            imlec = conn.execute(
                "DELETE FROM oturumlar WHERE id NOT IN ("
                " SELECT id FROM oturumlar ORDER BY guncelleme DESC LIMIT ?)",
                (settings.max_sessions,),
            )
            silinen += imlec.rowcount or 0
            conn.commit()
            return silinen
    except sqlite3.Error:
        return 0


def istatistik() -> dict[str, Any]:
    try:
        with _kilit, _baglanti() as conn:
            (adet,) = conn.execute("SELECT COUNT(*) FROM oturumlar").fetchone()
    except sqlite3.Error:
        adet = None
    return {
        "oturum_sayisi": adet,
        "ttl_saniye": settings.session_ttl,
        "azami_oturum": settings.max_sessions,
        "depo": "sqlite",
    }
