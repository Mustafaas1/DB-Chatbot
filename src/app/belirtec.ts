"use client";

/**
 * Istemci tarafinda tutulan erisim belirteci.
 *
 * Iki kaynaktan gelebiliyor:
 *
 *   1. WIDGET  -- host sayfa `data-token` ile veriyor, `postMessage` ile
 *      iframe'e geciyor (`widget/kabuk.ts`).
 *   2. TEK BASINA SAYFA (`/`) -- adres cubugundaki `#token=...`, bir kez
 *      okunup `sessionStorage`'a yaziliyor ve adresten SILINIYOR.
 *
 * Belirteci sunucu tarafindan sayfanin HTML'ine GOMMUYORUZ. Gomseydik `/`
 * adresini acabilen herkes onu okuyabilirdi ve kapi hicbir sey korumamis
 * olurdu -- kapinin anahtarini kapinin uzerine asmak.
 *
 * HAZIRLIK: gomulu widget'ta belirtec `postMessage` ile SONRA geliyor.
 * Gercek bir kosuda goruldu -- widget acilir acilmaz `/api/plan` ve
 * `/api/akis` cagrilari gidiyor, ilkleri 401 donuyor, belirtec gelince
 * sonrakiler 200 donuyordu. Bu yuzden istek atmadan once
 * `belirteciBekle()` ile el sikismanin bitmesi bekleniyor.
 *
 * SINIR: widget yolunda belirtec zaten portalin HTML'inde duruyor, yani
 * gizli DEGIL. Isi internetten anonim erisimi kesmek; portal
 * kullanicilarini birbirinden ayirmak degil.
 */

const ANAHTAR = "gk-ajan-belirtec";

/**
 * Host yanit vermezse ne kadar beklenir.
 *
 * El sikisma normalde birkac milisaniye; bu yalnizca bozuk ya da eski bir
 * host'ta arayuzun sonsuza kadar donmasini engelleyen emniyet.
 */
const HAZIRLIK_ZAMAN_ASIMI_MS = 3000;

let belirtec = "";
let cozuldu = false;
let kuruldu = false;
let cozucu: (() => void) | null = null;

const hazirlik = new Promise<void>((coz) => {
  cozucu = () => { if (!cozuldu) { cozuldu = true; coz(); } };
});

function hazirEt(): void { cozucu?.(); }

/** Adres parcasindan ya da oturum deposundan okur. */
function yerelKaynaktanOku(): void {
  try {
    const parca = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const adresten = parca.get("token");
    if (adresten) {
      window.sessionStorage.setItem(ANAHTAR, adresten);
      // Belirteci adres cubugunda asili birakmak, ekran goruntusu ve
      // tarayici gecmisi yoluyla sizmasinin en kolay yolu.
      history.replaceState(null, "", window.location.pathname + window.location.search);
      belirtec = adresten;
      return;
    }
    belirtec = window.sessionStorage.getItem(ANAHTAR) ?? "";
  } catch {
    // Gizli sekmede sessionStorage erisimi hata firlatabiliyor; belirtec
    // yoksa istek 401 doner ve arayuz bunu zaten gosterir.
    belirtec = "";
  }
}

/**
 * Bir kez calisir ve hangi kaynagi bekleyecegimize karar verir.
 *
 * `belirteciBekle` ve `belirteciTopla` ikisi de bunu cagiriyor: hangi
 * bilesenin once mount oldugana bagli kalmamak icin. React alt bilesenlerin
 * efektlerini usttekilerden ONCE calistiriyor, yani siralamaya guvenmek
 * kirilgan olurdu.
 */
function kur(): void {
  if (kuruldu || typeof window === "undefined") return;
  kuruldu = true;

  // Cerceve icinde DEGILSEK beklenecek bir sey yok: degeri simdi oku.
  if (window.parent === window) {
    yerelKaynaktanOku();
    hazirEt();
    return;
  }

  // Gomuluyuz: yetkili kaynak host sayfa. Oturum deposundan okumak, host
  // belirteci degistirdiginde ya da kaldirdiginda eskisini yasatmak olurdu.
  setTimeout(() => {
    if (!cozuldu) {
      console.warn(
        "[belirtec] Host sayfadan yanit gelmedi; istekler belirtecsiz gidecek."
      );
      hazirEt();
    }
  }, HAZIRLIK_ZAMAN_ASIMI_MS);
}

/** Istek atmadan once beklenecek soz. */
export function belirteciBekle(): Promise<void> {
  kur();
  return cozuldu ? Promise.resolve() : hazirlik;
}

/**
 * Host'tan gelen degeri yazar ve bekleyenleri serbest birakir.
 *
 * Bos deger de HAZIR sayilir: host'un belirteci olmayabilir ve o durumda
 * istegin belirtecsiz gitmesi dogru davranis.
 */
export function belirteciYaz(deger: string): void {
  belirtec = deger;
  hazirEt();
}

/** Tek basina sayfada mount sirasinda cagrilir; gomuluyken bir sey yapmaz. */
export function belirteciTopla(): string {
  kur();
  return belirtec;
}

/**
 * Kimlik basliklari.
 *
 * Belirtec bossa baslik HIC eklenmiyor: bos bir `Authorization` gondermek
 * sunucuda "verildi ama yanlis" ile karistirilirdi ve hata mesaji yaniltici
 * olurdu.
 */
export function kimlikBasliklari(): Record<string, string> {
  return belirtec ? { Authorization: `Bearer ${belirtec}` } : {};
}
