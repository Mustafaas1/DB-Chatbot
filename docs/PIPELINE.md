# Boru hattı — S0…S5

Tek soruyla otomatik tetiklenen altı aşama.

| Aşama | Ne yapar | Nerede |
|---|---|---|
| **S0** INTENT | Metrik, zaman aralığı, segment ve **örtük hedef** | `pipeline/intent.ts` |
| **S1** RETRIEVE | Veriyi getirir (araç kaydı + salt-okunur SQL) | `ajan/dongu.ts`, `db/aracSorgu.ts` |
| **S2** DIAGNOSE | "Veri neden böyle" — yığılma, uzun kuyruk, aykırı | `pipeline/teshis.ts` |
| **S3** DECOMPOSE | Hedef ağacı; **kök = örtük hedef** | `hedef/agac.ts` |
| **S4** PLAN | Paralel dağıtım + skorlanmış aksiyon planları | `ajan/olcum.ts`, `pipeline/plan.ts` |
| **S5** EXECUTE | Prova → onay → uygula → geri besleme | `yaz/`, `geribesleme/` |

## Kod ve model arasındaki sınır

Bu oturumun tekrar eden dersi: **belirleyici olması gereken şey koda ait.**
Modelin yaptığı ve yapmadığı işler:

| Kodda | Modelde |
|---|---|
| S2 teşhis aritmetiği | Bulguların yorumu |
| S4 sıralama skoru (`etki × güven ÷ çaba`) | `etki`, `çaba`, `güven` tahminleri |
| Ölçüm dağıtımı (hangi ajan) | — |
| Ölçüm doğrulaması (veriye uygunluk) | — |
| Beyaz liste denetimi | İşlem parametresi önerisi |

Model uydurduğunda kod yakalıyor: olmayan işlem kodu temizleniyor, olmayan
durum değeri içeren ölçüm çalıştırılmadan eleniyor.

## Ölçülen değerler (gerçek koşu)

- S0 örtük hedef: *"Destek talebini azaltarak operasyonel maliyeti düşürmek"*
- 4 ölçüm çalıştı, 4 teşhis üretildi
- 2 plan üretildi, skora göre sıralandı: **1.60** ve **0.60**
- Yüksek skorlu plan `bilet_ata` işlemine bağlandı → **yürütülebilir**

## Bütçe

Ücretsiz Groq katmanında (8.000 TPM) tek soru:
S0 ~1 çağrı, S3 ~4, S4 ölçüm başına 1. Eş zamanlılık 2, azami ölçüm 4.

## Bilinen sınır

Doğrulayıcı **değer** uyuşmazlığını yakalıyor (`Asama='Kapalı'`), **anlamsal**
imkânsızlığı yakalayamıyor (izlenmeyen bir şeyi ölçmek istemek). Bu ölçümler
çalışıp boş dönüyor; teşhis bunu "yorumlanacak veri yok" diye dürüstçe
bildiriyor ve plan üretilmiyor.
