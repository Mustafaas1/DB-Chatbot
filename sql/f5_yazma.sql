/* ---------------------------------------------------------------------------
   F5 - YAZMA KATMANI
   ---------------------------------------------------------------------------
   Beyaz listeyi VERITABANINDA zorlar. ajan_yazar kullanicisinin hicbir
   tabloya yazma yetkisi YOKTUR; yalnizca asagidaki iki yordami
   calistirabilir. Uygulama kodunda bir hata olsa ya da istem enjeksiyonu
   olsa bile bu sinir asilamaz.

   PAROLA DOSYAYA YAZILMAZ. sqlcmd degiskeni olarak disaridan verilir;
   bu repo public oldugu icin parolanin dosyaya girmesi sizinti olurdu.

   Calistirma (yonetici PowerShell):
     sqlcmd -S "localhost\SQLEXPRESS" -E -d gokkusagi_passwordvault ^
            -v PAROLA="SectiginizParola" -i sql\f5_yazma.sql

   Sonra ayni parolayi .env'e ekleyin:
     MSSQL_YAZAR_USER=ajan_yazar
     MSSQL_YAZAR_PASSWORD=SectiginizParola
--------------------------------------------------------------------------- */

SET NOCOUNT ON;
GO

/* --- 1) Bileti kisiye ata ------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_ajan_bilet_ata
    @BiletNo NVARCHAR(40),
    @Deger   NVARCHAR(120)
AS
BEGIN
    SET NOCOUNT ON;

    -- Tek bilet: BiletNo benzersiz olmali. Coklu guncellemeye izin yok.
    IF (SELECT COUNT(*) FROM dbo.TicketRecords
        WHERE BiletNo = @BiletNo AND IsDeleted = 0) > 1
    BEGIN
        RAISERROR('Birden fazla bilet eslesti; islem iptal edildi.', 16, 1);
        RETURN;
    END

    UPDATE dbo.TicketRecords
       SET AtananKisi = NULLIF(@Deger, N''),
           GuncellemeTarihi = SYSUTCDATETIME()
     WHERE BiletNo = @BiletNo AND IsDeleted = 0;

    SELECT @@ROWCOUNT AS Etkilenen;
END
GO

/* --- 2) Bilet asamasini degistir ----------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_ajan_bilet_asama
    @BiletNo NVARCHAR(40),
    @Deger   NVARCHAR(120)
AS
BEGIN
    SET NOCOUNT ON;

    -- Asama degerleri SABIT: uygulama katmani asilsa bile baska deger giremez.
    IF @Deger NOT IN (N'Beklemede', N'İşlemde', N'Tamamlandı')
    BEGIN
        RAISERROR('Gecersiz asama degeri.', 16, 1);
        RETURN;
    END

    IF (SELECT COUNT(*) FROM dbo.TicketRecords
        WHERE BiletNo = @BiletNo AND IsDeleted = 0) > 1
    BEGIN
        RAISERROR('Birden fazla bilet eslesti; islem iptal edildi.', 16, 1);
        RETURN;
    END

    UPDATE dbo.TicketRecords
       SET Asama = @Deger,
           GuncellemeTarihi = SYSUTCDATETIME()
     WHERE BiletNo = @BiletNo AND IsDeleted = 0;

    SELECT @@ROWCOUNT AS Etkilenen;
END
GO

/* --- 3) Yazma kullanicisi ------------------------------------------------ */
IF '$(PAROLA)' = '' OR '$(PAROLA)' = '$' + '(PAROLA)'
BEGIN
    RAISERROR('PAROLA degiskeni verilmedi. -v PAROLA="..." ile calistirin.', 20, 1)
        WITH LOG;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'ajan_yazar')
    CREATE LOGIN ajan_yazar WITH PASSWORD = '$(PAROLA)', CHECK_POLICY = ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'ajan_yazar')
    CREATE USER ajan_yazar FOR LOGIN ajan_yazar;
GO

/* Hicbir role uye DEGIL: db_datareader/db_datawriter verilmiyor.
   Yalnizca iki yordami calistirabilir ve provanin okudugu tek tabloyu
   okuyabilir. */
GRANT EXECUTE ON dbo.sp_ajan_bilet_ata   TO ajan_yazar;
GRANT EXECUTE ON dbo.sp_ajan_bilet_asama TO ajan_yazar;

/* Prova "once/sonra" gosterebilmek icin mevcut degeri okumali. */
GRANT SELECT ON dbo.TicketRecords TO ajan_yazar;

/* Dogrudan yazma acikca REDDEDILIR. DENY her zaman GRANT'i yener, yani
   ileride yanlislikla bir role eklense bile yazamaz. */
DENY INSERT, UPDATE, DELETE ON dbo.TicketRecords TO ajan_yazar;
GO

PRINT 'F5 yazma katmani kuruldu.';
GO
