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

## Henüz yapılmadı

Mevcut `HedefDugumu` ve `Plan` tipleri kanonik şemalara **taşınmadı**. İç yapı
hâlâ iç içe ağaç ve eski alan adlarını kullanıyor. Şemalar sözleşme olarak
tanımlı ve test edilmiş durumda; taşıma ayrı adım.
