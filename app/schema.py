"""Veritabani semasini tarar ve yapay zekaya verilecek kompakt metni uretir.

Sema, her istekte yeniden taranmaz; bellekte ve diskte (schema_cache.json)
onbellege alinir. Veritabaninda yapisal degisiklik olursa arayuzden
"Semayi yenile" ile guncellenir.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import settings
from .db import get_connection

__all__ = ["get_schema", "refresh_schema", "schema_to_prompt", "load_notes"]

CACHE_PATH: Path = settings.base_dir / "schema_cache.json"
NOTES_PATH: Path = settings.base_dir / "schema_notes.md"

_bellek_onbellegi: dict[str, Any] | None = None

SATIR_SONU = chr(10)


TABLO_SORGUSU = """
SELECT s.name AS sema, t.name AS tablo,
       CAST(ISNULL(p.rows, 0) AS BIGINT) AS satir_sayisi
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
OUTER APPLY (
    SELECT TOP 1 pa.rows
    FROM sys.partitions pa
    WHERE pa.object_id = t.object_id AND pa.index_id IN (0, 1)
    ORDER BY pa.rows DESC
) p
ORDER BY s.name, t.name
"""

KOLON_SORGUSU = """
SELECT s.name AS sema, t.name AS tablo, c.name AS kolon,
       ty.name AS veri_tipi, c.max_length, c.precision, c.scale,
       c.is_nullable, c.column_id
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
ORDER BY s.name, t.name, c.column_id
"""

PK_SORGUSU = """
SELECT s.name AS sema, t.name AS tablo, c.name AS kolon
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables t ON t.object_id = i.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE i.is_primary_key = 1
ORDER BY s.name, t.name, ic.key_ordinal
"""

FK_SORGUSU = """
SELECT ps.name AS kaynak_sema, pt.name AS kaynak_tablo, pc.name AS kaynak_kolon,
       rs.name AS hedef_sema, rt.name AS hedef_tablo, rc.name AS hedef_kolon
FROM sys.foreign_key_columns fkc
JOIN sys.tables  pt ON pt.object_id = fkc.parent_object_id
JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables  rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY ps.name, pt.name
"""

MYSQL_TABLO_SORGUSU = """
SELECT TABLE_NAME, IFNULL(TABLE_ROWS, 0)
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME
"""

MYSQL_KOLON_SORGUSU = """
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION
"""

MYSQL_FK_SORGUSU = """
SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME
"""

MYSQL_GORUNUM_SORGUSU = """
SELECT TABLE_NAME FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME
"""

GORUNUM_SORGUSU = """
SELECT s.name AS sema, v.name AS gorunum
FROM sys.views v
JOIN sys.schemas s ON s.schema_id = v.schema_id
ORDER BY s.name, v.name
"""


def _tip_metni(veri_tipi: str, max_length: int, precision: int, scale: int) -> str:
    """sys.columns satirini okunabilir bir tip ifadesine cevirir."""
    tip = veri_tipi.lower()
    if tip in {"varchar", "char", "varbinary", "binary"}:
        uzunluk = "max" if max_length == -1 else str(max_length)
        return f"{tip}({uzunluk})"
    if tip in {"nvarchar", "nchar"}:
        uzunluk = "max" if max_length == -1 else str(max_length // 2)
        return f"{tip}({uzunluk})"
    if tip in {"decimal", "numeric"}:
        return f"{tip}({precision},{scale})"
    return tip


def _mysql_sema(cursor) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """MySQL semasini information_schema uzerinden okur."""
    tablolar: dict[str, dict[str, Any]] = {}

    cursor.execute(MYSQL_TABLO_SORGUSU)
    for tablo, satir_sayisi in cursor.fetchall():
        tablolar[tablo] = {
            "schema": "",
            "name": tablo,
            "row_count": int(satir_sayisi or 0),
            "columns": [],
            "primary_key": [],
            "foreign_keys": [],
        }

    cursor.execute(MYSQL_KOLON_SORGUSU)
    for tablo, kolon, kolon_tipi, nullable, anahtar in cursor.fetchall():
        if tablo not in tablolar:
            continue
        tablolar[tablo]["columns"].append(
            {
                "name": kolon,
                # COLUMN_TYPE tam tipi verir: enum('G','PG','R'), decimal(5,2), int unsigned...
                "type": kolon_tipi,
                "nullable": nullable == "YES",
            }
        )
        if anahtar == "PRI":
            tablolar[tablo]["primary_key"].append(kolon)

    cursor.execute(MYSQL_FK_SORGUSU)
    for tablo, kolon, hedef_tablo, hedef_kolon in cursor.fetchall():
        if tablo in tablolar:
            tablolar[tablo]["foreign_keys"].append(
                {
                    "column": kolon,
                    "references": hedef_tablo,
                    "referenced_column": hedef_kolon,
                }
            )

    cursor.execute(MYSQL_GORUNUM_SORGUSU)
    gorunumler = [r[0] for r in cursor.fetchall()]
    return tablolar, gorunumler


def refresh_schema() -> dict[str, Any]:
    """Veritabanini tarar, onbellege yazar ve sema sozlugunu dondurur."""
    global _bellek_onbellegi

    conn = get_connection()
    try:
        cursor = conn.cursor()

        if settings.is_mysql:
            tablolar, gorunumler = _mysql_sema(cursor)
            sema = {
                "database": settings.database_name,
                "db_type": "mysql",
                "tables": list(tablolar.values()),
                "views": gorunumler,
            }
            _bellek_onbellegi = sema
            try:
                CACHE_PATH.write_text(json.dumps(sema, ensure_ascii=False, indent=2), encoding="utf-8")
            except OSError:
                pass
            return sema

        tablolar: dict[str, dict[str, Any]] = {}
        for sema, tablo, satir_sayisi in cursor.execute(TABLO_SORGUSU).fetchall():
            anahtar = f"{sema}.{tablo}"
            tablolar[anahtar] = {
                "schema": sema,
                "name": tablo,
                "row_count": int(satir_sayisi),
                "columns": [],
                "primary_key": [],
                "foreign_keys": [],
            }

        for row in cursor.execute(KOLON_SORGUSU).fetchall():
            anahtar = f"{row.sema}.{row.tablo}"
            if anahtar not in tablolar:
                continue
            tablolar[anahtar]["columns"].append(
                {
                    "name": row.kolon,
                    "type": _tip_metni(row.veri_tipi, row.max_length, row.precision, row.scale),
                    "nullable": bool(row.is_nullable),
                }
            )

        for sema, tablo, kolon in cursor.execute(PK_SORGUSU).fetchall():
            anahtar = f"{sema}.{tablo}"
            if anahtar in tablolar:
                tablolar[anahtar]["primary_key"].append(kolon)

        for row in cursor.execute(FK_SORGUSU).fetchall():
            anahtar = f"{row.kaynak_sema}.{row.kaynak_tablo}"
            if anahtar in tablolar:
                tablolar[anahtar]["foreign_keys"].append(
                    {
                        "column": row.kaynak_kolon,
                        "references": f"{row.hedef_sema}.{row.hedef_tablo}",
                        "referenced_column": row.hedef_kolon,
                    }
                )

        gorunumler = [f"{s}.{v}" for s, v in cursor.execute(GORUNUM_SORGUSU).fetchall()]
    finally:
        conn.rollback()
        conn.close()

    sema = {
        "database": settings.mssql_database,
        "db_type": "mssql",
        "tables": list(tablolar.values()),
        "views": gorunumler,
    }

    _bellek_onbellegi = sema
    try:
        CACHE_PATH.write_text(json.dumps(sema, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # onbellek yazilamazsa bellekteki kopya yeterli

    return sema


def get_schema(force: bool = False) -> dict[str, Any]:
    """Onbellekten sema dondurur; yoksa veritabanini tarar."""
    global _bellek_onbellegi

    if force:
        return refresh_schema()
    if _bellek_onbellegi is not None:
        return _bellek_onbellegi
    if CACHE_PATH.exists():
        try:
            _bellek_onbellegi = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
            if (_bellek_onbellegi.get("database") == settings.database_name
                    and _bellek_onbellegi.get("db_type") == settings.db_type):
                return _bellek_onbellegi
        except (OSError, json.JSONDecodeError):
            pass
    return refresh_schema()


def load_notes() -> str:
    """Is kurallari / terim sozlugu dosyasini okur.

    Once aktif veritabanina ozel dosyayi arar (schema_notes.sakila.md gibi),
    bulamazsa genel schema_notes.md dosyasina duser. Boylece veritabani
    degistirildiginde yanlis terim sozlugu yapay zekaya gonderilmez.
    """
    adaylar = [
        settings.base_dir / f"schema_notes.{settings.database_name}.md",
        NOTES_PATH,
    ]
    for yol in adaylar:
        if yol.exists():
            try:
                return yol.read_text(encoding="utf-8").strip()
            except OSError:
                continue
    return ""


def _kisa_tip(tip: str) -> str:
    """Tipi modele yetecek en kisa hale indirir.

    Uzunluk bilgisi (varchar(128)) sorgu yazarken ise yaramaz; ama tarih,
    ondalik ve enum ayrimi yarar - o yuzden tip adi korunur, parantez atilir.
    """
    t = tip.split("(")[0].strip().lower()
    # enum/set'te gecerli degerler sorgu yazarken birebir kullanilir
    # (ornegin FIND_IN_SET('Deleted Scenes', ...)); bosluklar dahil aynen korunmali.
    if t in {"enum", "set"}:
        return tip
    kisaltma = {
        "smallint unsigned": "int", "tinyint unsigned": "int",
        "mediumint unsigned": "int", "int unsigned": "int", "bigint unsigned": "int",
        "smallint": "int", "tinyint": "int", "mediumint": "int", "bigint": "int",
        "character varying": "varchar", "nvarchar": "varchar", "nchar": "char",
        "datetime": "datetime", "timestamp": "datetime",
    }
    tam = tip.split("(")[0].strip().lower()
    return kisaltma.get(tam, t)


def _kompakt_tablo(tablo: dict[str, Any]) -> str:
    """Tabloyu tek satirda yazar:

    film(film_id:int PK, title:varchar, rental_rate:decimal, rating:enum('G','PG')) ~1000 satir
    """
    tam_ad = f"{tablo['schema']}.{tablo['name']}" if tablo["schema"] else tablo["name"]
    pk = set(tablo["primary_key"])
    fk = {f["column"]: f for f in tablo["foreign_keys"]}

    parcalar = []
    for kolon in tablo["columns"]:
        ad = kolon["name"]
        p = f"{ad}:{_kisa_tip(kolon['type'])}"
        if ad in pk:
            p += " PK"
        if ad in fk:
            p += f" ->{fk[ad]['references']}"
        if kolon["nullable"]:
            p += "?"
        parcalar.append(p)

    satir = f"{tam_ad}({', '.join(parcalar)})"
    if tablo["row_count"]:
        satir += f"  ~{tablo['row_count']} satir"
    return satir


def schema_to_prompt(sema: dict[str, Any] | None = None) -> str:
    """Semayi, sistem mesajina gomulecek kompakt metne cevirir."""
    sema = sema or get_schema()
    lehce = "MySQL 8" if sema.get("db_type") == "mysql" else "MS SQL Server"
    satirlar: list[str] = [f"Veritabani: {sema['database']}  ({lehce})", ""]

    haric = {a.lower() for a in settings.schema_exclude}
    tablolar = [t for t in sema["tables"] if t["name"].lower() not in haric]

    if settings.schema_style == "compact":
        satirlar.append("Tablolar (kolon:tip, PK=birincil anahtar, ->hedef=yabanci anahtar, ?=bos olabilir):")
        for tablo in tablolar:
            satirlar.append("  " + _kompakt_tablo(tablo))
        satirlar.append("")
        if sema.get("views"):
            satirlar.append("GORUNUMLER (VIEW): " + ", ".join(sema["views"]))
            satirlar.append("")
        notlar = load_notes()
        if notlar:
            satirlar.append("--- IS KURALLARI VE TERIM SOZLUGU ---")
            satirlar.append(notlar)
        return SATIR_SONU.join(satirlar).strip()

    for tablo in tablolar:
        tam_ad = f"{tablo['schema']}.{tablo['name']}" if tablo["schema"] else tablo["name"]
        basligi = f"TABLO {tam_ad}  (~{tablo['row_count']:,} satir)".replace(",", ".")
        satirlar.append(basligi)

        pk = set(tablo["primary_key"])
        fk_haritasi = {fk["column"]: fk for fk in tablo["foreign_keys"]}

        for kolon in tablo["columns"]:
            isaretler = []
            if kolon["name"] in pk:
                isaretler.append("PK")
            if kolon["name"] in fk_haritasi:
                fk = fk_haritasi[kolon["name"]]
                isaretler.append(f"FK -> {fk['references']}.{fk['referenced_column']}")
            if not kolon["nullable"]:
                isaretler.append("NOT NULL")
            ek = f"  [{', '.join(isaretler)}]" if isaretler else ""
            satirlar.append(f"  - {kolon['name']}: {kolon['type']}{ek}")
        satirlar.append("")

    if sema.get("views"):
        satirlar.append("GORUNUMLER (VIEW): " + ", ".join(sema["views"]))
        satirlar.append("")

    notlar = load_notes()
    if notlar:
        satirlar.append("--- IS KURALLARI VE TERIM SOZLUGU ---")
        satirlar.append(notlar)
        satirlar.append("")

    return "\n".join(satirlar).strip()
