import { NextResponse, type NextRequest } from "next/server";
import { belirteciDenetle } from "./core/guvenlik/belirtec";

/**
 * `/api/*` KAPISI.
 *
 * Widget portala gomulunce bu uclar portali goren herkese aciliyor ve
 * icaralarinda yazma isini tetikleyen `/api/islem` de var. Onceden hicbir
 * kontrol yoktu.
 *
 * CORS BILEREK YOK: widget bir iframe icinde ve KENDI kaynagimizdan
 * servis ediliyor, dolayisiyla yaptigi `/api/*` cagrilari ayni kaynak.
 * Kullanilmayan CORS makinesi eklemek, ilerde yanlislikla guvenilen olu
 * bir kural birakmak olurdu. Portalin kendi JavaScript'i API'yi dogrudan
 * cagiracaksa CORS o zaman eklenmeli.
 */

export const config = {
  // Yalnizca API. Sayfalar ve statik dosyalar bu kapidan gecmiyor:
  // /widget'in kendisi belirtec istemez, belirteci host'tan alir.
  matcher: "/api/:path*",
};

/** Uyari surec basina BIR KEZ basilsin; her istekte log kirletmesin. */
let uyarildi = false;

export function middleware(istek: NextRequest) {
  const sonuc = belirteciDenetle(
    process.env.API_TOKEN,
    istek.headers.get("authorization"),
    istek.headers.get("x-api-token")
  );

  if (sonuc.durum === "kapali") {
    if (!uyarildi) {
      uyarildi = true;
      console.warn(
        "[guvenlik] API_TOKEN tanimli degil: /api/* uclari KORUMASIZ. " +
        "Widget'i portala gomecekseniz .env icinde API_TOKEN doldurun."
      );
    }
    return NextResponse.next();
  }

  if (sonuc.durum === "gecerli") return NextResponse.next();

  // Neyin eksik oldugunu soyluyoruz ama BEKLENEN degeri asla sizdirmiyoruz.
  return NextResponse.json(
    {
      hata: sonuc.durum === "eksik"
        ? "Erisim belirteci gerekli: Authorization: Bearer <belirtec> ya da X-API-Token."
        : "Erisim belirteci gecersiz.",
    },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
  );
}
