"""Gercek sema baglanana kadar test icin ornek bir sirket veritabani olusturur.

Calistirma:
    python scripts/demo_veritabani.py

Olusturulan tablolar: Musteriler, Temsilciler, Sozlesmeler, Faturalar, Urunler,
SozlesmeKalemleri, DestekTalepleri.
"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

import pyodbc

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pybot.config import settings  # noqa: E402

DB_ADI = settings.mssql_database

DDL = """
CREATE TABLE dbo.Temsilciler (
    TemsilciID   INT IDENTITY(1,1) PRIMARY KEY,
    AdSoyad      NVARCHAR(100) NOT NULL,
    Bolge        NVARCHAR(50)  NOT NULL,
    Email        NVARCHAR(120) NULL,
    IseGirisTarihi DATE NOT NULL
);

CREATE TABLE dbo.Musteriler (
    MusteriID    INT IDENTITY(1,1) PRIMARY KEY,
    Unvan        NVARCHAR(150) NOT NULL,
    VergiNo      NVARCHAR(20)  NULL,
    Sehir        NVARCHAR(50)  NOT NULL,
    Sektor       NVARCHAR(60)  NOT NULL,
    Telefon      NVARCHAR(30)  NULL,
    Email        NVARCHAR(120) NULL,
    TemsilciID   INT NULL REFERENCES dbo.Temsilciler(TemsilciID),
    KayitTarihi  DATE NOT NULL,
    Aktif        BIT NOT NULL DEFAULT 1
);

CREATE TABLE dbo.Urunler (
    UrunID       INT IDENTITY(1,1) PRIMARY KEY,
    UrunAdi      NVARCHAR(120) NOT NULL,
    Kategori     NVARCHAR(60)  NOT NULL,
    BirimFiyat   DECIMAL(18,2) NOT NULL
);

CREATE TABLE dbo.Sozlesmeler (
    SozlesmeID     INT IDENTITY(1,1) PRIMARY KEY,
    SozlesmeNo     NVARCHAR(30)  NOT NULL UNIQUE,
    MusteriID      INT NOT NULL REFERENCES dbo.Musteriler(MusteriID),
    BaslangicTarihi DATE NOT NULL,
    BitisTarihi    DATE NOT NULL,
    YillikTutar    DECIMAL(18,2) NOT NULL,
    ParaBirimi     NVARCHAR(3) NOT NULL DEFAULT 'TRY',
    Durum          NVARCHAR(20) NOT NULL,   -- Aktif / Beklemede / Iptal / Sona Erdi
    OtomatikYenileme BIT NOT NULL DEFAULT 0
);

CREATE TABLE dbo.SozlesmeKalemleri (
    KalemID     INT IDENTITY(1,1) PRIMARY KEY,
    SozlesmeID  INT NOT NULL REFERENCES dbo.Sozlesmeler(SozlesmeID),
    UrunID      INT NOT NULL REFERENCES dbo.Urunler(UrunID),
    Adet        INT NOT NULL,
    BirimFiyat  DECIMAL(18,2) NOT NULL
);

CREATE TABLE dbo.Faturalar (
    FaturaID      INT IDENTITY(1,1) PRIMARY KEY,
    FaturaNo      NVARCHAR(30) NOT NULL UNIQUE,
    MusteriID     INT NOT NULL REFERENCES dbo.Musteriler(MusteriID),
    SozlesmeID    INT NULL REFERENCES dbo.Sozlesmeler(SozlesmeID),
    FaturaTarihi  DATE NOT NULL,
    VadeTarihi    DATE NOT NULL,
    Tutar         DECIMAL(18,2) NOT NULL,
    OdenenTutar   DECIMAL(18,2) NOT NULL DEFAULT 0,
    OdemeDurumu   NVARCHAR(20) NOT NULL   -- Odendi / Bekliyor / Gecikmis
);

CREATE TABLE dbo.DestekTalepleri (
    TalepID      INT IDENTITY(1,1) PRIMARY KEY,
    MusteriID    INT NOT NULL REFERENCES dbo.Musteriler(MusteriID),
    Konu         NVARCHAR(200) NOT NULL,
    Oncelik      NVARCHAR(20) NOT NULL,  -- Dusuk / Orta / Yuksek / Kritik
    Durum        NVARCHAR(20) NOT NULL,  -- Acik / Islemde / Kapali
    AcilisTarihi DATE NOT NULL,
    KapanisTarihi DATE NULL
);
"""

SEHIRLER = ["Istanbul", "Ankara", "Izmir", "Bursa", "Antalya", "Konya", "Adana", "Gaziantep"]
SEKTORLER = ["Perakende", "Uretim", "Lojistik", "Saglik", "Egitim", "Insaat", "Bilisim", "Turizm"]
BOLGELER = ["Marmara", "Ic Anadolu", "Ege", "Akdeniz", "Guneydogu"]

TEMSILCI_ADLARI = [
    "Ayse Yilmaz", "Mehmet Demir", "Zeynep Kaya", "Ahmet Celik", "Elif Sahin",
    "Mustafa Ozturk", "Fatma Arslan", "Emre Dogan",
]

FIRMA_ONEKLERI = [
    "Anadolu", "Ege", "Marmara", "Yildiz", "Guven", "Ata", "Deniz", "Kartal",
    "Safir", "Zirve", "Nova", "Orkun", "Bereket", "Toros", "Pinar", "Akdeniz",
    "Bogazici", "Cinar", "Erguvan", "Firat",
]
FIRMA_SONEKLERI = [
    "Tekstil A.S.", "Lojistik Ltd. Sti.", "Gida San. Tic. A.S.", "Bilisim A.S.",
    "Insaat Ltd. Sti.", "Saglik Hizmetleri A.S.", "Enerji A.S.", "Makina San. Ltd. Sti.",
]

URUNLER = [
    ("ERP Standart Lisans", "Yazilim", 45000),
    ("ERP Pro Lisans", "Yazilim", 92000),
    ("Bulut Yedekleme 1TB", "Bulut", 18000),
    ("Bulut Yedekleme 5TB", "Bulut", 64000),
    ("7/24 Destek Paketi", "Hizmet", 36000),
    ("Yerinde Bakim Paketi", "Hizmet", 24000),
    ("Barkod Terminali", "Donanim", 12500),
    ("Sunucu Kiralama", "Donanim", 78000),
    ("Egitim Gunu", "Hizmet", 9500),
    ("Entegrasyon Danismanligi", "Hizmet", 55000),
]

DURUMLAR = ["Aktif", "Aktif", "Aktif", "Aktif", "Beklemede", "Sona Erdi", "Iptal"]
KONULAR = [
    "Rapor ekrani acilmiyor", "Fatura yazdirma hatasi", "Kullanici yetkilendirme talebi",
    "Performans yavasligi", "Entegrasyon hatasi", "Yedekleme basarisiz",
    "Yeni kullanici tanimlama", "Mobil uygulama girisi", "Stok sayim farki",
    "E-fatura gonderim hatasi",
]


def _master_baglantisi() -> pyodbc.Connection:
    cs = (
        f"DRIVER={{{settings.mssql_driver}}};SERVER={settings.mssql_server};"
        f"DATABASE=master;"
        + ("Trusted_Connection=yes;" if settings.mssql_trusted else f"UID={settings.mssql_user};PWD={settings.mssql_password};")
        + "Encrypt=yes;TrustServerCertificate=yes"
    )
    return pyodbc.connect(cs, timeout=10, autocommit=True)


def _demo_baglantisi() -> pyodbc.Connection:
    cs = (
        f"DRIVER={{{settings.mssql_driver}}};SERVER={settings.mssql_server};"
        f"DATABASE={DB_ADI};"
        + ("Trusted_Connection=yes;" if settings.mssql_trusted else f"UID={settings.mssql_user};PWD={settings.mssql_password};")
        + "Encrypt=yes;TrustServerCertificate=yes"
    )
    return pyodbc.connect(cs, timeout=10, autocommit=True)


def veritabanini_olustur() -> None:
    conn = _master_baglantisi()
    cur = conn.cursor()
    cur.execute(f"IF DB_ID('{DB_ADI}') IS NOT NULL BEGIN ALTER DATABASE [{DB_ADI}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{DB_ADI}]; END")
    cur.execute(f"CREATE DATABASE [{DB_ADI}]")
    conn.close()
    print(f"[1/3] '{DB_ADI}' veritabani olusturuldu.")

    conn = _demo_baglantisi()
    cur = conn.cursor()
    for blok in [b.strip() for b in DDL.split(";") if b.strip()]:
        cur.execute(blok)
    conn.close()
    print("[2/3] Tablolar olusturuldu.")


def veri_ekle() -> None:
    rnd = random.Random(42)
    bugun = date.today()

    conn = _demo_baglantisi()
    cur = conn.cursor()

    for ad in TEMSILCI_ADLARI:
        cur.execute(
            "INSERT INTO dbo.Temsilciler (AdSoyad, Bolge, Email, IseGirisTarihi) VALUES (?,?,?,?)",
            ad,
            rnd.choice(BOLGELER),
            ad.lower().replace(" ", ".").replace("i", "i") + "@sirket.com",
            bugun - timedelta(days=rnd.randint(200, 2500)),
        )

    for ad, kategori, fiyat in URUNLER:
        cur.execute(
            "INSERT INTO dbo.Urunler (UrunAdi, Kategori, BirimFiyat) VALUES (?,?,?)",
            ad, kategori, fiyat,
        )

    unvanlar: set[str] = set()
    while len(unvanlar) < 60:
        unvanlar.add(f"{rnd.choice(FIRMA_ONEKLERI)} {rnd.choice(FIRMA_SONEKLERI)}")

    for i, unvan in enumerate(sorted(unvanlar), start=1):
        cur.execute(
            """INSERT INTO dbo.Musteriler
               (Unvan, VergiNo, Sehir, Sektor, Telefon, Email, TemsilciID, KayitTarihi, Aktif)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            unvan,
            str(rnd.randint(1000000000, 9999999999)),
            rnd.choice(SEHIRLER),
            rnd.choice(SEKTORLER),
            f"0{rnd.randint(212, 555)} {rnd.randint(100, 999)} {rnd.randint(1000, 9999)}",
            f"info@firma{i}.com.tr",
            rnd.randint(1, len(TEMSILCI_ADLARI)),
            bugun - timedelta(days=rnd.randint(30, 2000)),
            1 if rnd.random() > 0.12 else 0,
        )

    # Sozlesmeler: bir kismi bilerek onumuzdeki 30 gun icinde bitiyor.
    sozlesme_no = 1000
    for musteri_id in range(1, 61):
        for _ in range(rnd.randint(1, 3)):
            sozlesme_no += 1
            secim = rnd.random()
            if secim < 0.22:          # 1 ay icinde bitecek
                bitis = bugun + timedelta(days=rnd.randint(1, 30))
            elif secim < 0.38:        # 1-3 ay icinde bitecek
                bitis = bugun + timedelta(days=rnd.randint(31, 90))
            elif secim < 0.60:        # gecmiste bitmis
                bitis = bugun - timedelta(days=rnd.randint(1, 500))
            else:                     # uzak gelecek
                bitis = bugun + timedelta(days=rnd.randint(91, 900))

            baslangic = bitis - timedelta(days=rnd.choice([365, 365, 730, 180]))
            durum = "Sona Erdi" if bitis < bugun else rnd.choice(DURUMLAR)
            cur.execute(
                """INSERT INTO dbo.Sozlesmeler
                   (SozlesmeNo, MusteriID, BaslangicTarihi, BitisTarihi, YillikTutar,
                    ParaBirimi, Durum, OtomatikYenileme)
                   VALUES (?,?,?,?,?,?,?,?)""",
                f"SZL-{sozlesme_no}",
                musteri_id,
                baslangic,
                bitis,
                round(rnd.uniform(25000, 850000), 2),
                rnd.choice(["TRY", "TRY", "TRY", "USD", "EUR"]),
                durum,
                1 if rnd.random() > 0.6 else 0,
            )

    sozlesme_idler = [r[0] for r in cur.execute("SELECT SozlesmeID FROM dbo.Sozlesmeler").fetchall()]
    for sid in sozlesme_idler:
        for _ in range(rnd.randint(1, 4)):
            urun_id = rnd.randint(1, len(URUNLER))
            cur.execute(
                "INSERT INTO dbo.SozlesmeKalemleri (SozlesmeID, UrunID, Adet, BirimFiyat) VALUES (?,?,?,?)",
                sid, urun_id, rnd.randint(1, 10), URUNLER[urun_id - 1][2],
            )

    fatura_no = 50000
    for sid in sozlesme_idler:
        musteri_id = cur.execute(
            "SELECT MusteriID FROM dbo.Sozlesmeler WHERE SozlesmeID = ?", sid
        ).fetchone()[0]
        for _ in range(rnd.randint(1, 6)):
            fatura_no += 1
            fatura_tarihi = bugun - timedelta(days=rnd.randint(0, 700))
            vade = fatura_tarihi + timedelta(days=rnd.choice([30, 45, 60]))
            tutar = round(rnd.uniform(5000, 250000), 2)
            if vade < bugun:
                durum = rnd.choice(["Odendi", "Odendi", "Odendi", "Gecikmis"])
            else:
                durum = rnd.choice(["Bekliyor", "Odendi"])
            odenen = tutar if durum == "Odendi" else (round(tutar * rnd.uniform(0, 0.5), 2) if durum == "Gecikmis" else 0)
            cur.execute(
                """INSERT INTO dbo.Faturalar
                   (FaturaNo, MusteriID, SozlesmeID, FaturaTarihi, VadeTarihi, Tutar, OdenenTutar, OdemeDurumu)
                   VALUES (?,?,?,?,?,?,?,?)""",
                f"FTR-{fatura_no}", musteri_id, sid, fatura_tarihi, vade, tutar, odenen, durum,
            )

    for _ in range(250):
        acilis = bugun - timedelta(days=rnd.randint(0, 400))
        durum = rnd.choice(["Acik", "Islemde", "Kapali", "Kapali", "Kapali"])
        kapanis = acilis + timedelta(days=rnd.randint(1, 40)) if durum == "Kapali" else None
        cur.execute(
            """INSERT INTO dbo.DestekTalepleri
               (MusteriID, Konu, Oncelik, Durum, AcilisTarihi, KapanisTarihi)
               VALUES (?,?,?,?,?,?)""",
            rnd.randint(1, 60),
            rnd.choice(KONULAR),
            rnd.choice(["Dusuk", "Orta", "Orta", "Yuksek", "Kritik"]),
            durum, acilis, kapanis,
        )

    sayimlar = {}
    for tablo in ["Temsilciler", "Musteriler", "Urunler", "Sozlesmeler",
                  "SozlesmeKalemleri", "Faturalar", "DestekTalepleri"]:
        sayimlar[tablo] = cur.execute(f"SELECT COUNT(*) FROM dbo.{tablo}").fetchone()[0]

    conn.close()
    print("[3/3] Ornek veriler eklendi:")
    for tablo, adet in sayimlar.items():
        print(f"      {tablo:<20} {adet:>6} kayit")


if __name__ == "__main__":
    print(f"Sunucu: {settings.mssql_server}")
    veritabanini_olustur()
    veri_ekle()
    print("\nHazir. Uygulamayi baslatmak icin:  python -m uvicorn pybot.main:app --reload")
