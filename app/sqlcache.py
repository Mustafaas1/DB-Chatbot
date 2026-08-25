"""Soru -> SQL onbellegi.

TASARIM KARARI (dinamik veritabani icin kritik):
Burada SONUC SATIRLARI SAKLANMAZ. Yalnizca "bu soru icin hangi SQL yazilmali"
bilgisi saklanir. Sorgu her seferinde yeniden calistirilir, dolayisiyla donen
veri her zaman canlidir. Onbellek sadece yapay zeka cagrisini atlatir.

Sonuc onbelleklemek, verisi degisen bir veritabaninda eski/yanlis cevap
uretirdi; bu yuzden bilincli olarak yapilmiyor.

Onbellegin gecersiz kalabilecegi durumlar ve karsiligi:
  1. Sema degisti (kolon eklendi/silindi/yeniden adlandirildi)
     -> anahtar, semanin parmak izini icerir; sema degisince tum kayitlar duser.
  2. SQL icinde sabit tarih var ("son 1 ay" -> WHERE tarih >= '2026-07-24')
     -> boyle sorgular HIC onbellege alinmaz; yarin yanlis sonuc verirlerdi.
        CURDATE()/GETDATE()/NOW() kullanan sorgular guvenlidir, calisma aninda
        yeniden hesaplanirlar.
  3. Is kurallari zamanla degisti
     -> TTL (varsayilan 7 gun) bir emniyet agi olarak kayitlari eskitir.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

from .config import settings

__all__ = ["getir", "yaz", "temizle", "istatistik", "tarihe_bagli"]

DOSYA = Path(__file__).resolve().parent.parent / "sql_cache.json"

# Sabit tarih iceren SQL onbellege alinmaz. Desenlerde ters bolu kullanilmadan
# karakter siniflari tercih edildi.
TARIH_DESENLERI = (
    re.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}"),        # 2026-07-24
    re.compile("[0-9]{2}[/.][0-9]{2}[/.][0-9]{4}"),  # 24.07.2026 / 24/07/2026
    re.compile("[12][0-9]{3}[01][0-9][0-3][0-9]"),    # 20260724
)


def _acik() -> bool:
    return getattr(settings, "sql_cache", True)


def _ttl() -> int:
    return int(getattr(settings, "sql_cache_ttl", 604800))


def tarihe_bagli(sql: str) -> bool:
    """SQL sabit bir tarih iceriyor mu?

    Iceriyorsa sorgu "bugun" kavramini dondurmus demektir ve yarin yanlis
    sonuc verir; onbellege alinmamalidir.
    """
    return any(d.search(sql) for d in TARIH_DESENLERI)


def _parmak_izi() -> str:
    """Sema + veritabani + lehce parmak izi.

    Sema degisirse onbellekteki SQL'ler gecersizdir (silinmis bir kolona
    atifta bulunuyor olabilirler), bu yuzden anahtarin parcasi.
    """
    from .schema import schema_to_prompt  # dairesel import olmasin diye burada

    ham = f"{settings.db_type}|{settings.database_name}|{schema_to_prompt()}"
    return hashlib.sha256(ham.encode("utf-8")).hexdigest()[:16]


def _normalize(soru: str, ajan: str = "") -> str:
    """Sorulari eslestirmek icin sadelestirir: bosluk ve noktalama farklari
    ayni soruyu farkli gostermesin."""
    s = " ".join(soru.split()).lower()   # her turlu bosluk tek bosluga iner
    s = re.sub("[?!.,;:]+$", "", s).strip()
    # Ayni soru farkli bolum ajanlarina farkli SQL urettirebilir; anahtar ayrissin.
    return f"{ajan.strip().lower()}|{s}" if ajan else s


def _yukle() -> dict[str, Any]:
    if not DOSYA.exists():
        return {}
    try:
        return json.loads(DOSYA.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _kaydet(veri: dict[str, Any]) -> None:
    try:
        DOSYA.write_text(json.dumps(veri, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass  # onbellek yazilamazsa sistem calismaya devam etmeli


def getir(soru: str, ajan: str = "") -> str | None:
    """Soruya karsilik gelen SQL'i dondurur; yoksa None.

    Donen SQL cagiran tarafindan yine validate_sql'den gecirilir.
    """
    if not _acik():
        return None
    veri = _yukle()
    if veri.get("parmak_izi") != _parmak_izi():
        return None  # sema degismis, tum kayitlar gecersiz
    kayit = (veri.get("kayitlar") or {}).get(_normalize(soru, ajan))
    if not kayit:
        return None
    if time.time() - kayit.get("zaman", 0) > _ttl():
        return None
    return kayit.get("sql")


def yaz(soru: str, sql: str, ajan: str = "") -> bool:
    """Soru -> SQL eslemesini saklar. Saklandiysa True doner."""
    if not _acik() or not soru.strip() or not sql.strip():
        return False
    if tarihe_bagli(sql):
        return False  # sabit tarihli sorgu; yarin yaniltir

    parmak = _parmak_izi()
    veri = _yukle()
    if veri.get("parmak_izi") != parmak:
        veri = {"parmak_izi": parmak, "kayitlar": {}}
    veri.setdefault("kayitlar", {})[_normalize(soru, ajan)] = {
        "sql": sql,
        "zaman": time.time(),
    }
    _kaydet(veri)
    return True


def temizle() -> None:
    DOSYA.unlink(missing_ok=True)


def istatistik() -> dict[str, Any]:
    veri = _yukle()
    return {
        "acik": _acik(),
        "kayit_sayisi": len(veri.get("kayitlar") or {}),
        "ttl_saniye": _ttl(),
        "sema_parmak_izi": veri.get("parmak_izi"),
        "guncel_mi": veri.get("parmak_izi") == _parmak_izi() if veri else None,
    }
