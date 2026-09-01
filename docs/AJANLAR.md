# Ajanlar (spec bölüm 4)

Her ajan kendi dosyasında: `src/agents/<kod>.ts`. Rol promptu, araç allowlist'i,
çıktı şeması ve maliyet/tur limiti bir arada durur — bir ajanın ne yapabildiği
tek yerden okunur.

| Ajan | Tür | Araçlar | Tur/Çağrı | Tablo |
|---|---|---|---|---|
| `orchestrator` | orkestra | — | 1/6 | 0 |
| `data-analyst` | planlama | `veri_sorgula` | 3/4 | 11 |
| `acquisition` | planlama | `veri_sorgula` | 2/3 | 7 |
| `retention` | planlama | `veri_sorgula` | 2/3 | 6 |
| `experience` | planlama | `veri_sorgula` | 2/3 | 4 |
| `product-pricing` | planlama | `veri_sorgula` | 2/3 | 5 |
| `delivery` | planlama | `veri_sorgula` | 2/3 | 7 |
| `people` | planlama | `veri_sorgula` | 2/3 | 6 |
| `ops-executor` | **yürütme** | `veri_sorgula`, `bilet_ata`, `bilet_asama_degistir` | 1/2 | 1 |

## Temel kural koda gömülü

> Planlama ajanlarının yazma yetkisi **yoktur**. Yazma yalnızca `ops-executor`'da.

Bu kural yorumda kalırsa bir gün biri allowlist'e yazma aracı ekler ve kimse fark
etmez. `tanimlariDenetle()` bunu zorluyor ve **modül yüklenirken** çalışıyor:
kural bozulmuşsa uygulama hiç ayağa kalkmaz.

Denetlenen invaryantlar:

- Planlama ve orkestra ajanları yazma aracı taşıyamaz
- Yürütme ajanı **tek** olabilir
- Orkestra ajanı hiç araç taşıyamaz
- Aynı kod iki kez tanımlanamaz
- Limitler pozitif olmalı

12 test bunu doğruluyor.

## Spec'e ek iki ajan

Spec'in 7 ajanı ticari; bu CRM'de ayrıca proje ve İK verisi var ve hiçbirine
ait değildi. `delivery` (teslim) ve `people` (kapasite) bu boşluğu kapatıyor.

`people` ajanının rol promptunda açık bir sınır var: **performans
değerlendirmesi yapmaz**, kişi kıyaslaması değil yük dağılımı konuşur.

## Tanımlar gerçekten kullanılıyor

Tanımda yazıp uygulamamak süs olurdu:

| Alan | Nerede kullanılıyor |
|---|---|
| `rolPromptu` | Sistem isteminin ilk satırı |
| `araclar` | `AracKaydi.altKume()` — ajan listede olmayan aracı **göremez**, şeması bile LLM'e gitmez |
| `limitler.azamiTur` | Araç çağrısı döngüsünün tur sınırı |
| `tablolar` | Şema kapsamı |

## Yönlendirme doğrulaması

Sekiz gerçek ölçüm, sekiz doğru ajan:

| Ölçüm | Ajan |
|---|---|
| Durumlarına göre teklif sayısı | Kazanım |
| Aşamalarına göre açık destek biletleri | Deneyim |
| Bu yıl bitecek sözleşmeler | Elde Tutma |
| Ürüne göre teklif kalemi sayısı | Ürün ve Fiyat |
| Tamamlanmamış proje görevleri | Teslim |
| İzin türlerine göre talep sayısı | Kapasite |
| Para birimine göre faturalanacak tutar | Elde Tutma |

`data-analyst` kolon ayırt ediciliği sayımına **katılmaz**: kesitsel olduğu
için birçok tabloyu paylaşıyor ve katılırsa diğer ajanların bütün kolonlarını
"ayırt edici değil" yapıp sinyali yok ediyor.
