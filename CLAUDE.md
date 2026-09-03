# Otonom İş Zekâsı Ajan Sistemi

Bir iş sorusunu hedef ağacına çevirir, dalları bölüm ajanlarına dağıtır,
her ajan kendi verisini sorgular, sonuçtan skorlu aksiyon planları üretir
ve onaylanan aksiyonları geri alınabilir şekilde uygular.

**Yığın:** Next.js 15 (App Router, Turbopack) · TypeScript · Node 24 ·
vitest · Zod 4 · MS SQL Server (`mssql`/tedious) · `node:sqlite`

**LLM:** Groq `openai/gpt-oss-120b`. Sağlayıcı soyutlanmış
(`src/core/llm/`); Anthropic'e geçiş tek dosyalık iş.

---

## Komutlar

```bash
npm run dev        # geliştirme sunucusu
npm test           # 460 test
npm run typecheck  # tsc --noEmit
```

## Çalışma kuralları

1. Kod yazmadan önce plan sun, onay al.
2. Sahte/mock veriyle "çalışıyor" görüntüsü verme; mock varsa açıkça belirt.
3. Her fazda bu dosyayı güncelle.
4. `any` yasak — `src/__tests__/tipGuvenligi.test.ts` bunu zorluyor.
5. Yanıtlar Türkçe. Tanımlayıcı dili: aşağıdaki tabloya bak.

### Tanımlayıcı dili

| Alan | Dil | Neden |
|---|---|---|
| `core/pipeline`, `core/hedef`, `core/butce`, `core/otonomi`, `core/guvenlik` | **İngilizce** | alan-bağımsız çekirdek |
| `core/yaz`, `core/db`, `core/ajan`, `core/tools`, `core/llm`, `core/geribesleme` | Türkçe | CRM kolon adlarıyla iç içe; `asama` değişkeni `Asama` kolonunu tutuyor, çevirmek eşlemeyi gizler |
| `src/app`, `src/agents` | Türkçe | arayüz metni ve alan sözlüğü |
| Yorumlar | Türkçe | her yerde |

**Asla değişmeyenler** — bunlar tanımlayıcı değil, veri:
araç kodları (`bilet_ata`…, denetim kaydında saklı) · saklı yordam adları
(`sp_ajan_*`) · DB giriş adları (`ajan_okur`/`ajan_yazar`) · SQL kolon ve
tablo adları · veri değerleri (`Tamamlandı`, `Kazanıldı`…) · SQLite kolon
adları · ortam değişkenleri (`OTONOMI_MODU`…) · SSE olay adları ve yük
alanları · `"otomatik:"` öneki · istem metinleri · CSS sınıfları

Sınırda karışıklık **beklenen**: `yurutucu.ts` (Türkçe) `canRunAutomatically`
çağırır. Kapsam dışı bir dosyada yalnızca API'nin zorladığı adlar değişir,
yerel değişkenler Türkçe kalır.

---

## Yön veren ilke

**Belirleyici olması gereken şey koda alınır, isteme bırakılmaz.**

Bu proje boyunca modelin uydurduğu her şey (tablo, kolon, durum değeri,
bilet numarası, kişi adı, risk seviyesi, toplam, yüzde) düzyazı kuralla
değil kod tarafındaki doğrulamayla çözüldü. Bir kural derleyici, test ya
da veritabanı tarafından zorlanmıyorsa er ya da geç bozulur.

Somut sonuçları:

- Skor, özet, dönem farkı, segment dilimleri → **aritmetik kodda**
- Listeleyici ölçümün ve neden analizinin **SQL'i kodda üretiliyor**
- Geçerli durum değerleri **veritabanından okunuyor**, dosyaya yazılmıyor
- Aksiyon kimlikleri **gerçek kayıtlara karşı doğrulanıyor**

---

## Boru hattı

Soru → SSE akışı (`src/app/api/akis/route.ts`); arayüzde her olay bir
sohbet mesajı olur. Olay sözleşmesi:
`src/core/pipeline/olaylar.ts` (`StreamEvent`) — sunucu ve istemci aynı tipi
kullanır.

| Aşama | Modül | Not |
|---|---|---|
| S0 Niyet | `pipeline/intent.ts` | örtük hedef, metrik, zaman aralığı |
| S1 Hedef ağacı | `hedef/agac.ts` | düz `GoalNode[]`, `children: string[]` |
| Listeleyici ölçüm | `hedef/listeleyici*.ts` | **SQL kodda**, 0 token |
| Varlık odaklı cevap | `pipeline/varlik*.ts` | **ölçüm kodda**, cümle modelde, sayılar doğrulanır |
| Doğrudan cevap | `pipeline/dogrudanCevap.ts` | **hibrit**: şekil tanınırsa SQL kodda, değilse ajan |
| Neden analizi | `pipeline/nedenAnalizi*.ts` | **SQL kodda**, 0 token |
| S2 Dağıtım | `ajan/dagitici.ts` | çeşitlilik sırası: kota kesince çok ajan |
| S3 Ölçüm | `ajan/olcum.ts` | zemin + değer doğrulaması, sonra çalıştır |
| S4 Teşhis | `pipeline/teshis.ts` | LLM yok, tamamı aritmetik |
| S5 Plan | `pipeline/plan.ts` | skor kodda, aksiyon gerçek kayda bağlı |
| F6 Geri besleme | `geribesleme/` | önce/sonra ölçüp etki raporu |

### Doğrudan cevap: hibrit

Kod yalnızca **tanıyabildiği şekli** çözer. Üç ön koşul her şekil için
ortak: tablo seçilebilmeli, varlık/tarih kolonu bulunmalı, zaman aralığı
ayrıştırılabilmeli. Biri eksikse ajana düşer ve kartta **"sorguyu ajan
yazdı"** rozeti çıkar.

| Şekil | Örnek | Sonuç |
|---|---|---|
| `liste` | *"Son 1 ayda satın alım yapan müşterileri getir"* | varlık başına adet + tutar |
| `sayim` | *"Bu ay kaç bilet açıldı?"* | tek sayı + benzersiz varlık |
| `siralama` | *"En çok satan ürünler"* | sıralı ilk 15 |

Şekil tanıma `pipeline/soruSekli.ts`'te, saf fonksiyon. **Tanıyamadığında
`null` döner** — zaman ayrıştırıcıdaki kararın aynısı: yanlış tanıyıp
yanlış SQL üretmektense ajana düşmek doğru. Sıralamada gruplama kolonu
sorudan çıkarılamıyorsa (*"En çok gecikmeli teslimat"*) yine ajana
düşülüyor; rastgele bir kolona gruplamak sessizce yanlış cevap üretirdi.

Gerçek veriyle ölçüldü, hepsi **0 token**: sayım 13 ms (459 kayıt · 243
benzersiz), sıralama 11 ms (15 ürün), tutar sıralaması 10 ms (SUM'a
geçti). `DirectAnswerPlan` ayrık birleşim — sıralamaya ait kolonu sayım
planında okumak derleme hatası.

Zaman ayrıştırıcı (`pipeline/zamanAraligi.ts`) `"son 1 ay"` ile `"bu ay"`ı
ayırır: ilki 30 gün geriye, ikincisi ayın 1'inden bugüne. Ayrıştıramadığı
ifadeyi (`"kanala göre"`, `"aylık"`) tahmin etmez, `null` döner.

Ölçülen fark: kod yolu üç ardışık koşuda **aynı 52 satırı** verdi, 0 token,
3–14 ms. Ajan yolu aynı soruya bir koşuda 73 satır, diğerinde
`AND Tutar IS NOT NULL` ekleyip 33 satır dönmüştü.

**Kaynak tablo kullanıcıya bırakıldı.** "Satın alım" hem `Teklifler` hem
`Invoices` olarak yorumlanabiliyor ve otomatik seçim koşudan koşuya
değişebiliyordu. Kart artık seçili tabloyu gösteriyor ve alternatifleri
tıklanabilir sunuyor (`POST /api/dogrudan`); geçiş 0 token, ~10 ms.
Belirsizliği gizleyip birini seçmektense görünür kılmak doğru.

### Varlık odaklı danışman cevabı

*"Fellas diye bir müşteriye bu ay kaç kere satış yaptık?"* — cevap bir
liste değil, **tek varlığın sayısı ve o sayının anlamı**. Üç adım:

**1. Adı model çıkarır, kod doğrular.** Niyette `varlik` alanı var ama
bağlayıcı değil: kod adı `LIKE` ile veritabanında arar
(`pipeline/varlik.ts`). Tek eşleşme → profil. Birden fazla → **kullanıcıya
seçtirilir** (`"ADA"` iki müşteriye uyuyor). Sıfır → *"böyle bir kayıt
yok"*. Modelin yazdığı ada güvenmek, uydurulmuş müşteri adını gerçek gibi
göstermek olurdu.

**2. Gerçek kartı kodda hesaplanır** (`pipeline/varlikProfili.ts`, iki
sorgu, 0 token): bu dönem / önceki eşdeğer dönem, tüm geçmiş, son
kayıttan bu yana geçen gün, **varlığın kendi ortalama alım aralığı**,
aynı dönemdeki diğer varlıklara göre yüzdelik dilim. Bunlardan
**gözlemler** türetilir (gecikme, hareketsiz, düşüş, artış, üst dilim,
ortalama altı, yeni) — eşikler adlandırılmış sabitler.

**3. Cümleyi model kurar, sayıları kod doğrular**
(`pipeline/tavsiye.ts`). Modele **yalnızca hesaplanmış gerçekler**
veriliyor ve ürettiği metindeki **her sayı** bu kümeye karşı
denetleniyor. Listede olmayan sayı varsa metin **tümüyle reddedilir**,
kod kendi cümlesini kurar ve arayüz bunu yazar. Reddedilen taslak da
katlı olarak gösteriliyor: denetimin neyi elediğini görmeden ona
güvenmek için sebep yok.

Gerçek koşuda yakalananlar: model *"önümüzdeki **30 gün** içinde kampanya
planlayın"* yazdı — 30 verilmiş bir süre değil, doğru bir ret. Aynı
koşuda `98 400 TRY` boşluklu binlik ayracı yanlışlıkla iki sayı sanılmıştı;
ayırıcı düzeltildi (`bosluklariBirlestir`).

Kota dolduğunda ya da model hata verdiğinde kart **yine çalışıyor**:
sayılar zaten kodda, yalnızca cümle kalıplı hale geliyor.

Varlık tanındığında doğrudan cevap **atlanıyor** — tek müşteri sorulmuşken
52 müşteriyi "sorunun cevabı" diye göstermek soruyu cevaplamamak olurdu.

### Neden bazı ölçümlerin SQL'i kodda

Ajana yazdırılan listeleme ölçümü koşuya göre 20 satır ya da 0 satır
dönüyordu; bu ölçümün işi KPI cevaplamak değil, aksiyonun bağlanacağı
somut kimlikleri üretmek. Cevabı sabit olduğu için modelden geçmesinin
faydası yok, zararı var. Sorgular yine `sqlDogrula`'dan geçiyor.

### İstemlerin dili

Model kuraldan çok **örneği** taklit ediyor. İstem örnekleri ASCII
yazılmıştı ve çıktı da ASCII'ye düşüyordu: gerçek bir koşuda niyet alanı
*"satisi yukseltilmek"* çıktı — hem bozuk hem devrik, ve bu metin
kullanıcıya olduğu gibi gösteriliyor.

`intent.ts` ve `hedef/istem.ts` örnekleri düzgün Türkçeye çevrildi, iki
isteme de açık dil kuralı eklendi. `pipeline/__tests__/istemDili.test.ts`
geri kaymayı yakalıyor ve kapsamı bilerek dar: **yalnızca örnek blokları**.
Kural düzyazısı ASCII kalabilir, model onu taklit etmiyor — ilk sürüm
bütün dosyaya bakıyordu ve kuralın içinde kasten alıntılanan bozuk örneği
hata sanıyordu. Testin kendisi de mutasyonla doğrulandı: bir örnek
ASCII'ye çevrildiğinde test başarısız oluyor.

### Canlı destek arayüzü: yalnızca cevap

Transkript müşteriye dönük sadeleştirildi. Kaldırılanlar: niyet kutusu,
SQL gösterimi, `ms` süreleri, ajan ölçüm kartları, teşhis ve aksiyon
planları. Kalanlar: **cevap kartı** (doğrudan cevap / varlık profili) ve
**neden analizi**.

**Ajan ölçüm aşaması kapatıldı.** Ölçüldü: kartlar kaldırıldıktan sonra
bu aşama hiçbir görünür çıktı üretmiyordu — 130 saniye sonra hâlâ *"Elde
Tutma Ajanı çalışıyor"* yazıyor, ekranda ise saniyeler içinde hazır olmuş
iki kart duruyordu. Kapatınca koşu **130+ sn → ~20 sn**.

Doğruluk açısından da kazanç: görünen her sayı artık **kodda üretilen
SQL'den** geliyor. `dagit`, `olcumleriCalistir` ve `plan.ts` duruyor;
hedef ağacı sekmesi ve yazma katmanı (F5, işlem kaydı) bağımsız çalışıyor.

Doğrudan cevabın **ajan geri düşüşü korundu**: şekil tanınmayan soru
cevapsız kalmasın diye. O yolda kartta **"sorguyu ajan yazdı"** rozeti
çıkıyor ve sonuç koşudan koşuya değişebiliyor.

### Para birimi karıştırma hatası

`buildEntityQuery` yalnızca varlığa göre gruplayıp `MAX(ParaBirimi)`
alıyordu. Hem TRY hem USD teklifi olan bir müşterinin iki birimdeki
tutarı **tek toplamda birleşip** rastgele bir birimle etiketleniyordu.

Gerçek veride yakalandı — ekranda USD toplamı **19.711,68**, doğrusu
**5.311,68**; TRY adedi 79, doğrusu 80. Sebep tek bir müşteriydi
(`YENERLER YAPI`, 3 teklif, 2 para birimi).

`comparePeriods` bu kurala zaten uyuyordu (*"farklı birimleri tek
toplamda birleştirmek anlamsız bir sayı üretir"*); `buildEntityQuery`
uymuyordu. Gruplamaya para birimi eklendi, testle sabitlendi. Düzeltme
sonrası ekrandaki dört toplam da veritabanıyla birebir tutuyor.

### Boş ölçümler: iki farklı şey, iki farklı çare

`bosMu` tek bayrağı **iki durumu aynı sayıyordu** ve hangisinin baskın
olduğu ölçülemiyordu. `sorguCalisti` ile ayrıldı:

| Durum | Anlamı | Çaresi |
|---|---|---|
| sorgu çalıştı, 0 satır | veri gerçeği | ağacın ürettiği ölçüm veriye oturmuyor |
| ajan sorgu yazmadı | sistem hatası | kota, istem ya da döngü |

Ölçüldü — *"Son 1 ayda satın alım yapan müşterileri getir"*, 8 ölçüm:
**4 tanesi "0 satır", 2 tanesi "sorgu yazılmadı", 2 tanesi kullanılabilir.**

Boşların başlıkları sebebi gösterdi: *"**Aktif** müşterilerin toplam
harcaması"*, *"Ürün bazında **tekrar eden satın alma oranı**"* — veride
karşılığı olmayan filtreler.

**Sebep `veriOzeti.ts`'te bulundu:** `degerler` parametresi alınıyordu ama
**gövdede hiç kullanılmıyordu**. Ağaç kolon *adlarını* görüyor, içindeki
*değerleri* görmüyordu; `Durum` kolonunu görüp "Aktif" diye tahmin
ediyordu. Oysa liste `ContractRecords.Asama = 'Aktif', 'Pasif'` diyor —
"Aktif" var ama **sözleşmelerde**, müşteride değil. Değer listesi yalnızca
**~213 token** ve ajan isteminde zaten vardı; boşa giden tek ölçüm ~3.000
token.

**Ölçüldü — aynı soru, öncesi ve sonrası:**

| | Önce | Sonra |
|---|---|---|
| sorgu çalıştı, **0 satır** | **4 / 8** | **0 / 9** |
| kullanılabilir sonuç | 2 / 8 | 6 / 9 |
| ajan sorgu yazmadı (kota) | 2 | 3 |
| üretilen plan | 2–6 | 12 |

Hedeflenen metrik "0 satır" oranıydı çünkü ağacın kalitesini o ölçüyor;
"sorgu yazmadı" kotaya bağlı ve ağaçla ilgisi yok. Başlıklar da düzeldi —
uydurma filtre kalmadı: *"Müşteri başına ürün çeşitliliği"*, *"Tekliften
faturalamaya dönüşüm oranı"*.

**Tek koşu, tek karşılaştırma.** Ağaç modele bağlı ve koşular arası
değişken; bu güçlü bir kanıt ama kesin bir ispat değil.

Yan bulgu: kota dolduğunda arayüz *"Kriterlere uygun veri bulunamadı"*
yazıyordu — kullanıcı veride kayıt yok sanıyordu. Artık ajanın gerçek
cevabı (*"Yapay zeka kotası doldu"*) gösteriliyor.

`AjanSekmeleri.tsx` `OlcumSonucu`'nun elle yazılmış bir kopyasını
tutuyordu ve ayrışmıştı (`satirSayisi` yoktu). Kanonik tipe bağlandı.

---

## Ajanlar (9)

`src/agents/` — her biri ayrı dosya, `AJAN_TANIMLARI` içinde kayıtlı.

**Planlama (8):** `orchestrator`, `data-analyst`, `acquisition`,
`retention`, `experience`, `product-pricing`, `delivery`, `people`
**Yürütme (1):** `ops-executor` — yazma yetkisi olan **tek** ajan

`tanimlariDenetle()` modül yüklenirken çalışır: planlama ajanına yazma
aracı sızmışsa ya da birden fazla yürütme ajanı varsa uygulama **hiç
ayağa kalkmaz**. Kuralın sessizce bozulmasındansa gürültülü durması
yeğlenir.

### Alan sözlüğü

Sekiz ajanın `rolPromptu`'nda **alan sözlüğü** var (~120 token): iş
formülleri, kolon tipi tuzakları, hiyerarşiler. Kaynak, silinen Python
botunun ajan dokümanlarıydı (`git show HEAD:ajanlar/`).

**Süzülerek** taşındı: genel istemde zaten olan kurallar (`IsDeleted`,
para birimi gruplama, "açık bilet", Türkçe karakterler, durum değerleri)
**tekrarlanmadı**. Yalnızca genel istemin kapsamadığı bilgi girdi.

A/B testiyle ölçüldü — sözlük hatayı düzelttiği yerler:

| Soru | Sözlüksüz | Sözlüklü | Gerçek |
|---|---|---|---|
| Kazanma oranı | %21,2 (tüm tekliflere böldü) | %94,1 | 32/(32+2) doğru |
| Yüksek öncelikli bilet | `Oncelik=1` → 5.995 | `Oncelik=4` → 5 | 1 en yaygın, 4 en seyrek |

Fark yaratmadığı yerler: para birimi toplamı (genel istemde zaten var),
gecikmiş görev tanımı (model zaten biliyordu). Yani sözlüğün değeri eşit
dağılmıyor; ölçmeden eklemek token israfı olurdu.

Her ajanın `tablolar` kapsamı var. Kod tarafından kurulan ölçümler
(doğrudan cevap, listeleyici) dağıtıma girmez, `data-analyst`'e sabittir:
anahtar kelimeyle seçim kapsamı tutmayan bir ajana düşürüp sonucu
boşaltıyordu.

---

## Yazma katmanı (F5)

Beyaz liste — `src/core/yaz/islemler.ts` + `ticariIslemler.ts`:

| İşlem | Tablo | Risk | Kimlik |
|---|---|---|---|
| `bilet_ata` | TicketRecords | low | `BiletNo` |
| `bilet_asama_degistir` | TicketRecords | medium | `BiletNo` |
| `teklif_temsilci_ata` | Teklifler | low | `TeklifNo` |
| `teklif_durum_degistir` | Teklifler | medium | `TeklifNo` |
| `fatura_durum_degistir` | Invoices | **high** | `Id` |

Akış: `oner` (prova) → **insan onayı** → `uygula` → gerekirse `geriAl`.
Her adım denetim kaydına yazılır; reddedilenler ve başarısızlar dahil.

`SilinmisIslem` tipi (`yaz/tipler.ts`): farklı parametre tipli işlemleri
tek dizide tutar. Metotlar `unknown` alır ve çağrılmadan önce kendi Zod
şemasıyla doğrular — `any`'nin yerine geçen ek bir güvenlik katmanı.

### Üç katmanlı güvenlik

1. **Kod** — `sqlDogrula`, beyaz liste, parametre şemaları
2. **Veritabanı** — `ajan_okur` salt okuma + 8 tabloya `DENY`;
   `ajan_yazar`'ın **hiçbir tabloya** yazma yetkisi yok, yalnızca saklı
   yordamlara `EXECUTE`
3. **Sınır** — satır/süre limitleri, tek işlemde en fazla `AZAMI_ETKI` kayıt

Kurulum: `sql/f5_yazma.sql`, `sql/f5_teklif_fatura.sql` (UTF-8 **BOM'lu**;
sqlcmd BOM'suz UTF-8'i ANSI sanıp Türkçe karakterleri bozuyor).

---

## Güvenlik ve otonomi sınırları

**Otonomi modları** (`core/otonomi/mod.ts`) — varsayılan `assisted`:

| | manual | assisted | auto |
|---|---|---|---|
| low | onay | **oto** | **oto** |
| medium | onay | onay | **oto** |
| high | onay | onay | onay |

`risk=high` **veya** `reversible=false` hiçbir modda otomatik çalışmaz.
Kontrol mod okunmadan **önce** yapılır: yeni bir mod eklendiğinde kuralın
dışında kalması mümkün olmasın.

**Prompt injection** (`core/guvenlik/enjeksiyon.ts`) — iki katman: araç
çıktısı `<<<VERI>>>` sınırları içine alınır (kod), modele bu sınırların
anlamı söylenir (istem, en üstte). Veri kendi kapanış sınırını yazıp
talimat alanına sızamaz. Veri **değiştirilmez**, sadece çerçevelenir.

Kalıplar Unicode harf sınıfı kullanır: `\b` ASCII tabanlı olduğu için
Türkçe enjeksiyon denemeleri (`Önceki tüm kuralları unut`) işaretlenmeden
geçiyordu.

**Bütçe** (`core/butce/butce.ts`) — soru başına token + tur limiti. Aşımda
**durur ve sorar**; kendiliğinden devam etmez. "Devam et" ağacı yeniden
kurmadan kalan ölçümleri çalıştırır.

`.env`: `OTONOMI_MODU`, `BUTCE_TOKEN`, `BUTCE_TUR`

---

## Kanonik şemalar

`src/schemas/index.ts` — spec bölüm 5. **Tek kaynak**; arayüz kendi
kopyasını tanımlamaz (bir kez tanımladı ve sessizce ayrıştı).

`Evidence` · `GoalNode` / `GoalNodeGenis` · `Action` · `Plan`

Kod tarafından zorlanan invaryantlar:

- `planSkoru()` — etki × güven ÷ çaba, modelden alınmaz
- `onayZorunlulugunuUygula()` — geri alınamaz ya da yüksek riskli aksiyon
  **mutlaka** onay ister; modelin `requiresApproval: false` demesi geçersiz
- `dogrulanmisMi()` — kanıt yalnızca `llm-inference` ise değer doğrulanmamıştır

---

## Gömülü widget

Arayüz portala `<script>` ile eklenen bir **canlı destek botu**: sağ altta
yuvarlak buton, tıklayınca açılan panel.

```
Portal sayfası
└── public/widget.js          host tarafı, ~140 satır
    └── iframe (sağ alt sabit)
        └── /widget           FAB + panel, CSS tamamen izole
```

**Neden iframe, shadow DOM değil:** portalın kendi CSS'i var. Shadow DOM
sızıntıyı tek yönde durdurur, iframe iki yönde de keser. Yuvarlak buton
dahil her şey iframe'in içinde; host tarafına yalnızca "çerçeveyi şu
boyuta getir" işi kalıyor.

**Protokol** (`widget.js` ↔ `widget/kabuk.ts`) — üç mesaj, başkası kabul
edilmiyor:

| Yön | Mesaj |
|---|---|
| iframe → host | `hazirim` (sır taşımaz) |
| host → iframe | `hazir` + token |
| iframe → host | `boyut`: `kapali` (88) / `panel` (452) / `genis` (912) |

**El sıkışmayı iframe başlatır.** Önce host, iframe'in `load` olayında
`hazir` gönderiyordu; React dinleyicisi `useEffect` içinde, yani `load`'dan
*sonra* bağlanıyor ve mesaj kayboluyordu — panel açılıyor ama çerçeve
büyümüyordu. Sıra tersine çevrildi: host'un dinleyicisi script yüklenirken
bağlı olduğu için iframe mount olduğunda kesinlikle hazır.

Gönderen üç kontrolden geçer: doğru origin, doğru pencere, doğru imza.
Üçü olmadan sayfadaki herhangi bir script widget'ı yönetebilirdi.

**Çerçeveleme izni** `CORS_ORIGINS`'ten üretilir (`next.config.ts`):
boş → `'self'` (güvenli varsayılan), liste → `'self'` + adresler,
`*` → harfiyen uygulanır ve uyarı basılır. `/widget` dışındaki her rota
`X-Frame-Options: DENY` alır.

`public/gomme-ornegi.html` gerçek portal **değildir**: kendi CSS'i olan
yabancı bir host sayfada widget'ın doğru konumlanıp konumlanmadığını
denemek için var, içeriği yer tutucudur.

### Erişim belirteci

`src/middleware.ts` **tüm** `/api/*` uçlarını kapatıyor; önce hiçbir
kontrol yoktu ve içlerinde yazma tetikleyen `/api/islem` de var.
Karşılaştırma `core/guvenlik/belirtec.ts` içinde ve **sabit sürede**:
`===` ilk farklı karakterde döner, süreyi ölçen biri belirteci karakter
karakter keşfedebilirdi.

`API_TOKEN` boşsa kontrol kapalı ve süreç başına bir kez uyarı basılıyor —
yerel geliştirmede yapılandırma zorunluluğu getirmemek için, ama sessizce
değil.

**Belirtecin tek yolu var: postMessage.** Önce `widget.js` onu iframe
adresine `#token=` olarak da koyuyordu; widget bunu `sessionStorage`'a
yazınca host `data-token`'ı kaldırsa bile sekme kapanana kadar eski
belirteç geçerli kalıyordu. Artık `belirteciTopla()` çerçeve içindeyse
hiç çalışmıyor — orada tek yetkili kaynak host.

Belirteç sayfanın HTML'ine **gömülmüyor**. Gömülseydi `/` adresini
açabilen herkes okuyabilir ve kapı hiçbir şey korumazdı; anahtarı kapının
üzerine asmak olurdu.

`/api/*` çağrıları tek kapıdan geçiyor (`app/istek.ts`): yeni bir uç
eklendiğinde başlığı unutmak mümkün olmasın.

**İstekler el sıkışmayı bekliyor.** Gerçek bir koşuda görüldü: widget
açılır açılmaz `/api/plan` ve `/api/akis` çağrıları gidiyor ama belirteç
`postMessage` ile *sonra* geliyordu — ilk istekler 401, belirteç gelince
sonrakiler 200 dönüyordu. `agIstegi` artık `belirteciBekle()` ile
bekliyor. Bozuk bir host'ta arayüz donmasın diye 3 sn emniyet zaman aşımı
var ve uyarı basıyor. Hazırlık kurulumu hangi bileşenin önce mount
olduğuna bağlı değil: React alt bileşenlerin efektlerini üsttekilerden
önce çalıştırıyor, sıralamaya güvenmek kırılgan olurdu.

**CORS bilerek yok.** Widget iframe'i kendi kaynağımızdan servis ediliyor,
dolayısıyla `/api/*` çağrıları aynı kaynak. Kullanılmayan CORS makinesi
eklemek, ileride yanlışlıkla güvenilen ölü bir kural bırakmak olurdu.
Portalın kendi JavaScript'i API'yi doğrudan çağıracaksa o zaman eklenmeli.

### Sohbet transkripti

Boru hattı önce sayfada alt alta yığılıyordu. Canlı destek botunda doğru
karşılık bu değil: SSE olayları zaten **sırayla** geliyor, yani akış doğal
olarak bir konuşma. Soru kullanıcı balonu, her aşama ajanın bir mesajı.

| Genişlik | Ne var |
|---|---|
| 452 (panel) | Transkript; sekme çubuğu yok, altta kısayol pilleri |
| 912 (geniş) | Üstte Sohbet / Hedef ağacı / İşlemler sekmeleri |

Dar panelde plan kartları, sonuç tabloları ve hedef ağacı sığmıyor.
Sığmayanı küçültüp okunmaz yapmaktansa geniş mod var; **erişim de
kapanmıyor** — dar moddaki kısayollar paneli genişletip ilgili sekmeyi
açıyor. Tablolar daraltılmıyor, kendi içinde kaydırılıyor: sütunları
sıkıştırmak sayıları okunmaz yapardı.

**Tek render yolu.** `Sohbet.tsx` hem `/widget` panelinde hem `/`
sayfasında aynı; akışın bütün durumu `app/akis.ts` kancasında. İki kopya
tutmak, birinde yapılan düzeltmenin diğerine geçmemesi demekti — bu proje
o hatayı F6'da bir kez yaşadı.

**İlerleme göstergesi gerçek olaylara bağlı.** Önceki sürüm tanımadığı
durum metninde 3 saniyede bir adım ilerletiyordu; bu, olmamış ilerlemeyi
olmuş gibi göstermekti. Artık adım yalnızca gerçek aşama metniyle
eşleşince ilerliyor, tanınmayan metinde olduğu yerde kalıyor.

### Durum

A (gömme katmanı), B (belirteç kapısı) ve C (sohbet arayüzü) bitti,
üçü de uçtan uca doğrulandı: 88 → 452 → 912 → 88 döngüsü, CSP başlığı,
belirteçli/belirteçsiz akış, dar ve geniş modda tam boru hattı.

Eski sayfa düzeninden kalan 34 ölü CSS kuralı silindi (`.sarmal`,
`.ai-adim*`, `.niyet-kart`…); `global.css` 791 → 670 satır.

---

## Kalıcı depolar (SQLite, `veri/`, gitignore'da)

- `denetim.db` — denetim kaydı + F6 ölçüm bağlamı/snapshot'ları
- `red.db` — reddedilen planlar; **sistemin öğrenen tek parçası**, sebep
  aynı ajana sonraki turda bağlam olarak verilir

---

## Bilinen sınırlar

- **Edinim kanalı verisi yok.** Hiçbir tabloda tutulmuyor;
  `TicketRecords.Kanal` destek kanalı, ikisi eşit değil. Kanal yerine
  veride **gerçekten olan** kırılımlar veriliyor (`pipeline/kirilim.ts`):
  atıf (`SatisTemsilcisi`/`AtananKisi`), kategori (`Kanal`, `Periyot`,
  `UrunTipi`) ve yeni/mevcut oranı. Kart bunların **edinim kanalı
  olmadığını** açıkça yazıyor. Gerçek çözüm CRM'e `Kaynak` kolonu eklemek.

  Kırılımlar iki süzgeçten geçer: 12'den fazla farklı değer varsa
  *çok dağınık* (`Invoices.UrunAdi` 73 satırda 58 değer), tek kova %90'ı
  aşıyorsa *bilgi taşımıyor* (`IskontoTuru` %100 boş). İkisi de
  gösterilmez — "kırılım" diye gürültü sunmak veriyi yanlış temsil eder.
- **Segment kolonu yok.** Harcama dilimleri **türetiliyor** ve arayüzde
  öyle etiketleniyor. Tutarı boş kayıtlar ayrı raporlanır, "düşük" sayılmaz.
- **Varlık kartı tek tablo üzerinde.** Profil, neden analiziyle aynı
  tabloyu kullanıyor; müşterinin hem faturası hem teklifi varsa ikisi
  birleştirilmiyor. Join'e girmek sorguyu bu şemaya sabitlerdi.
- **Koşular arası değişkenlik.** Ağacın ürettiği ölçümler modele bağlı;
  aksiyonlu plan sayısı koşudan koşuya değişiyor.
- **Groq ücretsiz katmanı** 8.000 TPM / 200.000 TPD — tasarımın baskın
  kısıtı. Kapsam daraltma, ölçüm eleme ve kod tarafı SQL bu yüzden var.

## Açık konular

- **Depo hâlâ public.** Şirket CRM şeması ve niyet örneklerinde gerçek
  müşteri adları (`Fellas`) var. Kullanıcı private'a çevireceğini bildirdi;
  çevrilene kadar bu depoya yeni gerçek veri eklenmemeli.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
