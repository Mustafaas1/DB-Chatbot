import type { Saglayici, Kullanim } from "../llm/tipler";
import { LlmHatasi } from "../llm/tipler";
import { frameAsData, INJECTION_RULE } from "../guvenlik/enjeksiyon";
import type { EntityProfile, Signal } from "./varlikProfili";
import { allowedNumbers } from "./varlikProfili";

/**
 * TAVSIYE: gercekler kodda, cumle modelde.
 *
 * Istenen davranis "10 kere yapmissiniz ve satislari artirmak icin bu
 * musteriye daha sik gitmelisiniz" -- yani sayi + oneri. Sayiyi modele
 * hesaplatmak bu projede defalarca uydurma uretti; oneriyi tamamen koda
 * gomen sablonlar ise kalipsi ve dar kaliyor.
 *
 * Bu yuzden is BOLUNUYOR:
 *
 *   1. Gercekler ve gozlemler KODDA hesaplanir (`varlikProfili.ts`).
 *   2. Model YALNIZCA bunlari Turkce bir tavsiyeye dokuyor.
 *   3. Uretilen metindeki HER SAYI gerceklere karsi dogrulanir;
 *      listede olmayan bir sayi varsa metin REDDEDILIR.
 *   4. Reddedilirse ya da model hic cevap veremezse kod kendi
 *      cumlesini kurar ve arayuz bunu "kodda kuruldu" diye isaretler.
 *
 * Yani model cumleyi guzellestirebilir ama olguya bir sey EKLEYEMEZ.
 */

/** Tavsiye kisa olmali; uzun metin sayı uydurma alanini genisletiyor. */
const MAX_OUTPUT_TOKENS = 220;

/** Sayi karsilastirmasinda kabul edilen sapma. */
const EPSILON = 0.51;

const ISTEM = [
  INJECTION_RULE,
  "",
  "Bir is danismanisin. Sana BIR VARLIK hakkinda kodda hesaplanmis",
  "gercekler verilir. Gorevin bunlari kisa bir Turkce yoruma cevirmek.",
  "",
  "KURALLAR",
  "- En fazla 3 cumle.",
  "- YENI SAYI URETME. Yalnizca sana verilen sayilari kullanabilirsin.",
  "  Sayi uydurursan cevabin tamamen atilir.",
  "- ZAMAN UFKU UYDURMA: 'onumuzdeki 30 gun icinde', 'iki hafta sonra'",
  "  gibi ifadeler yazma; sana verilmeyen bir suredir.",
  "- Verilmeyen bir sebep uydurma (fiyat, rakip, sezon, urun gibi).",
  "  Elindeki gercekler neyi gosteriyorsa onu soyle.",
  "- Once durumu ozetle, sonra somut bir eylem oner.",
  "- Kullaniciya 'siz' diye hitap et.",
  "- Yalnizca yorumu yaz; baslik, madde isareti ya da aciklama ekleme.",
].join("\n");

export interface Advice {
  text: string;
  /** Cumleyi kim kurdu; arayuzde gosteriliyor. */
  kaynak: "model" | "kod";
  /**
   * Model cevabi sayi dogrulamasindan geciremediyse dolu olur.
   * Sessizce geri dusmek, dogrulamanin calistigini gizlerdi.
   */
  reddedilenSayilar: string[];
  /**
   * Reddedilen taslagin kendisi.
   *
   * Arayuzde KATLI ve "reddedildi" etiketiyle gosteriliyor. Dogrulamanin
   * neyi eledigini gormeden kullanicinin ona guvenmesi icin sebep yok;
   * bu projede her denetim gorunur kilindi.
   */
  reddedilenMetin: string | null;
  kullanim: Kullanim;
}

/** Modele verilecek gercek listesi; hepsi kodda uretildi. */
export function factLines(p: EntityProfile, signals: Signal[]): string[] {
  const satir: string[] = [
    `Varlik: ${p.entity} (${p.table} tablosu)`,
    `${p.rangeLabel}: ${p.current} kayit`,
    `${p.previousRangeLabel}: ${p.previous} kayit`,
  ];

  if (p.changePercent != null) satir.push(`Donem degisimi: %${p.changePercent}`);
  if (p.currentAmount != null) {
    satir.push(
      `${p.rangeLabel} tutar toplami: ${p.currentAmount}` +
      (p.currency ? ` ${p.currency}` : "")
    );
  }
  if (p.amountChangePercent != null) {
    satir.push(`Tutar degisimi: %${p.amountChangePercent}`);
  }

  satir.push(`Tum zamanlar: ${p.allTime} kayit`);
  if (p.daysSinceLast != null) satir.push(`Son kayittan bu yana: ${p.daysSinceLast} gun`);
  if (p.averageIntervalDays != null) {
    satir.push(`Bu varligin ortalama kayit araligi: ${p.averageIntervalDays} gun`);
  }
  if (p.peers) {
    satir.push(
      `Ayni donemde ${p.peers.total} varlik var; ortalama ${p.peers.average} kayit, ` +
      `en yuksek ${p.peers.max} kayit. Bu varlik ${p.peers.below} tanesinin uzerinde ` +
      `(%${p.peers.percentile} dilim).`
    );
  }

  for (const s of signals) satir.push(`Gozlem: ${s.text}`);
  return satir;
}

/* --- Sayi dogrulamasi --- */

/**
 * Turkce sayi bicimini normalize eder.
 *
 * "1.250,50" -> 1250.5 ; "%42" -> 42 ; "10" -> 10
 * Binlik ayraci nokta, ondalik ayraci virgul.
 */
export function parseTurkishNumber(ham: string): number | null {
  let s = ham.trim();
  // Binlik gruplari: 1.250.000 -> 1250000. Yalniz TAM gruplar silinir;
  // "1.5" (ondalik nokta) bozulmasin diye desen uc haneyi zorunlu tutuyor.
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Bosluk, sert bosluk, dar sert bosluk. */
const GRUP_AYRACLARI = String.fromCharCode(32, 160, 8239);

/**
 * Bosluklu binlik gruplarini birlestirir: "98 400" -> "98400".
 *
 * Gercek bir kosuda model tutari "98 400 TRY" diye yazdi; ayirici
 * bunu 98 ve 400 diye okuyup metni UYDURMA sanip reddetti. Oysa bu
 * gecerli bir Turkce/Avrupa yazimi.
 *
 * Yalnizca UC HANELI gruplar birlestiriliyor; "4 kayit" ya da
 * "243 varlik" dokunulmadan kaliyor. Birlestirme yanlis yapilirsa
 * sonuc DAHA SIKI olur (izinli olmayan bir toplam cikar), daha gevsek
 * degil -- guvenli yon.
 */
function bosluklariBirlestir(metin: string): string {
  // String.raw SART: duz sablon dizgesinde `\d` tanimsiz kacis olarak
  // "d"ye duser ve desen sessizce bozulur.
  const desen = new RegExp(
    String.raw`(\d)[` + GRUP_AYRACLARI + String.raw`](?=\d{3}(?!\d))`, "g"
  );
  let onceki = "";
  let s = metin;
  // "1 234 567" gibi cok gruplu sayilar icin sabitlenene kadar.
  while (s !== onceki) { onceki = s; s = s.replace(desen, "$1"); }
  return s;
}

/** Metindeki sayi gorunumlu her parcayi cikarir. */
export function extractNumbers(metin: string): { ham: string; deger: number }[] {
  const bulunan: { ham: string; deger: number }[] = [];
  for (const m of bosluklariBirlestir(metin).matchAll(/\d+(?:[.,]\d+)*/g)) {
    const deger = parseTurkishNumber(m[0]);
    if (deger != null) bulunan.push({ ham: m[0], deger });
  }
  return bulunan;
}

/**
 * Metindeki sayilarin hepsi izinli mi.
 *
 * Izinli kume iki kaynaktan: profilin sayisal alanlari ve GERCEK
 * SATIRLARININ kendisi. Ikincisi sart -- "son 30 gun" etiketindeki 30
 * profilde bir alan degil ama modele verilmis bir sayidir.
 */
export function verifyNumbers(metin: string, izinli: number[]): string[] {
  return extractNumbers(metin)
    .filter(({ deger }) => !izinli.some((i) => Math.abs(i - deger) < EPSILON))
    .map(({ ham }) => ham);
}

/* --- Kod tarafinin kendi cumlesi --- */

/**
 * Gozlem basina eylem onerisi.
 *
 * Model devre disi kaldiginda kullanilir. Kalipsi ama DOGRU; uydurma
 * bir cumle yerine kalipli bir cumle gostermek dogru takas.
 */
const ACTION_BY_SIGNAL: Record<Signal["kind"], string> = {
  overdue: "Temas aralığı kendi ortalamasını aştı; yeniden görüşme planlanabilir.",
  dormant: "Bu dönemde hiç hareket yok; geri kazanım için iletişime geçilebilir.",
  declining: "Düşüşün sebebini anlamak için müşteriyle doğrudan görüşülmesi gerekiyor.",
  growing: "Artış sürüyor; ilgiyi korumak ivmeyi sürdürebilir.",
  topTier: "Üst dilimde bir varlık; ilişkiyi korumak öncelikli olmalı.",
  belowAverage: "Dönem ortalamasının altında; temas sıklığını artırmak alanı açabilir.",
  new: "Yeni bir kayıt; ilk deneyimin takibi tekrar alımı belirler.",
};

/** Modelsiz, tamamen kodda kurulan tavsiye. */
export function composeAdvice(p: EntityProfile, signals: Signal[]): string {
  const durum = p.current > 0
    ? `${p.entity} için ${p.rangeLabel} içinde ${p.current} kayıt var.`
    : `${p.entity} için ${p.rangeLabel} içinde kayıt yok.`;

  // Ilk gozlem en belirleyicisi: deriveSignals onlari onem sirasina
  // gore uretiyor (once yoklugu/gecikme, sonra egilim, sonra konum).
  const ilk = signals[0];
  if (!ilk) return `${durum} Öne çıkan bir sapma yok.`;
  return `${durum} ${ilk.text} ${ACTION_BY_SIGNAL[ilk.kind]}`;
}

/**
 * Tavsiyeyi uretir.
 *
 * Model devrede ama SINIRLI: gercekler istemin icinde hazir, cikti
 * dogrulaniyor ve basarisizlikta kod cumlesine dusuluyor. Kota hatasi
 * yukari firlatilmiyor -- tavsiye bir ek katman, akisi durdurmamali.
 */
export async function buildAdvice(
  saglayici: Saglayici, p: EntityProfile, signals: Signal[]
): Promise<Advice> {
  const gercekler = factLines(p, signals);
  const kodCumlesi = composeAdvice(p, signals);
  const bosKullanim: Kullanim = { girdiTokeni: 0, ciktiTokeni: 0 };

  // Izinli sayilar: profil alanlari + gerceklerde gecen her sayi.
  const izinli = [
    ...allowedNumbers(p),
    ...extractNumbers(gercekler.join("\n")).map((x) => x.deger),
  ];

  // Varlik adi veritabanindan geliyor: VERI olarak cerceveleniyor.
  const cerceve = frameAsData(gercekler.join("\n"));

  try {
    const yanit = await saglayici.konus({
      mesajlar: [
        { rol: "sistem", metin: ISTEM },
        { rol: "kullanici", metin: `GERCEKLER:\n${cerceve.text}` },
      ],
      akilYurutmeGayreti: "low",
      azamiCiktiTokeni: MAX_OUTPUT_TOKENS,
    });

    const metin = yanit.metin.trim();
    if (!metin) {
      return {
        text: kodCumlesi, kaynak: "kod", reddedilenSayilar: [],
        reddedilenMetin: null, kullanim: yanit.kullanim,
      };
    }

    const uydurma = verifyNumbers(metin, izinli);
    if (uydurma.length) {
      // Metni GOSTERMIYORUZ. Bir sayisi uydurmaysa geri kalanina da
      // guvenilmez; kullaniciya dogrulanmis cumle gitmeli.
      console.warn("[tavsiye] uydurma sayi reddedildi:", uydurma, metin);
      return {
        text: kodCumlesi, kaynak: "kod",
        reddedilenSayilar: uydurma, reddedilenMetin: metin,
        kullanim: yanit.kullanim,
      };
    }

    return {
      text: metin, kaynak: "model", reddedilenSayilar: [],
      reddedilenMetin: null, kullanim: yanit.kullanim,
    };
  } catch (e) {
    // Kota da dahil her hata ayni sonuca cikiyor: kod cumlesi. Tavsiye
    // ugruna butun akisi dusurmek orantisiz olurdu.
    if (!(e instanceof LlmHatasi)) console.error("[tavsiye]", e);
    return {
      text: kodCumlesi, kaynak: "kod", reddedilenSayilar: [],
      reddedilenMetin: null, kullanim: bosKullanim,
    };
  }
}
