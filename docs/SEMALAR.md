# Veri şemaları (spec bölüm 5)

Kanonik tanımlar: `src/schemas/index.ts`. Tüm ajan çıktıları bunlara uymak
zorunda; şema dışı çıktı **reddedilir**.

| Şema | Ne için |
|---|---|
| `Evidence` | Bir değerin nereden geldiği: `db` / `api` / `mcp` / `llm-inference` |
| `GoalNode` | Hedef ağacı düğümü: `goal` / `metric` / `lever` / `resource` / `action` |
| `Action` | Yürütülebilir aksiyon: risk, geri alınabilirlik, onay, dry-run, rollback |
| `Plan` | Skorlanmış plan: impact, effort, confidence, timeframe, kpi, actions |

## Evidence neden önemli

Bu oturumun en pahalı dersi: **model gördüğünü kullanır, görmediğini uydurur ve
ikisi çıktıda aynı görünür.** Kaynak işaretlenince ayırt edilebiliyor:

```ts
dogrulanmisMi(dugum)   // en az bir kanıt llm-inference DIŞINDA mı
```

Yalnızca `llm-inference` kanıtı olan bir düğüm doğrulanmamıştır.

## Agaç düz tutulur

Spec `children: string[]` istiyor — iç içe nesne değil. Sebebi pratik: iç içe
yapıda aynı düğüme iki yerden atıf yapılamıyor ve kısmi güncelleme bütün ağacı
dolaşmayı gerektiriyor. Düz yapıda düğüm kimliğiyle adreslenir; F6 geri
beslemesi de düğüme id ile bağlanır.

## Serbest metin parse etmek yasak

> *"LLM çıktısını ASLA serbest metin olarak parse etme; structured output + Zod
> validation + başarısızsa tek retry."*

`src/core/llm/yapisal.ts` bunu tek yerde uyguluyor:

1. Sağlayıcıya `jsonCikti: true` geçer → Groq'ta `response_format: json_object`
2. Zod ile doğrular
3. Başarısızsa **tek** retry, çıktı bütçesi 1.6 katına çıkar (kırpık çıktı en sık sebep)
4. O da tutmazsa `YapisalCiktiHatasi`

Geri düşüş korunuyor: model kod bloğu ya da açıklama eklerse metin içinden JSON
çıkarılır. Sağlayıcı değişince (Anthropic) davranış farklı olabilir.

Önceden `jsonAyikla` üç dosyada kopyalanmıştı — niyet, ağaç, plan. Artık tek yerde.

## Doğrulama

- 21 şema testi + 12 yapısal çıktı testi
- Gerçek modelde ilk denemede temiz JSON: 141+90 token, 585 ms

## Taşıma tamamlandı

`HedefDugumu` kaldırıldı; ağaç artık kanonik `GoalNode` şeması üzerinde ve **düz**.

| Eski | Yeni |
|---|---|
| `baslik` | `statement` |
| `tur: hedef/surucu/olcum/aksiyon` | `type: goal/lever/metric/action` |
| `cocuklar: HedefDugumu[]` (iç içe) | `children: string[]` (id listesi) |
| `olcumSorusu` | `measurementQuery` |
| `gerekce` | `rationale` |
| `durum` | `status` |
| — | `evidence[]`, `currentValue`, `targetValue` |

### Çalışma zamanı alanları ayrı tutuldu

Spec'in `GoalNode`'unda **gerekçe alanı yok**, ama gerekçe ağacın okunabilirliğinin
tamamı: *"her içgörü bir sonraki neden/nasıl katmanına inmek zorunda."* Bu alan
olmadan ağaç bir başlık listesine dönüyor.

Kanonik `GoalNode` bozulmadan bırakıldı; `GoalNodeGenis` onu genişletiyor:
`rationale`, `measurementQuery`, `status`. Üçü de açıkça **ek** olarak işaretli.

### Doğrulama (gerçek koşu)

- 13 düğüm, dağılım `goal:1, lever:3, metric:9`
- `children` gerçekten id listesi, iç içe nesne değil
- Her düğümde `evidence` alanı var
- 4 çağrı, 5.647 token

Arayüz de düz ağacı okuyor ve **kanıt kaynağını gösteriyor**: bir düğümün değeri
yalnızca `llm-inference` kanıtına dayanıyorsa *"yalnızca model tahmini — veriyle
doğrulanmadı"* yazıyor.


## Plan ve Action taşındı

`Plan` artık kanonik: `title`, `rationale`, `goalNodeIds`, `impact`, `effort`,
`confidence`, `timeframe`, `kpi`, `actions[]`. Görünüm alanları (`ajanAd`,
`renk`, `skor`, `uyari`) `PlanGenis` ile ayrı tutuluyor.

### Action alanları modelden alınmıyor

`risk`, `reversible`, `dryRunSupported`, `rollback` işlemin **kendi
özellikleri**; modele sorulsa `"risk": "low", "requiresApproval": false` deyip
geçmesi mümkün ve kimse fark etmez. Kod türetiyor:

| Alan | Nereden |
|---|---|
| `risk` | İşlem tanımındaki sabit (`bilet_ata`=low, `bilet_asama_degistir`=medium) |
| `reversible` | İşlemin `geriAl()` fonksiyonu var mı |
| `dryRunSupported` | `prova()` fonksiyonu var mı |
| `rollback` | Geri alınabiliyorsa aynı işlem, önceki değerle |
| `requiresApproval` | `onayZorunlulugunuUygula()` — geri alınamayan ya da yüksek riskli **her zaman** onay ister |

Modelden yalnızca **ne** yapılacağı (`tool` + `params`) ve **neden**
(`expectedOutcome`) alınıyor.

## Gerçek koşuda çıkan boşluk

6 plan üretildi, tüm alanlar doldu — ama **hiçbir aksiyon yürütülebilir olmadı**.
Hepsi aynı sebeple düşürüldü:

```
Gecersiz parametre: biletNo: expected string, received undefined
```

Model **toplu** aksiyon öneriyor ("düşük öncelikli tüm biletleri İşlemde yap"),
beyaz liste ise **tek bilet** üzerinde çalışıyor. Reddetme doğru davranış —
uydurma bir `biletNo` ile çalışmaktansa düşmesi iyi. Ama şu an planlar pratikte
yürütülemiyor.

**Seçilen çözüm: planı somut biletlere bağlamak** (toplu işlem değil — o tek
onayla yüzlerce kaydı değiştirirdi).

`src/core/pipeline/somutKayit.ts` ölçümün işaret ettiği gerçek kayıtları çekiyor.
Sorgu **kod tarafından, parametreli** yazılıyor; modele SQL yazdırılmıyor. Tablo
adı ölçüm SQL'inden çıkarılıp **şemaya karşı doğrulanıyor**, filtre değeri
parametre olarak gidiyor.

### Üç aşamada düzeldi

| Verilen | Sonuç |
|---|---|
| Hiçbir şey | `biletNo: expected string, received undefined` — 0 aksiyon |
| Somut bilet listesi | Gerçek biletler geldi ama `asama: "Kapalı"` uyduruldu |
| + parametre şeması (izinli enum) | Geçerli aşamalar, ama `INC123456` ve `AutoResponderBot` uyduruldu |
| + kod tarafında kimlik doğrulaması | **Tamamı gerçek** |

Son durum: `bilet_ata {biletNo: "HT21615", kisi: "Furkan Aydın"}` — bilet de kişi
de veritabanından.

### İzinli değerler koddan gelir

`aksiyonUret(oneri, izinliDegerler)` — model gerçek kayıtlar verilse bile kimlik
uyduruyor. İstem bunu engellemiyor, kod engelliyor: `biletNo` çekilen kayıtlardan,
`kisi` tablodaki gerçek atananlardan biri olmak zorunda.
