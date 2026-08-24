# İş Kuralları ve Terim Sözlüğü

Bu dosyanın içeriği, veritabanı şemasıyla birlikte yapay zekaya gönderilir.
Şirketinize özel terimleri, kısaltmaları ve iş kurallarını buraya yazın —
chatbot'un doğru sonuç üretmesindeki en büyük etkenlerden biri budur.

Dosyayı silerseniz sorun olmaz; sadece bu ek bağlam gönderilmez.

## Terimler

- **Aktif müşteri**: `Musteriler.Aktif = 1` olan kayıtlar.
- **Ciro**: `Faturalar.Tutar` toplamı. `OdenenTutar` tahsil edilen kısımdır.
- **Gecikmiş fatura**: `VadeTarihi` bugünden küçük ve `OdemeDurumu <> 'Odendi'`.
- **Yenilenecek sözleşme**: `Durum = 'Aktif'` ve `BitisTarihi` yakın gelecekte olan sözleşmeler.

## Kurallar

- Sözleşme durumları: `Aktif`, `Beklemede`, `Iptal`, `Sona Erdi`.
- Ödeme durumları: `Odendi`, `Bekliyor`, `Gecikmis`.
- Destek talebi öncelikleri: `Dusuk`, `Orta`, `Yuksek`, `Kritik`.
- `Iptal` durumundaki sözleşmeler ciro hesaplarına dahil edilmez.
- Para birimi karışıktır (`TRY`, `USD`, `EUR`); toplam alırken para birimine göre
  gruplayın veya kullanıcıya hangi para biriminde istediğini sorun.
