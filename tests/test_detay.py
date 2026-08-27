"""Detay (drill-down) sorgu turetimi testleri."""

from __future__ import annotations

import pytest

from app.detay import DetayHatasi, _bolumler, detay_sql_uret

OZET = (
    "SELECT COUNT(*) AS [Bilet Sayisi], [Asama] AS [Asama]\n"
    "FROM [dbo].[TicketRecords]\n"
    "WHERE [IsDeleted] = 0 AND [Asama] <> 'Tamamlandi'\n"
    "GROUP BY [Asama]"
)


def test_bolumler_from_where_group_ayirir():
    bolum = _bolumler(OZET)
    assert bolum["from"] == "[dbo].[TicketRecords]"
    assert bolum["where"] == "[IsDeleted] = 0 AND [Asama] <> 'Tamamlandi'"
    assert bolum["group"] == "[Asama]"


def test_detay_sql_ozet_kosulunu_korur():
    sql = detay_sql_uret(OZET, "Beklemede", 200)
    assert sql.startswith("SELECT TOP 200 *")
    assert "FROM [dbo].[TicketRecords]" in sql
    # Ozetin kendi filtresi kaybolmamali; yoksa detay sayisi grafikle tutmaz.
    assert "([IsDeleted] = 0 AND [Asama] <> 'Tamamlandi')" in sql
    assert "([Asama]) = 'Beklemede'" in sql


def test_detay_sql_tek_tirnagi_ikiler():
    sql = detay_sql_uret(OZET, "O'Brien", 10)
    assert "'O''Brien'" in sql


def test_detay_sql_enjeksiyon_denemesi_metin_sabiti_icinde_kalir():
    sql = detay_sql_uret(OZET, "x'; DROP TABLE T --", 10)
    # Tirnak ikilendigi icin butun yuk tek bir metin sabitinin icindedir.
    assert "'x''; DROP TABLE T --'" in sql
    assert sql.count("'") % 2 == 0


def test_detay_sql_where_yoksa_yalnizca_grup_kosulu():
    sql = detay_sql_uret("SELECT [Durum], COUNT(*) FROM Teklifler GROUP BY [Durum]", "Kazanildi", 5)
    assert sql == "SELECT TOP 5 * FROM Teklifler WHERE ([Durum]) = 'Kazanildi'"


def test_detay_sql_order_by_bolumu_disarida_birakir():
    sql = detay_sql_uret("SELECT [Yil], COUNT(*) FROM T GROUP BY [Yil] ORDER BY [Yil] DESC", 2025, 5)
    assert "ORDER BY" not in sql
    assert "([Yil]) = 2025" in sql


def test_detay_sql_having_bolumu_disarida_birakir():
    sql = detay_sql_uret("SELECT [D], COUNT(*) FROM T GROUP BY [D] HAVING COUNT(*) > 5", "X", 5)
    assert "HAVING" not in sql


def test_detay_sql_alt_sorgudaki_virgul_gruplama_sanilmaz():
    ozet = (
        "SELECT t.[Asama], COUNT(*) FROM [dbo].[T] t "
        "WHERE t.id IN (SELECT id FROM V WHERE k = 'a, b') "
        "GROUP BY t.[Asama]"
    )
    sql = detay_sql_uret(ozet, "Beklemede", 5)
    assert "(t.[Asama]) = 'Beklemede'" in sql


def test_detay_sql_null_deger_is_null_uretir():
    sql = detay_sql_uret("SELECT [D], COUNT(*) FROM T GROUP BY [D]", None, 5)
    assert "([D]) IS NULL" in sql


def test_gruplanmamis_sorgu_reddedilir():
    with pytest.raises(DetayHatasi):
        detay_sql_uret("SELECT * FROM T WHERE x = 1", "a", 5)


def test_cok_kolonlu_gruplama_reddedilir():
    with pytest.raises(DetayHatasi):
        detay_sql_uret("SELECT a, b, COUNT(*) FROM T GROUP BY a, b", "a", 5)


def test_cte_reddedilir():
    with pytest.raises(DetayHatasi):
        detay_sql_uret("WITH k AS (SELECT 1 x) SELECT x, COUNT(*) FROM k GROUP BY x", 1, 5)


def test_cok_uzun_deger_reddedilir():
    with pytest.raises(DetayHatasi):
        detay_sql_uret(OZET, "a" * 400, 5)


def test_uretilen_sql_guvenlik_dogrulamasindan_gecer():
    from app.sqlguard import validate_sql

    # run_select bu dogrulamayi calistiriyor; enjeksiyon denemesi de dahil
    # uretilen sorgu salt-okunur kuralini gecmeli.
    validate_sql(detay_sql_uret(OZET, "Beklemede", 10))
    validate_sql(detay_sql_uret(OZET, "x'; DROP TABLE T --", 10))
