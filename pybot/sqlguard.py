"""Yapay zekanin urettigi SQL'i calistirmadan once dogrulayan guvenlik katmani.

Kural: sadece okuma. Veriyi degistirebilecek hicbir ifadeye izin verilmez.
"""

from __future__ import annotations

import re

__all__ = ["SqlGuardError", "validate_sql", "yasakli_tablolar"]


class SqlGuardError(Exception):
    """SQL guvenlik dogrulamasindan gecemedi."""


# Veriyi/semayi degistirebilecek veya sunucuda komut calistirabilecek anahtar kelimeler.
YASAKLI_KELIMELER = {
    "insert", "update", "delete", "merge", "truncate", "drop", "alter",
    "create", "grant", "revoke", "deny", "exec", "execute", "sp_executesql",
    "backup", "restore", "shutdown", "reconfigure", "openrowset", "opendatasource",
    "openquery", "bulk", "waitfor", "kill", "dbcc", "into",
    # Diger lehcelerden gelebilecek tehlikeli ifadeler; savunma derinligi
    # icin listede tutuluyor.
    "load", "outfile", "dumpfile", "load_file", "benchmark", "sleep",
    "handler", "lock", "unlock", "rename", "call", "do", "prepare",
}

# Tehlikeli uzantili sistem prosedurleri (xp_cmdshell gibi).
YASAKLI_ONEKLER = ("xp_", "sp_oa", "sys.sp_")

# Geri tirnakli tanimlayici: `tablo_adi`
GERI_TIRNAK_TANIMLAYICI = re.compile(r"`[^`]*`")

YORUM_BLOK = re.compile(r"/\*.*?\*/", re.DOTALL)
YORUM_SATIR = re.compile(r"--[^\n]*")
STRING_LITERAL = re.compile(r"'(?:[^']|'')*'")
# [Deleted] veya "Deleted" seklinde tirnaklanmis tanimlayicilar: bunlar kolon/tablo
# adidir, SQL komutu degildir.
KOSELI_TANIMLAYICI = re.compile(r"\[[^\]]*\]")
CIFT_TIRNAK_TANIMLAYICI = re.compile(r'"[^"]*"')
KELIME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# sys.sp_who / dbo.xp_cmdshell gibi nitelikli adlar. KELIME nokta icermedigi
# icin bunlari ayri taramak gerekir; aksi halde "sys.sp_" oneki hicbir zaman
# eslesmez. Nokta cevresinde bosluk birakilarak da yazilabilir.
NITELIKLI_AD = re.compile(
    r"[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)+"
)


def _yorumlari_ve_metinleri_temizle(sql: str) -> str:
    """Anahtar kelime taramasi icin yorumlari, metinleri ve tirnaklanmis
    tanimlayicilari zararsiz doldurmaya cevirir.

    Boylece 'Guncelleme Tarihi' gibi bir metin sabiti ya da [Deleted] / `rename`
    adinda bir kolon yanlislikla yasakli kelime olarak algilanmaz.

    TEK GECISTE, soldan saga taranir. Onceden her tur ayri bir duzenli ifadeyle
    ve sirayla temizleniyordu; yorum temizligi metin sabitlerinden ONCE
    calistigi icin metin sabitinin ICINDEKI bir "--" gercek yorum sanilip
    satirin geri kalani siliniyordu. Bu, arkasindaki gercek SQL'i de
    goturuyordu:

        SELECT * FROM T WHERE a = 'x--' ; DROP TABLE U

    burada ";" ve "DROP" taramaya hic ulasmiyor, sorgu gecerli sayiliyordu.
    Tek gecis, tirnak ve yorum sinirlarini gercek SQL gibi yorumlar.
    """
    cikti: list[str] = []
    n = len(sql)
    i = 0
    while i < n:
        c = sql[i]

        # Metin sabiti: '...' ('' ikilenmis tirnaktir, sabiti bitirmez)
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            # Kapanmamis tirnak: kalanin tamami sabit sayilir. Gecersiz SQL
            # zaten veritabaninda hata verir; burada sessizce acilmamali.
            cikti.append(" '' ")
            i = (j + 1) if j < n else n
            continue

        # Tirnaklanmis tanimlayici: [x] / "x" / `x`
        if c in ("[", '"', "`"):
            kapanis = "]" if c == "[" else c
            j = sql.find(kapanis, i + 1)
            cikti.append(" _id_ ")
            i = (j + 1) if j != -1 else n
            continue

        # Satir yorumu
        if c == "-" and i + 1 < n and sql[i + 1] == "-":
            j = sql.find("\n", i)
            cikti.append(" ")
            i = n if j == -1 else j
            continue

        # Blok yorumu
        if c == "/" and i + 1 < n and sql[i + 1] == "*":
            j = sql.find("*/", i + 2)
            cikti.append(" ")
            i = n if j == -1 else j + 2
            continue

        cikti.append(c)
        i += 1

    return "".join(cikti)


def _ifade_sayisi(temiz_sql: str) -> int:
    """Noktali virgulle ayrilmis kac ayri ifade var."""
    parcalar = [p.strip() for p in temiz_sql.split(";")]
    return len([p for p in parcalar if p])


def yasakli_tablolar() -> set[str]:
    """Sorgulanmasi tamamen yasak tablolar (SCHEMA_EXCLUDE_TABLES).

    Bu ayar once yalnizca semayi istemden gizliyordu; tabloyu SORGULAMAYI
    engellemiyordu. Yani kullanici "X tablosundaki her seyi getir" derse
    yapay zeka o tabloyu bilmese bile sorguyu yazabilirdi. Parola kasasi
    gibi tablolarda bu gercek bir acikti; artik dogrulama katmaninda
    reddediliyor.
    """
    from .config import settings

    return {a.strip().lower() for a in settings.schema_exclude if a.strip()}


def validate_sql(sql: str) -> str:
    """SQL'i dogrular ve normalize edilmis halini dondurur.

    Gecersizse SqlGuardError firlatir.
    """
    if not sql or not sql.strip():
        raise SqlGuardError("Bos SQL sorgusu.")

    sql = sql.strip()

    # Model bazen ```sql ... ``` bloguyla dondurebilir; temizle.
    if sql.startswith("```"):
        sql = re.sub(r"^```[a-zA-Z]*\s*", "", sql)
        sql = re.sub(r"\s*```$", "", sql).strip()

    temiz = _yorumlari_ve_metinleri_temizle(sql)

    if _ifade_sayisi(temiz) > 1:
        raise SqlGuardError(
            "Tek seferde yalnizca bir SELECT ifadesi calistirilabilir. "
            "Noktali virgulle ayrilmis birden fazla ifade tespit edildi."
        )

    # Ilk anlamli kelime SELECT veya WITH (CTE) olmali.
    ilk = KELIME.search(temiz)
    if not ilk or ilk.group(0).lower() not in {"select", "with"}:
        raise SqlGuardError(
            "Yalnizca SELECT (veya WITH ile baslayan CTE) sorgularina izin verilir."
        )

    kelimeler = {k.lower() for k in KELIME.findall(temiz)}

    yasakli = sorted(kelimeler & YASAKLI_KELIMELER)
    if yasakli:
        raise SqlGuardError(
            f"Yasakli SQL ifadesi tespit edildi: {', '.join(yasakli).upper()}. "
            "Bu chatbot yalnizca veri okuyabilir."
        )

    # Hem yalin (xp_cmdshell) hem nitelikli (sys.sp_who) adlari denetle.
    nitelikli = {
        re.sub(r"\s*\.\s*", ".", ad).lower()
        for ad in NITELIKLI_AD.findall(temiz)
    }
    # Yoneticinin kapattigi tablolar sorgulanamaz. SCHEMA_EXCLUDE_TABLES
    # once yalnizca semayi istemden gizliyordu; tablo yine sorgulanabiliyordu.
    yasak = yasakli_tablolar()
    if yasak:
        # Nitelikli adin son parcasi da denetlenir: "dbo.Users" -> "users"
        adaylar = set(kelimeler)
        adaylar |= {ad.rsplit(".", 1)[-1] for ad in nitelikli}
        # Tirnaklanmis tanimlayicilar ([X], "X", `X`) tarama oncesi _id_ ile
        # degistiriliyor; yasakli tablo boyle yazilarak gizlenebilirdi.
        # Bu yuzden HAM sql'den ayrica cikariliyorlar.
        for desen in (KOSELI_TANIMLAYICI, CIFT_TIRNAK_TANIMLAYICI, GERI_TIRNAK_TANIMLAYICI):
            for ham_ad in desen.findall(sql):
                adaylar.add(ham_ad.strip("[]\"`").strip().lower())
        dokunulan = sorted(adaylar & yasak)
        if dokunulan:
            raise SqlGuardError(
                "Bu tabloya erisim kapalidir: "
                + ", ".join(dokunulan)
                + ". Bu tablo sorgulanabilir tablolar disinda birakilmistir."
            )

    for ad in sorted(kelimeler | nitelikli):
        if ad.startswith(YASAKLI_ONEKLER):
            raise SqlGuardError(f"Yasakli sistem proseduru: {ad}")

    return sql.rstrip(";").strip()
