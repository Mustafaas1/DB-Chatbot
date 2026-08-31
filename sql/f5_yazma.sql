/* ---------------------------------------------------------------------------
   F5 - YAZMA KATMANI
   ---------------------------------------------------------------------------
   Beyaz listeyi VERITABANINDA zorlar. ajan_yazar kullanicisinin hicbir
   tabloya yazma yetkisi YOKTUR; yalnizca asagidaki iki yordami
   calistirabilir. Uygulama kodunda bir hata olsa ya da istem enjeksiyonu
   olsa bile bu sinir asilamaz.

   PAROLAYI_SEN_YAZ yerine kendi parolanizi koyun ve .env'e ekleyin:
     MSSQL_YAZAR_USER=ajan_yazar
     MSSQL_YAZAR_PASSWORD=<parola>

   Calistirma (yonetici PowerShell):
     sqlcmd -S "localhost\SQLEXPRESS" -E -d gokkusagi_passwordvault -i sql5_yazma.sql
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
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'ajan_yazar')
    CREATE LOGIN ajan_yazar WITH PASSWORD = 'PAROLAYI_SEN_YAZ', CHECK_POLICY = ON;
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
