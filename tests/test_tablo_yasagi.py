"""SCHEMA_EXCLUDE_TABLES artik gercek bir erisim yasagi.

Ayar once yalnizca semayi istemden gizliyordu; tablo hala sorgulanabiliyordu.
Yani "X tablosundaki her seyi getir" denince yapay zeka o tabloyu bilmese
bile sorgu calisiyordu. Parola kasasi iceren bir veritabaninda bu gercek bir
acikti. Bu testler yasagin kalici olmasini saglar.
"""

from __future__ import annotations

import dataclasses

import pytest

from app import sqlguard
from app.sqlguard import SqlGuardError, validate_sql

YASAKLI = ["CredentialRecords", "Users", "RefreshTokens"]


@pytest.fixture(autouse=True)
def yasakli_ayar(monkeypatch):
    from app import config

    monkeypatch.setattr(
        config, "settings",
        dataclasses.replace(config.settings, schema_exclude=YASAKLI),
    )
    yield


ATLATMA_DENEMELERI = [
    "SELECT * FROM CredentialRecords",
    "SELECT * FROM credentialrecords",          # kucuk harf
    "SELECT * FROM [CredentialRecords]",        # koseli parantez
    'SELECT * FROM "Users"',                    # cift tirnak
    "SELECT * FROM [dbo].[Users]",              # nitelikli + parantez
    "SELECT * FROM dbo.Users",                  # nitelikli
    "SELECT * FROM dbo . Users",                # nokta cevresinde bosluk
    "SELECT * FROM dbo.[RefreshTokens]",
    "SELECT c.Ad FROM Contacts c JOIN Users u ON u.Id = c.OwnerId",
    "WITH t AS (SELECT * FROM Users) SELECT * FROM t",
]


@pytest.mark.parametrize("sql", ATLATMA_DENEMELERI)
def test_yasakli_tablo_sorgulanamaz(sql):
    with pytest.raises(SqlGuardError) as e:
        validate_sql(sql)
    assert "erisim kapalidir" in str(e.value)


MESRU_SORGULAR = [
    "SELECT COUNT(*) FROM TicketRecords",
    "SELECT * FROM [Invoices] WHERE Total > 100",
    "SELECT c.Ad FROM [dbo].[Contacts] c",
    # Metin sabitinde gecen tablo adi yanlis alarm uretmemeli
    "SELECT * FROM Notifications WHERE Mesaj LIKE '%Users%'",
    # Kolon adinin icinde gecmesi de engellenmemeli
    "SELECT OwnerUserId, UserName FROM Contacts",
]


@pytest.mark.parametrize("sql", MESRU_SORGULAR)
def test_mesru_sorgular_engellenmez(sql):
    assert validate_sql(sql)


def test_yasak_listesi_bossa_her_sey_serbest(monkeypatch):
    """Sakila gibi hassas tablosu olmayan kurulumlarda davranis degismemeli."""
    from app import config

    monkeypatch.setattr(
        config, "settings", dataclasses.replace(config.settings, schema_exclude=[])
    )
    assert validate_sql("SELECT * FROM Users")


def test_yasak_listesi_ayardan_okunur():
    assert sqlguard.yasakli_tablolar() == {t.lower() for t in YASAKLI}


def test_salt_okunur_kurali_hala_gecerli():
    """Yeni yasak, eski guvenceleri golgelememeli."""
    with pytest.raises(SqlGuardError):
        validate_sql("DROP TABLE TicketRecords")
    with pytest.raises(SqlGuardError):
        validate_sql("SELECT * FROM TicketRecords; DROP TABLE x")
