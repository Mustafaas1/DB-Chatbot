# Araç katmanı (spec bölüm 6)

## Sözleşme

`src/core/tools/tipler.ts`

| Alan | Ne için |
|---|---|
| `ad`, `aciklama` | Kimlik |
| `girdiSemasi` | Zod; girdi araca girmeden **önce** doğrulanır |
| `calistir` | Handler |
| `yanEtki` | `okuma` \| `yazma` |
| `risk` | `low` \| `medium` \| `high` |
| `prova` | Yan etkisiz ön izleme |
| `hizSiniri` | `{ pencereMs, azamiCagri }` |

`yanEtki` ile `risk` **ayrı sorulara** cevap veriyor: birincisi *"bu araç yazıyor
mu"*, ikincisi *"yazarsa ne kadar kötü olur"*. Bilet atamak da fatura kesmek de
yazma, ama riskleri farklı.

## Idempotency — "aynı aksiyon iki kez çalışmasın"

Bölümün en keskin şartı. `src/core/tools/idempotency.ts`

Yan etkili bir araç **idempotency anahtarı olmadan çalıştırılamaz**. Aynı
anahtarla ikinci çağrı aracı **tekrar çalıştırmaz**, ilk sonucu döner
(`tekrarMi: true`).

Neden gerekli: ağın kopması, kullanıcının iki kez tıklaması ya da bir retry aynı
aksiyonu tetikleyebilir. "Bileti ata" iki kez çalışırsa zararsız; "fatura kes"
ya da "e-posta gönder" iki kez çalışırsa geri alınamaz.

Üç tasarım kararı:

**Kalıcı (SQLite).** Bellekte tutmak, en çok ihtiyaç duyulduğu ana — çökme
sonrası retry — karşı korumasız bırakırdı.

**Aynı anahtar + farklı girdi = hata.** Sessizce ilk sonucu dönmek, yanlış veri
döndürmek olurdu. Çağıran taraf anahtarı yeniden kullanıyorsa bu bir hatadır.

**Başarısız çağrı kayıttan düşürülür.** Başarısızlığı kalıcı kaydetmek, geçici
bir hatadan sonra aksiyonun bir daha hiç denenememesine yol açardı.

## Yazma için iki kapı birden

Yan etkili araç hem `onaylayan` hem `idempotencyAnahtari` ister. Onay şartı
F5'teki yürütücüde de var; burada tekrar zorlanması **savunma derinliği** —
bir ajan aracı doğrudan çağırırsa onay akışını atlayabilirdi.

## MCP

`McpYoneticisi` birden fazla sunucuya bağlanır, araçları keşfeder ve aynı kayda
normalize eder. Yeni MCP eklemek `mcp.json`'a bir satır.

**Bilinmeyen MCP aracı `risk: high` sayılır.** Yan etkisini bildirmeyen araç
zaten `yazma` sayılıyordu; riskini de yüksek sayıyoruz. Bilinmeyeni düşük
saymak, tanımadığımız bir aracın sessizce çalışmasına izin verirdi.

## Mevcut araçlar

| Araç | Yan etki | Risk | Hız sınırı |
|---|---|---|---|
| `veri_sorgula` | okuma | low | 20/dk |
| `bilet_ata` | **yazma** | low | 10/dk |
| MCP araçları | sunucuya göre | okuma=low, diğer=high | — |

## Spec'te olup yapılmayanlar

`analytics-read`, `crm-read`, `email-campaign-create`, `segment-create`,
`web-search` **eklenmedi** — bu kurulumda arkalarında çalışan bir sistem yok.
Analitik platformu, e-posta altyapısı, segment motoru ya da arama API'si
tanımlı değil.

Boş kabuk araç yazmak, modele var olmayan bir yetenek vaat etmek olurdu; bu
oturumda tam da bunun bedelini gördük (ağaç "SSS makale" ölçümü üretip 40 saniye
harcıyordu). Bu araçlar ancak arkalarındaki sistem tanımlandığında eklenmeli.

`ticket-create` eklenebilir — `TicketRecords` var. Eklenmedi çünkü yeni bilet
açmak bir saklı yordam daha gerektiriyor ve o veritabanı tarafında karar.
