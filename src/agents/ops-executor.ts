import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/**
 * Onaylanan aksiyonlari yuruten TEK ajan.
 *
 * Yazma yetkisi YALNIZCA burada. Planlama ajanlarinin allowlist'ine yazma
 * araci konulamaz; tanimlariDenetle() bunu kod olarak zorluyor.
 *
 * Bu ajan LLM'e SQL yazdirmaz: yalnizca beyaz listedeki tipli islemleri
 * cagirir ve her biri insan onayindan gecer.
 */
export const opsExecutor: AjanTanimi = {
  kod: "ops-executor",
  ad: "Yürütme Ajanı",
  renk: "#dc2626",
  tur: "yurutme",
  aciklama:
    "Onaylanmis aksiyonlari yuruten tek ajan. Beyaz listedeki tipli " +
    "islemleri calistirir; serbest SQL yazamaz.",
  rolPromptu: [
    "Onaylanmis aksiyonlari yurutursun. SQL YAZMAZSIN; yalnizca tanimli",
    "islemleri tipli parametrelerle cagirirsin.",
    "Her islem once PROVA edilir, sonra insan onayindan gecer.",
    "Onay olmadan hicbir sey uygulanmaz.",
  ].join("\n"),
  araclar: ["veri_sorgula", "bilet_ata", "bilet_asama_degistir"],
  ciktiSemasi: z.object({
    islemKodu: z.string(),
    parametreler: z.record(z.string(), z.unknown()),
  }),
  limitler: { azamiTur: 1, azamiCiktiTokeni: 600, azamiCagri: 2 },
  tablolar: ["TicketRecords"],
  ornekler: ["HT10001 biletini Ad Soyad'a ata"],
};
