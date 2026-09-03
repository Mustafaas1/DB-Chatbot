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
npm test           # 390 test
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

Soru → SSE akışı (`src/app/api/akis/route.ts`). Olay sözleşmesi:
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

Kod yalnızca **tanıyabildiği şekli** çözer: *"&lt;tablo&gt;'dan &lt;varlık&gt;
bazında adet ve tutar, &lt;zaman aralığı&gt; içinde"*. Üç koşul da gerekir —
tablo seçilebilmeli, varlık/tarih kolonu bulunmalı, zaman aralığı
ayrıştırılabilmeli. Biri eksikse ajana düşer ve kartta **"sorguyu ajan
yazdı"** rozeti çıkar.

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
