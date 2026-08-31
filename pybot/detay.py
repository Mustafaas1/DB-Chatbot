"""Özet sorgudan detay (drill-down) sorgusu türetir ve çalıştırır.

Grafikteki bir çubuğa ("Beklemede", "İşlemde" ...) tıklandığında o gruba
giren ham kayıtları listelemek için kullanılır.

ÖNEMLİ - güvenlik: özet SQL istemciden GELMEZ. Adım çalıştığında sunucuda
saklanır; istemci yalnızca oturum kimliği + adım sırası + tıklanan değeri
gönderir. Aksi halde ALLOW_RAW_SQL kapalıyken bile istemci serbest SELECT
çalıştırabilirdi. Türetilen sorgu ayrıca run_select içinde validate_sql'den
geçer, yani salt-okunur kuralları burada da geçerlidir.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from typing import Any

from .config import settings
from .db import QueryResult, run_select
from .oturum import DOSYA

__all__ = ["DetayHatasi", "sql_kaydet", "sql_getir", "detay_getir", "detay_sql_uret"]


class DetayHatasi(Exception):
    """Detay sorgusu türetilemedi veya saklanan sorgu bulunamadı."""


# --------------------------------------------------------------------------
# Adım sorgularının saklanması (oturumlarla aynı SQLite dosyası)
# --------------------------------------------------------------------------

_kilit = threading.Lock()
_kuruldu = False


def _baglanti() -> sqlite3.Connection:
    global _kuruldu
    conn = sqlite3.connect(DOSYA, timeout=5.0)
    if not _kuruldu:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS adim_sorgulari ("
            " oturum TEXT NOT NULL,"
            " sira INTEGER NOT NULL,"
            " sorgu TEXT NOT NULL,"
            " guncelleme REAL NOT NULL,"
            " PRIMARY KEY (oturum, sira))"
        )
        conn.commit()
        _kuruldu = True
    return conn


def sql_kaydet(oturum: str, sira: int, sorgu: str | None) -> None:
    """Bir adımın ürettiği özet SQL'i saklar (detay listesi için gerekli)."""
    if not oturum or not sorgu:
        return
    simdi = time.time()
    with _kilit:
        conn = _baglanti()
        try:
            conn.execute(
                "INSERT INTO adim_sorgulari (oturum, sira, sorgu, guncelleme)"
                " VALUES (?, ?, ?, ?)"
                " ON CONFLICT(oturum, sira) DO UPDATE SET"
                " sorgu = excluded.sorgu, guncelleme = excluded.guncelleme",
                (oturum, int(sira), sorgu, simdi),
            )
            # Oturumlarla aynı ömür: süresi dolanları temizle.
            conn.execute(
                "DELETE FROM adim_sorgulari WHERE guncelleme < ?",
                (simdi - settings.session_ttl,),
            )
            conn.commit()
        finally:
            conn.close()


def sql_getir(oturum: str, sira: int) -> str | None:
    if not oturum:
        return None
    with _kilit:
        conn = _baglanti()
        try:
            satir = conn.execute(
                "SELECT sorgu FROM adim_sorgulari WHERE oturum = ? AND sira = ?",
                (oturum, int(sira)),
            ).fetchone()
        finally:
            conn.close()
    return satir[0] if satir else None


# --------------------------------------------------------------------------
# Özet SQL'i parçalama
# --------------------------------------------------------------------------

# Bir bölümü sonlandıran üst düzey anahtar kelimeler.
BITIRENLER = (
    "where", "group", "having", "order", "union", "except",
    "intersect", "option", "for", "offset", "limit",
)


def _maskele(sql: str) -> str:
    """Metin sabitlerini, tırnaklı tanımlayıcıları ve yorumları maskeler.

    Maskeleme uzunluğu korur; böylece maskeli metinde bulunan konumlar HAM
    sql üzerinde birebir geçerlidir. Amaç: [Order] adında bir kolonun ya da
    içinde 'group' geçen bir metin sabitinin anahtar kelime sanılmaması.
    """
    cikti = list(sql)
    n = len(sql)
    i = 0
    while i < n:
        c = sql[i]
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            for k in range(i, min(j + 1, n)):
                cikti[k] = "x"
            i = j + 1
            continue
        if c in ("[", '"', "`"):
            kapanis = "]" if c == "[" else c
            j = sql.find(kapanis, i + 1)
            if j == -1:
                j = n - 1
            for k in range(i, j + 1):
                cikti[k] = "x"
            i = j + 1
            continue
        if c == "-" and i + 1 < n and sql[i + 1] == "-":
            j = sql.find("\n", i)
            if j == -1:
                j = n
            for k in range(i, j):
                cikti[k] = " "
            i = j
            continue
        if c == "/" and i + 1 < n and sql[i + 1] == "*":
            j = sql.find("*/", i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                cikti[k] = " "
            i = j
            continue
        i += 1
    return "".join(cikti)


def _ust_duzey_kelimeler(maskeli: str) -> list[tuple[int, int, str]]:
    """Parantez dışındaki kelimeleri (baslangic, bitis, kucuk_harf) döner."""
    derinlik = 0
    bulunan: list[tuple[int, int, str]] = []
    for m in re.finditer(r"[()]|[A-Za-z_][A-Za-z0-9_]*", maskeli):
        p = m.group(0)
        if p == "(":
            derinlik += 1
        elif p == ")":
            derinlik -= 1
        elif derinlik == 0:
            bulunan.append((m.start(), m.end(), p.lower()))
    return bulunan


def _ust_duzey_virgul_var_mi(maskeli_parca: str) -> bool:
    derinlik = 0
    for c in maskeli_parca:
        if c == "(":
            derinlik += 1
        elif c == ")":
            derinlik -= 1
        elif c == "," and derinlik == 0:
            return True
    return False


def _bolumler(sql: str) -> dict[str, str]:
    """Özet sorgudan FROM / WHERE / GROUP BY parçalarını çıkarır."""
    maskeli = _maskele(sql)
    kelimeler = _ust_duzey_kelimeler(maskeli)

    def sonraki_bitis(indeks: int) -> int:
        for bas, _bit, kelime in kelimeler[indeks:]:
            if kelime in BITIRENLER:
                return bas
        return len(sql)

    bolum = {"from": "", "where": "", "group": "", "group_maskeli": ""}

    for n, (_bas, bit, kelime) in enumerate(kelimeler):
        if kelime == "from" and not bolum["from"]:
            bolum["from"] = sql[bit:sonraki_bitis(n + 1)].strip()
        elif kelime == "where" and not bolum["where"]:
            bolum["where"] = sql[bit:sonraki_bitis(n + 1)].strip()
        elif kelime == "group" and not bolum["group"]:
            # "GROUP BY" olmalı; tek başına GROUP anlamsız.
            if n + 1 >= len(kelimeler) or kelimeler[n + 1][2] != "by":
                continue
            by_bitis = kelimeler[n + 1][1]
            son = sonraki_bitis(n + 2)
            bolum["group"] = sql[by_bitis:son].strip()
            bolum["group_maskeli"] = maskeli[by_bitis:son].strip()

    return bolum


def _deger_kosulu(ifade: str, deger: Any) -> str:
    """Tıklanan grup değeri için WHERE koşulu üretir."""
    if deger is None:
        return "(" + ifade + ") IS NULL"
    if isinstance(deger, bool):
        return "(" + ifade + ") = " + ("1" if deger else "0")
    if isinstance(deger, (int, float)):
        return "(" + ifade + ") = " + repr(deger)
    metin = str(deger)
    if len(metin) > 300:
        raise DetayHatasi("Filtre değeri çok uzun.")
    # Tek tırnak ikilenir: SQL'in kendi kaçış kuralı. Üretilen sorgu ayrıca
    # validate_sql'den geçtiği için metin sabiti içindeki her şey maskelenir.
    return "(" + ifade + ") = '" + metin.replace("'", "''") + "'"


def detay_sql_uret(ozet_sql: str, deger: Any, limit: int) -> str:
    """Gruplanmış özet sorgudan tek gruba ait ham satırları getiren SQL üretir."""
    if not ozet_sql or not ozet_sql.strip():
        raise DetayHatasi("Özet sorgu bulunamadı.")

    if re.match(r"\s*with\b", ozet_sql, re.IGNORECASE):
        raise DetayHatasi(
            "Bu sonuç CTE (WITH) içeren bir sorgudan geliyor; detay listesi türetilemiyor. "
            "Asistana doğrudan \"Beklemede aşamasındaki biletleri listele\" diye sorabilirsiniz."
        )

    bolum = _bolumler(ozet_sql)
    if not bolum["from"]:
        raise DetayHatasi("Özet sorguda FROM bölümü bulunamadı.")
    if not bolum["group"]:
        raise DetayHatasi(
            "Bu sonuç gruplanmış bir sorgudan gelmiyor, dolayısıyla altında "
            "listelenecek ayrı kayıtlar yok."
        )
    if _ust_duzey_virgul_var_mi(bolum["group_maskeli"]):
        raise DetayHatasi(
            "Birden fazla kolona göre gruplanmış sonuçlarda detay listesi desteklenmiyor."
        )

    kosullar = []
    if bolum["where"]:
        kosullar.append("(" + bolum["where"] + ")")
    kosullar.append(_deger_kosulu(bolum["group"], deger))

    govde = " FROM " + bolum["from"] + " WHERE " + " AND ".join(kosullar)
    if settings.is_mysql:
        return "SELECT *" + govde + " LIMIT " + str(int(limit))
    return "SELECT TOP " + str(int(limit)) + " *" + govde


def detay_getir(oturum: str, sira: int, deger: Any, limit: int | None = None) -> QueryResult:
    """Saklanan özet sorgudan detay satırlarını çalıştırıp döner."""
    ozet = sql_getir(oturum, sira)
    if not ozet:
        raise DetayHatasi(
            "Bu adımın sorgusu artık saklanmıyor (oturum süresi dolmuş olabilir). "
            "Soruyu yeniden sorun."
        )
    # Detay listesi kendi sinirini kullanir (DETAY_MAX_ROWS); MAX_ROWS ozet
    # sorgular icindir ve bir grubun tamamini gostermeye yetmeyebilir.
    tavan = settings.detay_max_rows
    sinir = min(int(limit or tavan), tavan)
    return run_select(detay_sql_uret(ozet, deger, sinir), max_rows=sinir)
