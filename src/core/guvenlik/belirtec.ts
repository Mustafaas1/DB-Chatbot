/**
 * ERISIM BELIRTECI DOGRULAMASI.
 *
 * Widget portala gomulunce `/api/*` uclari portali goren herkese aciliyor;
 * once hicbir kontrol yoktu. Bu katman internetten ANONIM erisimi kesiyor.
 *
 * NE YAPMADIGI da onemli: belirtec host sayfanin HTML'inde `data-token`
 * olarak duruyor, yani portali acabilen herkes onu okuyabilir. Dolayisiyla
 * bu bir KULLANICI kimligi degil, dagitim seviyesinde bir kapi. Portal
 * kullanicilarini birbirinden ayirmak icin portalin kendi oturumunun
 * dogrulanmasi gerekir.
 *
 * Saf fonksiyon: middleware'den ayri tutuldu ki Edge calisma zamani
 * olmadan test edilebilsin.
 */

export type BelirtecSonucu =
  /** API_TOKEN tanimli degil: kontrol yapilmiyor. */
  | { durum: "kapali" }
  | { durum: "gecerli" }
  | { durum: "eksik" }
  | { durum: "gecersiz" };

/**
 * Iki dizgeyi UZUNLUKTAN BAGIMSIZ surede karsilastirir.
 *
 * `===` ilk farkli karakterde donuyor; sureyi olcen bir saldirgan
 * belirteci karakter karakter kesfedebilir. Edge calisma zamaninda
 * `crypto.timingSafeEqual` yok, bu yuzden elle yaziliyor.
 *
 * Uzunluk farki gizlenemez (ve zaten gizli bir bilgi degil); karsilastirma
 * yine de tum karakterler uzerinde yuruyor.
 */
function sabitSureliEsit(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) {
    fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return fark === 0;
}

/** `Authorization: Bearer <x>` ya da `X-API-Token: <x>` degerini cikarir. */
export function belirteciAyikla(
  authorization: string | null,
  xApiToken: string | null
): string | null {
  const dogrudan = xApiToken?.trim();
  if (dogrudan) return dogrudan;

  const ham = authorization?.trim();
  if (!ham) return null;

  // Sema adi buyuk/kucuk harf duyarsiz (RFC 7235).
  const m = /^Bearer\s+(.+)$/i.exec(ham);
  return m ? m[1]!.trim() : null;
}

/**
 * Istegi degerlendirir.
 *
 * `beklenen` bos ise kontrol KAPALI. Bu, yerel gelistirmede yapilandirma
 * zorunlulugu getirmemek icin bilincli bir tercih; cagiran taraf bu durumu
 * bir kez uyari olarak basiyor ki sessizce acik kalmasin.
 */
export function belirteciDenetle(
  beklenen: string | undefined,
  authorization: string | null,
  xApiToken: string | null
): BelirtecSonucu {
  const hedef = beklenen?.trim() ?? "";
  if (!hedef) return { durum: "kapali" };

  const verilen = belirteciAyikla(authorization, xApiToken);
  if (!verilen) return { durum: "eksik" };

  return sabitSureliEsit(verilen, hedef)
    ? { durum: "gecerli" }
    : { durum: "gecersiz" };
}
