# CRM — İş Kuralları ve Terim Sözlüğü

Bu veritabanı bir **kurumsal CRM** sistemidir: müşteri teklifleri, destek
biletleri, sözleşmeler, faturalar, projeler ve iç işleyiş (izin, nöbet, kanban).
Kolon adları Türkçedir.

## En önemli kural: yumuşak silme

Neredeyse her tabloda **`IsDeleted`** (bit) ve çoğunda **`IsArchived`** (bit)
kolonu vardır. Kayıtlar fiziksel olarak silinmez, işaretlenir.

**Her sorguda `WHERE IsDeleted = 0` filtresi kullan.** Aksi halde sayılar
yanlış çıkar — örneğin `TicketRecords` tablosunda 6.938 satır vardır ama
bunların yalnızca 6.860'ı geçerlidir.

Kullanıcı açıkça "silinmişler dahil" demedikçe silinmiş kayıtları sayma.
Arşivlenmiş (`IsArchived = 1`) kayıtlar geçerlidir; yalnızca kullanıcı
"arşiv hariç" derse dışla.

## Para birimi

Tutar kolonlarının yanında **`ParaBirimi`** kolonu bulunur ve **her kayıtta
dolu değildir** — örneğin `Invoices` tablosunda 390 kaydın para birimi boş,
69'u `TRY`. Bu yüzden:

- Farklı para birimlerindeki tutarları **toplama**; para birimine göre grupla.
- Para birimi boş olan kayıtlar varsa bunu cevabında belirt.

## Ortak kolonlar

- **`CreatedAt` / `OlusturmaTarihi`**: kaydın oluşturulma tarihi.
- **`UpdatedAt` / `GuncellemeTarihi`**: son güncelleme.
- **`Id`** kolonları `uniqueidentifier` (GUID) tipindedir; kullanıcıya gösterme.
- Müşteri adı çoğu tabloda **metin olarak** tutulur (`MusteriAdi`, `Musteri`);
  ayrı bir müşteri tablosuna bağlanmaya gerek yoktur.

## Erişime kapalı tablolar

`CredentialRecords`, `CredentialActivities`, `RefreshTokens`, `Users`,
`RolePermissions`, `DepartmentPermissions` tabloları **sorgulanamaz**.
Bu tablolara atıf yapan bir sorgu güvenlik katmanı tarafından reddedilir.

Bazı tablolarda `CredentialRecordId` kolonu bulunur; bu kolonu seçebilirsin
ama `CredentialRecords` tablosuna **JOIN yapamazsın**. Müşteri adı zaten
`MusteriAdi` / `Musteri` kolonlarında metin olarak mevcuttur, JOIN gerekmez.

## Tarih ve lehçe

MS SQL Server lehçesi kullan: `GETDATE()`, `DATEADD`, `DATEDIFF`,
`FORMAT(tarih, 'yyyy-MM')`, satır sınırı için `TOP n` (LIMIT değil).
