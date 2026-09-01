"""MS SQL Server baglantisi ve salt-okunur sorgu calistirma."""

from __future__ import annotations

import datetime
import decimal
import uuid
from typing import Any

import pyodbc

from .config import settings
from .sqlguard import validate_sql

__all__ = ["QueryResult", "run_select", "test_connection", "get_connection"]


class QueryResult:
    def __init__(
        self,
        columns: list[str],
        rows: list[list[Any]],
        truncated: bool,
        sql: str,
        duration_ms: int,
    ) -> None:
        self.columns = columns
        self.rows = rows
        self.truncated = truncated
        self.sql = sql
        self.duration_ms = duration_ms

    @property
    def row_count(self) -> int:
        return len(self.rows)

    def to_dict(self) -> dict:
        return {
            "sql": self.sql,
            "columns": self.columns,
            "rows": self.rows,
            "row_count": self.row_count,
            "truncated": self.truncated,
            "duration_ms": self.duration_ms,
        }


def get_connection():
    """Yeni bir MS SQL Server baglantisi acar.

    autocommit=False: her sorgu bir islem icinde calisir ve sonunda geri alinir.
    Salt-okunur guard'a ek bir emniyet katmanidir.
    """
    conn = pyodbc.connect(settings.connection_string, timeout=10, autocommit=False)
    conn.timeout = settings.query_timeout
    return conn


def _jsonlastir(deger: Any) -> Any:
    """pyodbc'nin dondurdugu Python tiplerini JSON'a uygun hale getirir."""
    if deger is None:
        return None
    if isinstance(deger, (str, int, float, bool)):
        return deger
    if isinstance(deger, decimal.Decimal):
        return float(deger)
    if isinstance(deger, (datetime.datetime, datetime.date, datetime.time)):
        return deger.isoformat()
    if isinstance(deger, datetime.timedelta):
        return str(deger)
    if isinstance(deger, uuid.UUID):
        return str(deger)
    if isinstance(deger, (bytes, bytearray)):
        return f"<{len(deger)} bayt ikili veri>"
    return str(deger)


def run_select(sql: str, max_rows: int | None = None) -> QueryResult:
    """SQL'i dogrular, salt-okunur olarak calistirir ve sonucu dondurur.

    Guvenlik katmanlari:
      1. validate_sql  -> sadece tek bir SELECT/WITH ifadesine izin verir
      2. islem geri alma -> baglanti autocommit kapali, sonunda her zaman rollback
      3. satir limiti  -> imleçten en fazla max_rows+1 satir okunur
      4. zaman asimi   -> QUERY_TIMEOUT saniye
    """
    guvenli_sql = validate_sql(sql)
    limit = max_rows if max_rows is not None else settings.max_rows

    baslangic = datetime.datetime.now()
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(guvenli_sql)

        if cursor.description is None:
            # SELECT olmasina ragmen sonuc kumesi yoksa (ornegin sadece SET)
            return QueryResult([], [], False, guvenli_sql, 0)

        columns = [c[0] if c[0] else f"kolon_{i + 1}" for i, c in enumerate(cursor.description)]

        # limit+1 satir cekip fazlaligi tespit ediyoruz.
        ham_satirlar = cursor.fetchmany(limit + 1)
        truncated = len(ham_satirlar) > limit
        if truncated:
            ham_satirlar = ham_satirlar[:limit]

        rows = [[_jsonlastir(h) for h in satir] for satir in ham_satirlar]
    finally:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 - kapanis sirasindaki hata onemsiz
            pass
        conn.close()

    sure = int((datetime.datetime.now() - baslangic).total_seconds() * 1000)
    return QueryResult(columns, rows, truncated, guvenli_sql, sure)


def test_connection() -> dict:
    """Baglantiyi dogrular; arayuzdeki durum gostergesi icin kullanilir."""
    try:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT DB_NAME(), @@VERSION")
            db_adi, surum = cursor.fetchone()
        finally:
            conn.rollback()
            conn.close()
        return {
            "ok": True,
            "database": db_adi,
            "version": str(surum).splitlines()[0].strip(),
            **settings.safe_connection_info,
        }
    except Exception as exc:  # noqa: BLE001 - kullaniciya ham hatayi gostermek istiyoruz
        return {"ok": False, "error": str(exc), **settings.safe_connection_info}
