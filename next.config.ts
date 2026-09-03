import type { NextConfig } from "next";

// Ev dizininde baska bir package-lock.json var; Next onu gorup proje
// kokunu C:\Users\Mustafa saniyor ve src/app'i hic bulmuyordu.

/**
 * Widget'i hangi sayfalar CERCEVEYE ALABILIR.
 *
 * `CORS_ORIGINS` bos ise `'self'`: guvenli varsayilan. Widget'i portala
 * gomecekseniz portalin adresini ACIKCA yazmaniz gerekiyor -- yapilandirma
 * unutuldugunda sessizce herkese acilmasindansa calismamasi yeglenir.
 *
 * `*` yazilirsa harfiyen uygulanir (kullanicinin acik tercihi) ama uyari
 * basilir: bu, herhangi bir sitenin widget'i kendi sayfasina gomebilmesi
 * demektir.
 */
function cerceveAtalari(): string {
  const ham = (process.env.CORS_ORIGINS ?? "").trim();

  if (!ham) return "'self'";

  if (ham === "*") {
    console.warn(
      "[widget] CORS_ORIGINS=* -- widget'i HERHANGI bir site cerceveye " +
      "alabilir. Portalin adresini acikca yazmaniz onerilir."
    );
    return "*";
  }

  const adresler = ham.split(",").map((a) => a.trim()).filter(Boolean);
  return ["'self'", ...adresler].join(" ");
}

const config: NextConfig = {
  turbopack: { root: import.meta.dirname },

  // Widget kapaliyken iframe 88x88; Next'in gelistirme gostergesi tam
  // yuvarlak dugmenin uzerine oturup tiklamayi da engelliyor. Yalnizca
  // gelistirmede gorunen bir katman, uretimde zaten yok.
  devIndicators: false,

  async headers() {
    return [
      {
        // Yalnizca widget cerceveye alinabilir; portal arayuzunun
        // kendisi (/) cerceveye alinamaz.
        source: "/widget",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${cerceveAtalari()}`,
          },
        ],
      },
      {
        source: "/((?!widget).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default config;
