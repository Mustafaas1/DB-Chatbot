import * as denetim from "../yaz/denetim";
import * as depo from "./depo";
import { etkiHesapla } from "./etki";
import { donguCalistir } from "../ajan/dongu";
import { sistemIstemi } from "../ajan/istem";
import type { AracKaydi } from "../tools/kayit";
import type { Saglayici } from "../llm/tipler";
import type { GeriBeslemeOlayi, OlcumBaglami, OlcumSnapshot } from "./tipler";

/**
 * Geri besleme dongusu.
 *
 * Bir denetim kaydina ait olcumleri YENIDEN calistirir, onceki snapshot
 * ile karsilastirir ve etki raporu uretir. SSE uyumlu AsyncGenerator.
 *
 * Akis:
 *   1. Denetim kaydini oku
 *   2. Olcum baglamlarini bul
 *   3. Onceki snapshot'lar varsa oku; yoksa uyari ver
 *   4. Ayni olcumleri tekrar calistir → sonraki snapshot
 *   5. Etki hesapla → rapor olaylari yayinla
 */

export interface GeriBeslemeDonguSecenekleri {
  denetimId: string;
  saglayici: Saglayici;
  kayit: AracKaydi;
  /** Onceki snapshot yoksa olcumu simdiden calistirip referans al. */
  referansOlustur?: boolean;
}

export async function* geriBeslemeCalistir(
  s: GeriBeslemeDonguSecenekleri
): AsyncGenerator<GeriBeslemeOlayi> {
  const t0 = Date.now();
  const kayit = denetim.getir(s.denetimId);

  if (!kayit) {
    yield { tur: "hata", mesaj: `Denetim kaydı bulunamadı: ${s.denetimId}` };
    return;
  }

  if (kayit.durum !== "uygulandi") {
    yield { tur: "hata", mesaj: `Yalnızca "uygulandı" durumundaki işlemler ölçülebilir (şu an: "${kayit.durum}").` };
    return;
  }

  yield { tur: "basladi", denetimId: s.denetimId, islemAdi: kayit.islemAdi };

  // Ölçüm bağlamlarını bul
  const baglamlar = depo.baglamlariGetir(s.denetimId);
  if (!baglamlar.length) {
    yield { tur: "uyari", mesaj: "Bu işlemle ilişkili ölçüm bağlamı bulunamadı. İşlem F6 entegrasyonu öncesinde yapılmış olabilir." };
    yield { tur: "bitti", toplamSure: Date.now() - t0 };
    return;
  }

  // Önceki snapshot'ları kontrol et
  const onceSnapshot = depo.snapshotlariGetir(s.denetimId, "once");
  const gercekOnceMi = onceSnapshot.length > 0;

  if (!gercekOnceMi) {
    yield {
      tur: "uyari",
      mesaj: "Bu işlem için uygulama öncesi referans snapshot yok. Yalnızca şu anki durum ölçülecek; gerçek bir önceki/sonraki karşılaştırması yapılamaz.",
    };
  }

  // Her bağlam için: önce snapshot'ı bul/oluştur, sonra ölçümü çalıştır, etki hesapla
  for (const baglam of baglamlar) {
    // ONCE snapshot
    let once: OlcumSnapshot | null = onceSnapshot.find(
      (s) => s.dugumId === baglam.dugumId
    ) ?? null;

    if (!once && s.referansOlustur !== false) {
      // Referans snapshot'ı şimdi oluştur
      try {
        once = await olcumCalistirVeKaydet(
          s, baglam, "once"
        );
        if (once) yield { tur: "once_tamam", snapshot: once };
      } catch (e) {
        yield { tur: "hata", mesaj: `Referans ölçüm başarısız (${baglam.soru}): ${e instanceof Error ? e.message : String(e)}` };
        continue;
      }
    } else if (once) {
      yield { tur: "once_tamam", snapshot: once };
    }

    if (!once) continue;

    // SONRA snapshot
    yield { tur: "sonra_basladi", ajanKod: baglam.ajanKod, soru: baglam.soru };
    let sonra: OlcumSnapshot | null = null;
    try {
      sonra = await olcumCalistirVeKaydet(s, baglam, "sonra");
      if (sonra) yield { tur: "sonra_tamam", snapshot: sonra };
    } catch (e) {
      yield { tur: "hata", mesaj: `Yeniden ölçüm başarısız (${baglam.soru}): ${e instanceof Error ? e.message : String(e)}` };
      continue;
    }

    if (!sonra) continue;

    // Etki hesapla
    const rapor = etkiHesapla(once, sonra, gercekOnceMi);
    yield {
      tur: "etki",
      rapor,
      dugumId: baglam.dugumId,
      baslik: baglam.soru,
    };
  }

  yield { tur: "bitti", toplamSure: Date.now() - t0 };
}

/** Ölçümü çalıştırır ve snapshot olarak kaydeder. */
async function olcumCalistirVeKaydet(
  s: GeriBeslemeDonguSecenekleri,
  baglam: OlcumBaglami,
  tur: "once" | "sonra"
): Promise<OlcumSnapshot | null> {
  const istem = await sistemIstemi(baglam.soru, baglam.tablolar);
  const sonuc = await donguCalistir({
    saglayici: s.saglayici,
    kayit: s.kayit,
    baglam: { izId: baglam.dugumId, provaMi: false },
    sistemIstemi: istem,
    soru: baglam.soru,
    azamiTur: 2,
  });

  const sonAdim = [...sonuc.adimlar].reverse().find((a) => a.ok);
  let kolonlar: string[] = [];
  let satirlar: unknown[][] = [];
  let sql = "";
  if (sonAdim) {
    sql = (sonAdim.girdi as { sorgu?: string })?.sorgu ?? "";
    try {
      const c = JSON.parse(sonAdim.ozet);
      if (Array.isArray(c?.kolonlar)) kolonlar = c.kolonlar;
      if (Array.isArray(c?.satirlar)) satirlar = c.satirlar;
    } catch { /* tablo yoksa sorun değil */ }
  }

  const snapshotId = depo.snapshotKaydet(
    s.denetimId, baglam.dugumId, baglam.ajanKod,
    baglam.soru, sql, kolonlar, satirlar, tur
  );

  return {
    id: snapshotId,
    denetimId: s.denetimId,
    dugumId: baglam.dugumId,
    ajanKod: baglam.ajanKod,
    soru: baglam.soru,
    sqlSorgu: sql,
    kolonlar,
    satirlar,
    satirSayisi: satirlar.length,
    tur,
    olusturma: new Date().toISOString(),
  };
}
