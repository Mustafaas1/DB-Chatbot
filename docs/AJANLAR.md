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

## Bilinen boşluk

Spec'in 7 ajanı **ticari** (kazanım, elde tutma, fiyatlandırma). Bu CRM'de
ayrıca **proje** (`Projects`, `ProjectTasks`, `KanbanTasks`) ve **İK**
(`LeaveRequests`, `AttendanceRecords`, `CalendarEvents`) verisi var; bunlar
7 ajanın hiçbirine ait değil.

Şimdilik `data-analyst` bu tabloları da görüyor, yani veri erişilebilir kalıyor —
ama bu tablolar için uzman bir bakış açısı yok. Ayrı `delivery` ve `people`
ajanları eklenebilir; karar verilmedi.
