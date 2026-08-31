import type { AracKaydi } from "../tools/kayit.js";
import type { Baglam } from "../tools/tipler.js";
import type { Mesaj, Saglayici, SaglayiciYaniti } from "../llm/tipler.js";
import { LlmHatasi } from "../llm/tipler.js";

export interface AdimKaydi {
  tur: "arac";
  ad: string;
  girdi: unknown;
  ok: boolean;
  ozet: string;
  sureMs: number;
}

export interface DonguSonucu {
  cevap: string;
  adimlar: AdimKaydi[];
  kullanim: { girdiTokeni: number; ciktiTokeni: number };
  tamamlandi: boolean;
  /** Tamamlanmadiysa nedeni. */
  durmaSebebi?: "tur_siniri" | "uzunluk" | "hata";
}

export interface DonguSecenekleri {
  saglayici: Saglayici;
  kayit: AracKaydi;
  baglam: Baglam;
  sistemIstemi: string;
  soru: string;
  /** Kac kez arac cagirabilecegi. Kotayi korumak icin dusuk tutuluyor. */
  azamiTur?: number;
  gecmis?: Mesaj[];
}

/** Arac sonucunu modele geri verilecek kompakt metne cevirir. */
function sonucMetni(deger: unknown): string {
  const metin = typeof deger === "string" ? deger : JSON.stringify(deger);
  // Cok buyuk sonuclar kotayi tuketiyor; model zaten ozet cikaracak.
  return metin.length > 4000 ? metin.slice(0, 4000) + " ...(kirpildi)" : metin;
}

/**
 * Arac cagrisi dongusu.
 *
 * Model arac cagirir -> arac calisir -> sonuc modele doner -> model ya
 * yeni arac cagirir ya da cevabi yazar. Tur siniri ASILIRSA dongu
 * sessizce kesilmez; durmaSebebi ile bildirilir.
 */
export async function donguCalistir(s: DonguSecenekleri): Promise<DonguSonucu> {
  const azamiTur = s.azamiTur ?? 3;
  const mesajlar: Mesaj[] = [
    { rol: "sistem", metin: s.sistemIstemi },
    ...(s.gecmis ?? []),
    { rol: "kullanici", metin: s.soru },
  ];

  const adimlar: AdimKaydi[] = [];
  const kullanim = { girdiTokeni: 0, ciktiTokeni: 0 };
  const araclar = s.kayit.anthropicSemalari();

  for (let tur = 0; tur < azamiTur; tur++) {
    let yanit: SaglayiciYaniti;
    try {
      yanit = await s.saglayici.konus({
        mesajlar,
        araclar,
        akilYurutmeGayreti: "low",
        azamiCiktiTokeni: 1200,
      });
    } catch (e) {
      if (e instanceof LlmHatasi) {
        return {
          cevap: e.kod === "kota"
            ? "Yapay zeka kotasi doldu. Bir sure sonra tekrar deneyin."
            : `Yapay zekaya ulasilamadi: ${e.message}`,
          adimlar, kullanim, tamamlandi: false, durmaSebebi: "hata",
        };
      }
      throw e;
    }

    kullanim.girdiTokeni += yanit.kullanim.girdiTokeni;
    kullanim.ciktiTokeni += yanit.kullanim.ciktiTokeni;

    if (!yanit.aracCagrilari.length) {
      return {
        cevap: yanit.metin.trim(),
        adimlar, kullanim,
        tamamlandi: yanit.bitisSebebi !== "uzunluk",
        ...(yanit.bitisSebebi === "uzunluk" ? { durmaSebebi: "uzunluk" as const } : {}),
      };
    }

    mesajlar.push({ rol: "asistan", metin: yanit.metin, aracCagrilari: yanit.aracCagrilari });

    for (const cagri of yanit.aracCagrilari) {
      const sonuc = await s.kayit.calistir(cagri.ad, cagri.girdi, s.baglam);
      const ozet = sonuc.ok ? sonucMetni(sonuc.deger) : `HATA: ${sonuc.hata}`;
      adimlar.push({
        tur: "arac", ad: cagri.ad, girdi: cagri.girdi,
        ok: sonuc.ok, ozet, sureMs: sonuc.sureMs,
      });
      // Hata da modele geri verilir: sorguyu duzeltip tekrar deneyebilsin.
      mesajlar.push({ rol: "arac", cagriId: cagri.id, ad: cagri.ad, icerik: ozet });
    }
  }

  return {
    cevap: "Sorguyu tamamlayamadim; izin verilen arac cagrisi sayisi asildi. Sorunuzu daha dar kapsamli sorun.",
    adimlar, kullanim, tamamlandi: false, durmaSebebi: "tur_siniri",
  };
}
