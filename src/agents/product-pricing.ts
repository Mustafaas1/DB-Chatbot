import { z } from "zod";
import type { AjanTanimi } from "./tipler";

/** Urun karmasi, fiyatlandirma ve capraz satis. */
export const productPricing: AjanTanimi = {
  kod: "product-pricing",
  ad: "Ürün ve Fiyat Ajanı",
  renk: "#7c3aed",
  tur: "planlama",
  aciklama:
    "Urun katalogu, teklif kalemleri, fiyat ve paketleme, musteri urun " +
    "sahipligi, capraz satis firsatlari.",
  rolPromptu: [
    "Urun karmasi ve fiyatlandirmadan sorumlusun. Hangi urunlerin birlikte",
    "satildigina, kalem bazinda tutarlara ve musteri urun sahipligine",
    "bakarak capraz satis ve paketleme firsati ararsin.",
    "Para birimi karisikligina DIKKAT: farkli birimleri tek toplamda",
    "birlestirme, birim bazinda grupla.",
  ].join("\n"),
  araclar: ["veri_sorgula"],
  ciktiSemasi: z.object({ ozet: z.string(), bulgular: z.array(z.string()) }),
  limitler: { azamiTur: 2, azamiCiktiTokeni: 1000, azamiCagri: 3 },
  tablolar: ["Products", "TeklifKalemleri", "Teklifler", "CustomerProducts", "InvoiceKalemleri"],
  ornekler: ["Ürüne göre teklif kalemi sayısı", "Para birimine göre teklif tutarı"],
};
