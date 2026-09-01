import { z } from "zod";
import type { AracTanimi } from "./tipler";
import { biletAta } from "../yaz/islemler";

/**
 * Yan etkili arac ornegi: bileti kisiye atar.
 *
 * F5'teki beyaz liste islemini arac katmanina baglar. Iki katman ayni
 * isi yapmiyor:
 *   yaz/islemler.ts  -- insan onayli akis (oner -> onayla -> uygula)
 *   bu arac          -- ajanin dogrudan cagirabilecegi bicim
 *
 * Ikisi de AYNI sakli yordama gider, dolayisiyla veritabani seviyesindeki
 * kisit (ajan_yazar yalnizca EXECUTE) her iki yolda da gecerli.
 *
 * yanEtki "yazma" oldugu icin arac kaydi IDEMPOTENCY ANAHTARI olmadan
 * calistirmaz.
 */

const Girdi = z.object({
  biletNo: z.string().min(1).max(40),
  kisi: z.string().min(1).max(120),
});
type Girdi = z.infer<typeof Girdi>;

export const biletAtaAraci: AracTanimi<Girdi, { etkilenen: number; onceki: unknown }> = {
  ad: "bilet_ata",
  aciklama: "Bir destek biletinin atanan kisisini degistirir. Yan etkilidir.",
  kaynak: "yerel",
  yanEtki: "yazma",
  // Tek alan, geri alinabilir, tek kayit.
  risk: "low",
  girdiSemasi: Girdi,
  // Yazma araclarinda prova ZORUNLU: onaya sunulan seyin ne yapacagi
  // once gosterilebilmeli.
  async prova(girdi) {
    return biletAta.prova(girdi);
  },
  async calistir(girdi) {
    const { etkilenen, oncekiDurum } = await biletAta.uygula(girdi);
    return { etkilenen, onceki: oncekiDurum };
  },
  // Yazma islemi; dakikada 10 makul ust sinir.
  hizSiniri: { pencereMs: 60_000, azamiCagri: 10 },
};
