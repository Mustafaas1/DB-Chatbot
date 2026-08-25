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

## Para birimi — en sık yapılan hata

Tutar kolonlarının yanında **`ParaBirimi`** kolonu bulunur. Bu kolon hem
**tablodan tabloya değişir** hem de **her kayıtta dolu değildir**:

| Tablo | Dağılım |
|---|---|
| `Teklifler` | 144 kayıt `TRY`, 7 kayıt `USD` |
| `Invoices` | 390 kayıt **boş**, 69 kayıt `TRY` |
| `ContractRecords` | 387 kayıt **boş**, 31 kayıt `TRY` |
| `OpportunityRecords` | 51 kayıt `TRY` |

Bu yüzden:

- **Farklı para birimlerindeki tutarları ASLA tek bir toplamda birleştirme.**
  `SUM(Tutar)` yazacaksan mutlaka `GROUP BY ParaBirimi` ekle.
- Toplamı **"TL" diye etiketleme**; hangi para biriminde olduğunu veriden al.
- Para birimi boş olan kayıtlar varsa bunları ayrı bir grup olarak göster ve
  cevabında "bir kısmının para birimi tanımsız" diye belirt.

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
