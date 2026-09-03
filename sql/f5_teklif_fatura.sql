/* ---------------------------------------------------------------------------
   F5 - TEKLIF VE FATURA YAZMA YORDAMLARI
   ---------------------------------------------------------------------------
   f5_yazma.sql'in devami. Ayni ilkeler:
     - ajan_yazar'in tabloya dogrudan yazma yetkisi YOK; yalnizca EXECUTE.
     - Gecerli degerler TABLODAN okunur, dosyaya sabit yazilmaz. Boylece
       sqlcmd kodlama sorunlari Turkce degerleri bozamaz ve yeni bir durum
       eklendiginde bakim gerekmez.
     - Coklu eslesme varsa islem IPTAL edilir: tek kayit disinda yazma yok.

   NOT: Dosya UTF-8 BOM ile kaydedilir; sqlcmd BOM'suz UTF-8'i ANSI sanip
   Turkce karakterleri bozuyor.

   Calistirma (yonetici PowerShell):
     sqlcmd -S "localhost\SQLEXPRESS" -E -d gokkusagi_passwordvault ^
            -i sql\f5_teklif_fatura.sql

   Parola istemez: ajan_yazar kullanicisi f5_yazma.sql ile zaten olusturuldu.
--------------------------------------------------------------------------- */

SET NOCOUNT ON;
GO

/* --- 1) Teklif durumunu degistir ----------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_ajan_teklif_durum
    @TeklifNo NVARCHAR(60),
    @Deger    NVARCHAR(120)
AS
BEGIN
    SET NOCOUNT ON;

    -- Durum degeri TABLODA VAR OLAN bir deger olmali.
    IF NOT EXISTS (SELECT 1 FROM dbo.Teklifler WHERE Durum = @Deger AND IsDeleted = 0)
    BEGIN
        RAISERROR('Gecersiz teklif durumu: tabloda boyle bir durum yok.', 16, 1);
        RETURN;
    END

    IF (SELECT COUNT(*) FROM dbo.Teklifler
        WHERE TeklifNo = @TeklifNo AND IsDeleted = 0) > 1
    BEGIN
        RAISERROR('Birden fazla teklif eslesti; islem iptal edildi.', 16, 1);
        RETURN;
    END

    UPDATE dbo.Teklifler
       SET Durum = @Deger
     WHERE TeklifNo = @TeklifNo AND IsDeleted = 0;

    SELECT @@ROWCOUNT AS Etkilenen;
END
GO

/* --- 2) Teklife satis temsilcisi ata ------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.sp_ajan_teklif_temsilci
    @TeklifNo NVARCHAR(60),
    @Deger    NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;

    -- Temsilci, halihazirda teklif tasiyan biri olmali: uydurulmus isim
    -- giremesin. Bos deger atamayi kaldirmak demek, o serbest.
    IF NULLIF(@Deger, N'') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.Teklifler
                       WHERE SatisTemsilcisi = @Deger AND IsDeleted = 0)
    BEGIN
        RAISERROR('Gecersiz satis temsilcisi: tabloda boyle bir temsilci yok.', 16, 1);
        RETURN;
    END

    IF (SELECT COUNT(*) FROM dbo.Teklifler
        WHERE TeklifNo = @TeklifNo AND IsDeleted = 0) > 1
    BEGIN
        RAISERROR('Birden fazla teklif eslesti; islem iptal edildi.', 16, 1);
        RETURN;
    END

    UPDATE dbo.Teklifler
       SET SatisTemsilcisi = NULLIF(@Deger, N'')
     WHERE TeklifNo = @TeklifNo AND IsDeleted = 0;

    SELECT @@ROWCOUNT AS Etkilenen;
END
GO

/* --- 3) Fatura durumunu degistir ----------------------------------------- */
/* Fatura durumu MALI bir olay. Uygulama tarafinda risk=high isaretli:
   hicbir otonomi modunda onaysiz calismaz. */
CREATE OR ALTER PROCEDURE dbo.sp_ajan_fatura_durum
    @FaturaId NVARCHAR(60),
    @Deger    NVARCHAR(120)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Invoices WHERE Durum = @Deger AND IsDeleted = 0)
    BEGIN
        RAISERROR('Gecersiz fatura durumu: tabloda boyle bir durum yok.', 16, 1);
        RETURN;
    END

    -- Id uniqueidentifier; metin olarak gelip burada donusturuluyor.
    -- Gecersiz GUID'de TRY_CAST NULL doner ve hicbir satir eslesmez.
    UPDATE dbo.Invoices
       SET Durum = @Deger,
           UpdatedAt = SYSUTCDATETIME()
     WHERE Id = TRY_CAST(@FaturaId AS UNIQUEIDENTIFIER) AND IsDeleted = 0;

    SELECT @@ROWCOUNT AS Etkilenen;
END
GO

/* --- 4) Yetkiler --------------------------------------------------------- */
GRANT EXECUTE ON dbo.sp_ajan_teklif_durum    TO ajan_yazar;
GRANT EXECUTE ON dbo.sp_ajan_teklif_temsilci TO ajan_yazar;
GRANT EXECUTE ON dbo.sp_ajan_fatura_durum    TO ajan_yazar;

/* Prova "once/sonra" gosterebilmek icin mevcut degeri okumali. */
GRANT SELECT ON dbo.Teklifler TO ajan_yazar;
GRANT SELECT ON dbo.Invoices  TO ajan_yazar;

/* Dogrudan yazma acikca REDDEDILIR. DENY her zaman GRANT'i yener. */
DENY INSERT, UPDATE, DELETE ON dbo.Teklifler TO ajan_yazar;
DENY INSERT, UPDATE, DELETE ON dbo.Invoices  TO ajan_yazar;
GO

PRINT 'Teklif ve fatura yazma yordamlari kuruldu.';
GO
