# Veritabanı Chatbot

Şirket veritabanına **Türkçe soru sorup** sonucu tablo olarak alan bir web uygulaması.
Kullanıcı SQL bilmez; Claude soruyu T-SQL'e çevirir, salt-okunur olarak çalıştırır ve
sonucu özetler.

> "1 ay içinde sözleşmeleri bitecek müşteriler" → arka planda sorgu çalışır → ekranda tablo.

Şirket portalınızın **sağ alt köşesinde yuvarlak bir buton** olarak durur; tıklanınca
sohbet paneli açılır. Tek `<script>` etiketiyle herhangi bir sayfaya eklenir.

**Yığın:** MS SQL Server *veya* MySQL · Claude *veya* Groq · FastAPI · saf JavaScript (derleme adımı yok)

Veritabanı ve yapay zeka sağlayıcısı `.env` üzerinden değiştirilir; kod değişmez.

| Adres | Ne var |
|---|---|
| `/demo` | Widget'ın gömülü olduğu örnek şirket portalı — **buradan başlayın** |
| `/` | Tam sayfa yönetim arayüzü (şema gezgini, bağlantı durumu) |

---

## Hızlı başlangıç

### 1. Bağımlılıklar

```bash
pip install -r requirements.txt
```

Ayrıca **ODBC Driver 18 for SQL Server** kurulu olmalıdır
([indirme sayfası](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server)).

### 2. Yapılandırma

```bash
copy .env.example .env
```

`.env` dosyasını açıp en az şu iki satırı doldurun:

```ini
ANTHROPIC_API_KEY=sk-ant-...        # console.anthropic.com/settings/keys
MSSQL_SERVER=localhost\SQLEXPRESS   # şirket sunucunuz
MSSQL_DATABASE=SirketDemo           # bağlanılacak veritabanı
```

### 3. Demo veritabanı (isteğe bağlı)

Gerçek şemanız bağlanana kadar test için örnek bir şirket veritabanı oluşturur:

```bash
python scripts/demo_veritabani.py
```

Müşteriler, Sözleşmeler, Faturalar, Ürünler, Destek Talepleri tablolarını gerçekçi
verilerle doldurur (sözleşmelerin bir kısmı bilerek önümüzdeki 30 gün içinde biter).

### 4. Çalıştırma

```bash
python -m uvicorn app.main:app --reload
```

Tarayıcıdan <http://localhost:8000/demo> adresini açın — sağ alt köşedeki yuvarlak butona tıklayın.

---

## Gerçek veritabanına geçiş

1. `.env` içinde `MSSQL_SERVER` ve `MSSQL_DATABASE` değerlerini değiştirin.
   SQL kimlik doğrulaması kullanıyorsanız:
   ```ini
   MSSQL_TRUSTED_CONNECTION=no
   MSSQL_USER=chatbot_okuyucu
   MSSQL_PASSWORD=...
   ```
2. Uygulamayı yeniden başlatın, arayüzden **Tablolar → Yenile**'ye basın.
   Şema otomatik taranır; kod değişikliği gerekmez.
3. `schema_notes.md` dosyasına şirketinize özel terimleri yazın
   (örn. "ciro = Faturalar.Tutar toplamı"). Doğruluğu en çok artıran adım budur.

### Önerilen: salt-okunur veritabanı kullanıcısı

Uygulama içinde üç güvenlik katmanı var, ancak asıl koruma veritabanı tarafındadır:

```sql
CREATE LOGIN chatbot_okuyucu WITH PASSWORD = 'güçlü-bir-şifre';
USE [SirketVeritabani];
CREATE USER chatbot_okuyucu FOR LOGIN chatbot_okuyucu;
ALTER ROLE db_datareader ADD MEMBER chatbot_okuyucu;   -- sadece okuma
```

---

## Veritabanı seçimi

`.env` içindeki `DB_TYPE` ile belirlenir:

```ini
DB_TYPE=mssql    # MS SQL Server (şirketin gerçek veritabanı)
DB_TYPE=mysql    # MySQL (Sakila örnek veritabanı)
```

Şema tarama, SQL güvenlik katmanı ve yapay zekaya verilen sözdizimi kuralları
seçime göre otomatik değişir (T-SQL `TOP`/`GETDATE()` ↔ MySQL `LIMIT`/`CURDATE()`).

### Sakila örnek veritabanını yükleme

```bash
mysql -u root -p < "C:/Users/Mustafa/Downloads/sakila-db/sakila-db/sakila-schema.sql"
```

```bash
mysql -u root -p < "C:/Users/Mustafa/Downloads/sakila-db/sakila-db/sakila-data.sql"
```

Sonra `.env` içinde:

```ini
DB_TYPE=mysql
MYSQL_USER=root
MYSQL_PASSWORD=parolanız
MYSQL_DATABASE=sakila
```

Uygulamayı yeniden başlatın; şema otomatik taranır.

### Terim sözlüğü dosyaları

Yapay zekaya gönderilen iş kuralları veritabanına göre seçilir:

| Dosya | Ne zaman kullanılır |
|---|---|
| `schema_notes.sakila.md` | `MYSQL_DATABASE=sakila` iken |
| `schema_notes.SirketDemo.md` | `MSSQL_DATABASE=SirketDemo` iken |
| `schema_notes.md` | Yukarıdakiler yoksa (yedek) |

Kendi veritabanınız için `schema_notes.<veritabanı_adı>.md` oluşturun.

---

## Yapay zeka sağlayıcısı

```ini
LLM_PROVIDER=claude    # Anthropic Claude
LLM_PROVIDER=groq      # Groq (OpenAI uyumlu API)
```

| Sağlayıcı | Ayarlar | Not |
|---|---|---|
| `claude` | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT` | SQL üretiminde daha isabetli; şema önbelleğe alınır (ucuzlar) |
| `groq` | `GROQ_API_KEY`, `GROQ_MODEL` | Çok hızlı ve ücretsiz katmanı var; prompt önbelleği yok |

Groq'ta **araç çağırmayı destekleyen** bir model seçin — aksi halde SQL üretemez.
Groq kataloğu sık değişir; hesabınızda hangileri var görmek için:

```bash
python -c "import sys; sys.path.insert(0,'.'); from app.llm import get_groq_client; print(*sorted(m.id for m in get_groq_client().models.list().data), sep='
')"
```

Anahtarı <https://console.groq.com/keys> adresinden alın.

### Ölçülen gecikme (Groq ücretsiz katman)

Sakila şemasıyla (~2.600 token sistem mesajı), soru başına 4 örnek:

| Model | Medyan | Aralık | Araç çağırma |
|---|---|---|---|
| `openai/gpt-oss-120b` | 15,4 sn | 2,8 – 30,3 sn | 4/4 |
| `openai/gpt-oss-20b` | 42,3 sn | 0,8 – 57,1 sn | 4/4 |
| `qwen/qwen3.6-27b` | 47,8 sn | 1,7 – 61,5 sn | 4/4 |

Sapma model seçiminden değil, **ücretsiz katmanın kuyruk süresinden** kaynaklanıyor —
aynı model aynı soruda 1 sn de sürebiliyor 30 sn de. `reasoning_effort` denendi,
ölçülebilir fayda vermedi (bu yüzden `GROQ_REASONING_EFFORT` varsayılan olarak boş).

Hız kritikse: Groq ücretli katman ya da `LLM_PROVIDER=claude`. Arayüz beklerken
geçen süreyi saniye saniye gösterir, böylece donmuş gibi görünmez.

### Groq ücretsiz katman kotaları — dikkat

Ölçülen gerçek limitler (`openai/gpt-oss-120b`, `on_demand` katman):

| Limit | Değer | Pratikte ne demek |
|---|---|---|
| Dakikada token (TPM) | 8.000 | Soru başına ~4–8 bin token → **dakikada 1–2 soru** |
| Günde token (TPD) | 200.000 | **Günde ~30–45 soru** |

`max_tokens` da limite sayılır (rezerve edilen çıktı), bu yüzden `GROQ_MAX_TOKENS`
varsayılanı 1200'e çekildi. Ayrıca:

- Sonuçların yalnızca ilk `MODEL_ROW_SAMPLE` (15) satırı modele gönderilir —
  kullanıcı tabloyu tam görür, model özet için 15 satırla yetinir.
- Uzun sohbetlerde geçmiş otomatik kırpılır: eski araç çıktıları kısaltılır,
  gerekirse baştan mesaj atılır (kesme noktası `user` mesajına hizalanır ki
  `tool` mesajı eşleştiği `assistant` çağrısından kopmasın).
- Yine de dakikalık limit aşılırsa istek, sadece sistem mesajı + son soru ile
  bir kez daha denenir.

**Bu kotalar bir şirket aracı için yeterli değildir.** Gerçek kullanım için
Groq Dev Tier veya `LLM_PROVIDER=claude` gerekir.

---

## Widget'ı kendi sayfanıza ekleme

Şirket portalınızın kapanış `</body>` etiketinden hemen önce tek satır:

```html
<script src="http://sunucu:8000/static/widget.js" data-api="http://sunucu:8000"></script>
```

Widget tüm arayüzünü **Shadow DOM** içinde oluşturur; sayfanızın CSS'i widget'ı,
widget da sayfanızı etkilemez.

### Ayarlar (script etiketi üzerinde)

| Öznitelik | Varsayılan | Açıklama |
|---|---|---|
| `data-api` | (boş = aynı sunucu) | API adresi. Widget farklı bir sunucudaki sayfadaysa zorunlu |
| `data-baslik` | `Veri Asistanı` | Panel başlığı |
| `data-altbaslik` | `Veritabanına Türkçe soru sorun` | Karşılama metni |
| `data-renk` | `#2f6fed` | Ana renk (buton, balonlar) — kurumsal renginizi verin |
| `data-ornekler` | 3 örnek soru | `\|` ile ayrılmış örnek soru listesi |

### Sayfanızın kendi butonlarından tetikleme

```javascript
vtAsistan.ac();                                    // paneli aç
vtAsistan.kapat();                                 // paneli kapat
vtAsistan.sor("bu ay biten sözleşmeler");          // aç ve soruyu gönder
```

Örneğin "Sözleşmeler" sayfanızdaki bir butona bağlayabilirsiniz.

### Farklı alan adına gömerken (CORS)

Widget başka bir sunucudaki sayfaya gömülüyorsa `.env` içinde izin verin:

```ini
CORS_ORIGINS=https://portal.sirket.com,https://intranet.sirket.com
```

Varsayılan `*` (herkese açık) — üretimde mutlaka kendi alan adlarınızla sınırlayın.

### Davranış

- Panel durumu ve sohbet geçmişi `sessionStorage`'da tutulur; sayfalar arasında gezerken
  konuşma kaybolmaz, sekme kapanınca temizlenir.
- 700px'ten geniş ekranlarda başlıktaki genişletme butonu paneli 760px'e çıkarır
  (geniş sonuç tabloları için).
- 560px altındaki ekranlarda panel tam ekran açılır.
- `Esc` paneli kapatır, `Enter` gönderir, `Shift+Enter` yeni satır ekler.
- Başlıktaki **tam ekran** butonu sohbeti tam sayfa arayüze devreder; konuşma
  `localStorage` üzerinden taşınır, tablolar dahil kaldığı yerden devam eder.
- Statik dosyalar `Cache-Control: no-cache` ile sunulur: `widget.js` güncellendiğinde
  gömülü sayfalar eski sürümde takılı kalmaz (dosya değişmediyse 304 döner).

---

## Güvenlik

Yapay zekanın ürettiği her SQL, çalışmadan önce üç katmandan geçer:

| Katman | Ne yapar |
|---|---|
| `app/sqlguard.py` | Yalnızca tek bir `SELECT`/`WITH` ifadesine izin verir. `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `EXEC`, `xp_*`, `SELECT ... INTO` gibi ifadeleri reddeder. Noktalı virgülle **ve** noktalı virgülsüz (`SELECT 1 DROP TABLE x`) zincirlemeyi engeller. |
| `app/db.py` | Bağlantı `autocommit=False` açılır ve sorgu bitince **her zaman `rollback`** yapılır. Satır limiti (`MAX_ROWS`) ve zaman aşımı (`QUERY_TIMEOUT`) uygulanır. |
| Veritabanı | `db_datareader` yetkili kullanıcı (yukarıdaki öneri). |

Metin sabitleri (`WHERE Unvan LIKE '%delete%'`) ve köşeli parantezli kolon adları
(`[Deleted]`) yanlış alarm üretmez — tarama öncesi ayıklanır.

### API erişim koruması

`.env` içindeki **`API_TOKEN`** doldurulduğunda tüm `/api/*` uçları anahtar ister:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"   # anahtar üret
```

```
API_TOKEN=urettiginiz-anahtar
```

İstekler `Authorization: Bearer <anahtar>` veya `X-API-Token: <anahtar>` gönderir.
Widget'a `data-token="<anahtar>"` olarak verilir; tam sayfa arayüz 401 alınca
anahtarı sorar ve tarayıcıda saklar.

**Boş bırakılırsa API korumasızdır** — sunucuya erişebilen herkes veritabanını
sorgulayabilir ve LLM kotanızı tüketebilir. Yerel denemede sorun değil, gerçek
şirket verisiyle çalışırken doldurulmalıdır.

> **Sınır:** Tarayıcıya inen anahtar gizli değildir; sayfayı görebilen herkes
> okuyabilir. Bu koruma, internete açık bir sunucuda yetkisiz erişimi ve kota
> tüketimini engeller — portalın kendi kullanıcılarını birbirinden ayırmaz.
> Kullanıcı bazlı yetki gerekiyorsa istekler portalın kendi sunucusu üzerinden
> vekillenmelidir.

Ayrıca ham SQL çalıştırma ucu (`/api/sql`) **varsayılan olarak kapalıdır**;
doğal dil akışını atladığı için yalnızca `ALLOW_RAW_SQL=on` ile açılır.

### Güvenlik testleri

Bu katman projenin tek kritik güvencesi olduğu için regresyon testleriyle korunur:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest tests/ -q
```

52 test; `DROP`/`UPDATE`/`TRUNCATE`, `SELECT ... INTO`, `INTO OUTFILE`,
`LOAD_FILE`, `BENCHMARK`, `SLEEP`, `WAITFOR`, `xp_cmdshell`, `sys.sp_who`,
çoklu ifade ve yorum içine gizlenmiş komutları kapsar. Ayrıca yanlış alarm
üretmemesi gereken durumları (`LIKE '%delete%'`, `` `rename` ``, `c.name`)
doğrular.

---

## Proje yapısı

```
app/
  config.py     .env okuma, bağlantı dizesi üretimi
  sqlguard.py   SQL güvenlik doğrulaması (salt-okunur zorlaması)
  db.py         MSSQL/MySQL bağlantısı, sorgu çalıştırma, tip dönüşümleri
  schema.py     Şema tarama + önbellek + yapay zekaya gidecek metin
  llm.py        Claude/Groq çağrısı, araç döngüsü, lehçeye göre sistem talimatı
  main.py       FastAPI uç noktaları
static/
  widget.js     Gömülebilir widget (sağ alt köşe butonu) - tek dosya, bağımlılıksız
  demo.html     Widget'ın gömülü olduğu örnek şirket portalı
  index.html    Tam sayfa yönetim arayüzü
  app.js
  styles.css
scripts/
  demo_veritabani.py   Örnek şirket veritabanını oluşturur
schema_notes.*.md      Veritabanına özel terim sözlüğü (yapay zekaya gönderilir)
```

## API uç noktaları

| Uç nokta | Açıklama |
|---|---|
| `POST /api/sohbet` | `{message, session_id}` → cevap + SQL adımları + sonuç tablosu |
| `GET /api/sema` | Tablo/kolon/ilişki listesi (`?yenile=true` ile yeniden tarar) |
| `GET /api/sema/onizleme` | Yapay zekaya gönderilen şema metninin birebir kopyası |
| `POST /api/sql` | Elle yazılmış SELECT çalıştırır (aynı güvenlik katmanından geçer) |
| `GET /api/durum` | Bağlantı ve yapılandırma durumu |
| `GET /demo` | Widget gömülü örnek portal sayfası |

## Ayarlar (`.env`)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `DB_TYPE` | `mssql` | `mssql` veya `mysql` |
| `LLM_PROVIDER` | `claude` | `claude` veya `groq` |
| `CLAUDE_MODEL` | `claude-opus-5` | Claude modeli |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq modeli (araç çağırmayı desteklemeli) |
| `GROQ_REASONING_EFFORT` | (boş) | `gpt-oss` için `low`/`medium`/`high`; boşsa gönderilmez |
| `GROQ_MAX_TOKENS` | `1200` | Groq'ta limite sayılır; düşük tutmak kota aşımını önler |
| `MODEL_ROW_SAMPLE` | `15` | Sonucun kaç satırının yapay zekaya gönderileceği |
| `CLAUDE_EFFORT` | `medium` | `low`…`max`. Düşük = hızlı/ucuz, yüksek = karmaşık sorgularda daha isabetli |
| `MAX_ROWS` | `500` | Tek sorgudan dönebilecek maksimum satır |
| `QUERY_TIMEOUT` | `30` | Sorgu zaman aşımı (saniye) |
| `MAX_TOOL_TURNS` | `6` | Yapay zekanın ard arda çalıştırabileceği maksimum sorgu |
| `CORS_ORIGINS` | `*` | Widget'ın gömülebileceği alan adları (virgülle ayrılır) |

---

## Sohbet oturumları

Oturumlar SQLite'ta (`oturumlar.db`) saklanır. Önceden bir Python sözlüğünde
tutuluyorlardı; bunun iki sorunu vardı: sunucu her yeniden başlatıldığında tüm
konuşmalar siliniyordu (`--reload` açıkken her dosya kaydında oluyordu) ve
birden fazla worker çalıştırıldığında her worker'ın kendi kopyası olduğu için
kullanıcılar rastgele bağlam kaybediyordu.

**Sistem mesajı bilinçli olarak saklanmaz.** Sistem mesajı veritabanı şemasını
içerir; saklansaydı bir oturum başladıktan sonra şema değiştiğinde o konuşma
sonsuza dek eski şemayı kullanırdı — yani [şema tazeliği](#şema-tazeliği-canlı-veritabanı)
bölümündeki koruma sürüp giden konuşmalar için işlemezdi. Sistem mesajı her
istekte güncel şemayla yeniden üretilir. Bu ayrıca saklanan veriyi ~%86
küçültür (8.275 → 1.145 karakter).

`SESSION_TTL` (varsayılan 24 saat) dokunulmayan oturumları, `MAX_SESSIONS`
(varsayılan 500) ise toplam sayıyı sınırlar; temizlik açılışta yapılır.

### Eski sonuç satırları bağlamdan çıkarılır

Önceki turların sorgu sonuçları modele **veri satırları olmadan** gönderilir;
geriye yalnızca "N satır döndü" bilgisi kalır. Canlı veritabanında o satırlar
bayatlamış olabilir ve model güncel değeri sorgulamak yerine eskisini
tekrarlayabilirdi. İçinde bulunulan turun satırları elbette korunur — cevap
onlardan üretilir.

Her iki sağlayıcıda da geçerlidir (Groq ve Claude mesaj biçimleri farklı
olduğu için ayrı ayrı uygulanır).

> **Sınır:** Modelin kendi önceki *cevapları* sayı içermeye devam eder
> ("Sports kategorisinde 74 film var"). Bunlar silinemez, çünkü "peki en azı
> hangisi?" gibi devam soruları o bağlama dayanır. Sistem talimatı modele
> önce sorgulamasını, tahmin yürütmemesini söyler.

---

## Portal panosu (canlı özet)

Örnek portal sayfasındaki kartlar ve "Son hareketler" tablosu `/api/ozet`
ucundan **canlı** okunur; sayfada gömülü sabit rakam yoktur. Yapay zekaya
gidilmediği için token harcamaz. Sorgular 60 saniye önbelleklenir.

Aktif veritabanı için tanım yoksa bölüm boş kalır ve bunu açıkça söyler —
uydurma rakam gösterilmez. Kendi veritabanınız için tanımları
[app/ozet.py](app/ozet.py) içindeki `TANIMLAR` sözlüğüne ekleyin.

---

## Şema tazeliği (canlı veritabanı)

Şema bir kez taranıp `schema_cache.json`'a yazılır. Veritabanı canlıysa kolon
veya tablo değişebileceği için bu önbellek **`SCHEMA_TTL`** (varsayılan 1 saat)
dolduğunda kendiliğinden yeniden taranır.

Ayrıca sorgu `Unknown column` / `Invalid object name` gibi bir hata verirse
şema **anında** tazelenir ve modele güncel haliyle tekrar denemesi söylenir.
Art arda tetiklenmemesi için en fazla 60 saniyede bir yenilenir; sözdizimi
veya bağlantı hatalarında tazeleme yapılmaz.

Bu, aşağıdaki SQL önbelleğinin şema parmak izi korumasının çalışması için de
gereklidir — şema önbelleği bayat kalırsa parmak izi de bayat kalırdı.

Şemanın yaşını görmek için:

```bash
curl http://127.0.0.1:8000/api/sema
```

Şeması hiç değişmeyen kurulumlarda `SCHEMA_TTL=0` ile kapatılabilir.

---

## Soru → SQL önbelleği

Aynı soru ikinci kez sorulduğunda "hangi SQL yazılmalı" sorusu yapay zekaya
tekrar sorulmaz. Ölçülen kazanç: **4.452 → 1.959 token, 2,4 sn → 0,5 sn**.

**Veritabanı canlıysa da güvenlidir**, çünkü:

| Tehlike | Önlem |
|---|---|
| Veri değişti, eski sonuç dönebilir | **Sonuç hiç saklanmaz.** Yalnızca sorgu metni saklanır; sorgu her seferinde yeniden çalışır. |
| Şema değişti, eski SQL patlar | Önbellek anahtarı şemanın parmak izini içerir. Kolon eklenince/silinince tüm kayıtlar kendiliğinden düşer. |
| "Son 1 ay" sabit tarihe çevrilmiş, yarın yanlış sonuç verir | Sabit tarih (`'2026-08-24'`, `24.08.2026`, `20260824`) içeren sorgular **hiç saklanmaz**. `CURDATE()` / `GETDATE()` / `NOW()` kullananlar çalışma anında yeniden hesaplandığı için saklanır. |
| İş kuralları zamanla değişti | `SQL_CACHE_TTL` (varsayılan 7 gün) emniyet ağı. |
| Önbellekteki SQL bozulmuş olabilir | Çalıştırılmadan önce yine `sqlguard`'dan geçer. Hata verirse önbellek yok sayılır, model sorguyu baştan yazar. |

Yalnızca konuşmanın **ilk** sorusu ve **tek sorguyla** cevaplanan sorular saklanır;
devam soruları önceki bağlama bağlı olduğu için tek başına tekrarlanamaz.

Durumu görmek ve temizlemek:

```bash
curl http://127.0.0.1:8000/api/onbellek
curl -X POST http://127.0.0.1:8000/api/onbellek/temizle
```

Tamamen kapatmak için `.env` içinde `SQL_CACHE=off`.

---

## Bilinen sınırlar

- **Oturumlar bellekte tutulur.** Uygulama yeniden başlarsa sohbet geçmişi silinir ve
  birden fazla işçi süreçle (`--workers 2`) çalıştırılamaz. Çok kullanıcılı dağıtımda
  `app/main.py` içindeki `OTURUMLAR` sözlüğü Redis gibi bir depoya taşınmalıdır.
- **Kimlik doğrulama yok.** Uygulamayı olduğu gibi internete açmayın; şirket ağı içinde
  veya bir kimlik doğrulama katmanı (reverse proxy / SSO) arkasında çalıştırın.
- **Çok büyük şemalar.** Yüzlerce tablolu veritabanlarında şema metni uzar ve token
  maliyetini artırır. Bu durumda `app/schema.py` içine tablo filtresi eklenmelidir.
