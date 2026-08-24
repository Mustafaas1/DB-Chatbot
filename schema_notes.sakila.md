# Sakila — İş Kuralları ve Terim Sözlüğü

Sakila, bir **DVD kiralama zincirinin** örnek veritabanıdır. Bu dosya şema ile
birlikte yapay zekaya gönderilir.

## Alan bilgisi

- İki mağaza var (`store`), her mağazanın bir yöneticisi (`staff`) ve adresi var.
- `film` = katalogdaki film künyesi. Kiralanabilir fiziksel kopya değildir.
- `inventory` = mağazadaki fiziksel kopya. Bir film birden çok kopyaya sahip olabilir.
- `rental` = bir kopyanın bir müşteriye kiralanması. `payment` = bunun tahsilatı.
- Bir kiralama birden fazla ödemeye bağlanabilir; ciro hesaplarında `payment.amount` esastır.

## Terimler

- **Ciro / gelir**: `SUM(payment.amount)`. `film.rental_rate` liste fiyatıdır, tahsilat değildir.
- **Para birimi USD (dolar)**. Sakila bir ABD veri setidir; tutarları asla TL olarak
  etiketleme, `$` veya "USD" kullan.
- **İade edilmemiş / halen dışarıda olan kiralama**: `rental.return_date IS NULL`.
- **Gecikmiş kiralama**: `return_date IS NULL` **ve**
  `DATEDIFF(CURDATE(), rental_date) > film.rental_duration`.
- **Aktif müşteri**: `customer.active = 1`.
- **Film uzunluğu** (`film.length`) dakikadır; **`rental_duration`** gündür.
- **`film.rating`**: ENUM — `G`, `PG`, `PG-13`, `R`, `NC-17`.
- **`film.special_features`**: SET tipi; aramak için `FIND_IN_SET('Trailers', special_features)`.

## Sık gereken bağlantı zinciri

Film → kiralama sayısı:
`film → inventory (film_id) → rental (inventory_id)`

Müşteri → ciro:
`customer → payment (customer_id)`

Film → kategori:
`film → film_category → category`

Film → oyuncu:
`film → film_actor → actor`

Müşteri/mağaza → şehir/ülke:
`... → address → city → country`

## Dikkat

- **Veriler geçmiş tarihlidir.** Kiralamalar ağırlıklı olarak 2005 (Mayıs–Ağustos) ve
  ödemeler 2005–2006 aralığındadır. Kullanıcı "geçen ay", "bu yıl" gibi bir ifade
  kullanırsa sonuç boş gelir; bu durumda `MAX(rental_date)` ile verinin gerçek aralığını
  kontrol edip kullanıcıya bildir ve sorguyu o aralığa göre yorumla.
- `actor` tablosunda ad ve soyad BÜYÜK HARFLE tutulur.
- Hazır görünümler işi kısaltabilir: `film_list`, `nicer_but_slower_film_list`,
  `sales_by_store`, `sales_by_film_category`, `staff_list`, `customer_list`.
