"use client";

import { belirteciBekle, kimlikBasliklari } from "./belirtec";

/**
 * `/api/*` cagrilarinin TEK kapisi.
 *
 * Her cagri noktasina baslik eklemek yerine tek sarmalayici: yeni bir uc
 * eklendiginde belirteci gondermeyi unutmak mumkun olmasin. Bu projede
 * ayni sinif hata (bir yerde yapilan duzeltmenin ikinci kod yoluna
 * gecmemesi) daha once F6'da yasandi.
 */
export async function agIstegi(
  adres: string,
  secenek: RequestInit = {}
): Promise<Response> {
  // Gomulu widget'ta belirtec host'tan `postMessage` ile SONRA geliyor.
  // Beklemeden istek atmak, acilistaki cagrilarin 401 donmesine yol
  // aciyordu (gercek bir kosuda goruldu: ilk /api/plan 401, sonrakiler 200).
  await belirteciBekle();

  const basliklar = new Headers(secenek.headers);
  for (const [ad, deger] of Object.entries(kimlikBasliklari())) {
    basliklar.set(ad, deger);
  }
  return fetch(adres, { ...secenek, headers: basliklar });
}

/**
 * Yanittan okunabilir bir hata mesaji cikarir.
 *
 * 401'i AYRI ele aliyoruz: "Sunucuya ulasilamadi" demek yaniltici olurdu,
 * sunucuya ulasildi ve reddetti. Kullanicinin ne yapmasi gerektigi de
 * farkli.
 */
export async function hataMesaji(yanit: Response): Promise<string> {
  if (yanit.status === 401) {
    return "Erişim belirteci geçersiz ya da eksik. Widget'ı gömen sayfadaki " +
      "data-token değerini kontrol edin.";
  }
  try {
    const govde = (await yanit.json()) as { hata?: unknown };
    if (typeof govde.hata === "string" && govde.hata) return govde.hata;
  } catch {
    // Govde JSON degil; asagidaki genel mesaja dusuyoruz.
  }
  return `İstek başarısız (${yanit.status}).`;
}
