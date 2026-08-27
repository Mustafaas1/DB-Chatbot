"""sqlguard guvenlik katmaninin regresyon testleri.

Bu chatbot kullanicinin yazdigi Turkce sorudan SQL uretip calistiriyor; uretilen
SQL'in ASLA veri degistirememesi projenin tek kritik guvencesi. Buradaki testler
o guvenceyi kalici hale getirir.

Calistirmak icin:  python -m pytest tests/ -q
"""

from __future__ import annotations

import pytest

from app.sqlguard import SqlGuardError, validate_sql


# ---------------------------------------------------------------- izin verilenler

GECERLI_SORGULAR = [
    "SELECT 1",
    "SELECT * FROM film",
    "select title, rating from film where rating = 'PG'",
    "SELECT COUNT(*) FROM customer WHERE active = 1",
    # CTE
    "WITH t AS (SELECT film_id FROM film) SELECT * FROM t",
    # coklu join
    """
    SELECT c.name, COUNT(*) AS adet
    FROM category c
    JOIN film_category fc ON c.category_id = fc.category_id
    GROUP BY c.name
    ORDER BY adet DESC
    """,
    # alt sorgu
    "SELECT * FROM film WHERE film_id IN (SELECT film_id FROM inventory)",
    # pencere fonksiyonu
    "SELECT title, ROW_NUMBER() OVER (ORDER BY title) AS sira FROM film",
]


@pytest.mark.parametrize("sql", GECERLI_SORGULAR)
def test_gecerli_select_kabul_edilir(sql):
    assert validate_sql(sql)


# Yasakli kelimeler metin sabiti ya da kolon adi olarak gectiginde
# YANLIS ALARM verilmemeli. Bunlar gercek hayatta karsimiza cikti.
YANLIS_ALARM_OLMAMALI = [
    # metin sabitinin icinde 'delete' geciyor
    "SELECT * FROM film WHERE description LIKE '%delete%'",
    "SELECT * FROM log WHERE aciklama = 'Guncelleme yapildi'",
    # MSSQL koseli parantez tanimlayicisi
    "SELECT [Deleted], [Update] FROM [Orders]",
    # MySQL geri tirnak tanimlayicisi
    "SELECT `rename`, `call` FROM `lock`",
    # cift tirnakli tanimlayici
    'SELECT "drop" FROM "create"',
    # kolon adinin icinde yasakli kelime geciyor ama tam kelime degil
    "SELECT into_date, updated_at, created_on FROM kayitlar",
]


@pytest.mark.parametrize("sql", YANLIS_ALARM_OLMAMALI)
def test_tirnakli_ve_metin_icindeki_kelimeler_engellenmez(sql):
    assert validate_sql(sql)


# Nitelikli ad denetimi eklendiginde siradan tablo takma adlari (c.name gibi)
# yanlislikla engellenmemeli.
NORMAL_NITELIKLI_ADLAR = [
    "SELECT c.name FROM category c",
    "SELECT f.title, i.inventory_id FROM film f JOIN inventory i ON f.film_id = i.film_id",
    "SELECT dbo.Musteriler.Ad FROM dbo.Musteriler",
]


@pytest.mark.parametrize("sql", NORMAL_NITELIKLI_ADLAR)
def test_siradan_noktali_adlar_engellenmez(sql):
    assert validate_sql(sql)


# ---------------------------------------------------------------- reddedilenler

VERI_DEGISTIREN = [
    "DROP TABLE film",
    "UPDATE film SET title = 'x'",
    "DELETE FROM film",
    "INSERT INTO film (title) VALUES ('x')",
    "TRUNCATE TABLE film",
    "ALTER TABLE film ADD COLUMN x INT",
    "CREATE TABLE yeni (id INT)",
    "GRANT SELECT ON film TO herkes",
    "REVOKE SELECT ON film FROM herkes",
    "MERGE INTO film USING kaynak ON 1=1",
]


@pytest.mark.parametrize("sql", VERI_DEGISTIREN)
def test_veri_degistiren_ifadeler_reddedilir(sql):
    with pytest.raises(SqlGuardError):
        validate_sql(sql)


# SELECT ile baslayip icinde tehlike gizleyen sorgular: en kritik grup,
# cunku "ilk kelime SELECT" kontrolunu gecerler.
SELECT_KILIGINDE = [
    # SELECT ... INTO ile yeni tablo olusturma
    "SELECT * INTO yeni_tablo FROM film",
    # MySQL dosya yazma / okuma
    "SELECT * FROM film INTO OUTFILE '/tmp/c.txt'",
    "SELECT * FROM film INTO DUMPFILE '/tmp/c.bin'",
    "SELECT LOAD_FILE('/etc/passwd')",
    # zaman tabanli saldirilar
    "SELECT BENCHMARK(10000000, MD5('a'))",
    "SELECT SLEEP(10)",
    "SELECT 1; WAITFOR DELAY '00:00:10'",
    # sistem prosedurleri
    "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')",
    "EXEC xp_cmdshell 'dir'",
    # Nitelikli (noktali) sistem prosedur adlari. KELIME deseni nokta icermedigi
    # icin bunlar bir donem denetimden kaciyordu; regresyon olmasin diye burada.
    "SELECT * FROM sys.sp_who",
    "SELECT * FROM sys . sp_who",
    "SELECT * FROM dbo.xp_cmdshell",
]


@pytest.mark.parametrize("sql", SELECT_KILIGINDE)
def test_select_kiligindeki_tehlikeler_reddedilir(sql):
    with pytest.raises(SqlGuardError):
        validate_sql(sql)


COKLU_IFADE = [
    "SELECT 1; DROP TABLE film",
    "SELECT 1; DELETE FROM film",
    "SELECT * FROM film; SELECT * FROM actor",
]


@pytest.mark.parametrize("sql", COKLU_IFADE)
def test_birden_fazla_ifade_reddedilir(sql):
    with pytest.raises(SqlGuardError):
        validate_sql(sql)


def test_yorum_icine_gizlenen_ifade_ilk_kelimeyi_degistiremez():
    # Yorum temizlendikten sonra geriye DROP kaliyor -> reddedilmeli
    with pytest.raises(SqlGuardError):
        validate_sql("/* SELECT */ DROP TABLE film")


@pytest.mark.parametrize("sql", ["", "   ", "\n\t "])
def test_bos_sorgu_reddedilir(sql):
    with pytest.raises(SqlGuardError):
        validate_sql(sql)


@pytest.mark.parametrize("sql", ["SHOW TABLES", "DESCRIBE film", "EXPLAIN SELECT 1"])
def test_select_disi_baslangic_reddedilir(sql):
    with pytest.raises(SqlGuardError):
        validate_sql(sql)


# ---------------------------------------------------------------- normalizasyon

def test_markdown_bloklari_temizlenir():
    assert validate_sql("```sql\nSELECT 1\n```") == "SELECT 1"
    assert validate_sql("```\nSELECT 1\n```") == "SELECT 1"


def test_sondaki_noktali_virgul_atilir():
    assert validate_sql("SELECT 1;") == "SELECT 1"


def test_bosluklar_kirpilir():
    assert validate_sql("   SELECT 1   ") == "SELECT 1"


# --- Yorum/metin sabiti sirasi (regresyon) -------------------------------
# Maskeleme eskiden once yorumlari, sonra metin sabitlerini temizliyordu.
# Bu yuzden metin sabitinin ICINDEKI "--" gercek yorum sanilip satirin geri
# kalani siliniyor, arkasindaki ";" ve DROP taramaya hic ulasmiyordu.

@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM T WHERE a = 'x--' ; DROP TABLE U",
        "SELECT * FROM T WHERE a = 'x--'; UPDATE T SET a = 1",
        "SELECT * FROM T WHERE a = 'x/*' ; DROP TABLE U /*'*/",
        "SELECT * FROM T WHERE a = 'x--' AND b = 1 ; DELETE FROM U",
    ],
)
def test_metin_sabitindeki_yorum_isareti_ikinci_ifadeyi_gizleyemez(sql):
    with pytest.raises(SqlGuardError):
        validate_sql(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM T WHERE [Baslik] = 'A -- B'",
        "SELECT * FROM T WHERE [Baslik] = 'A -- B' AND x = 1",
        "SELECT COUNT(*) FROM [dbo].[T] -- adet\nWHERE [IsDeleted] = 0",
        "SELECT /* not */ [Order] FROM T WHERE n = 'it''s ok'",
    ],
)
def test_masum_yorum_ve_metin_sabitleri_kabul_edilir(sql):
    validate_sql(sql)
