import type { Tablo } from "../db/sema";

/**
 * Olcumun VERIYLE ZEMINLENIP zeminlenmedigini denetler.
 *
 * dogrula.ts DEGER ve TIP uyusmazligini yakaliyor (Asama='Kapalı',
 * Oncelik='Yuksek'). Yakalayamadigi sey: veride HIC KARSILIGI OLMAYAN
 * kavramlar. Agac "SSS Makale Eslestirme", "Otomatik Cozum Makalesi
 * Onerisi", "Konu Bazli Makale Populerligi" gibi olcumler uretti;
 * makale/bilgi tabani diye bir veri yok. Bunlar 22-34 saniye harcayip
 * anlamsiz tek deger donuyordu.
 *
 * Kontrol: olcumun ANLAMLI kelimelerinden en az biri semadaki bir tablo
 * ya da kolon adiyla (veya Turkce karsiligiyla) ortusmeli. Hicbiri
 * ortusmuyorsa olcum zeminsizdir.
 */

/** Turkce is terimi -> semadaki Ingilizce karsilik. */
/** Disaridan da kullaniliyor: listeleyici.ts tablo secerken ayni sozlugu
 *  paylasiyor; iki yerde ayri Turkce-Ingilizce esleme tutmak kaymaya
 *  acik olurdu. */
export const KARSILIK: Record<string, string[]> = {
  bilet: ["ticket"], destek: ["ticket"], talep: ["ticket", "leave", "request"],
  teklif: ["teklif", "opportunity"], firsat: ["opportunity"],
  musteri: ["contact", "customer", "company"], kisi: ["contact", "user"],
  fatura: ["invoice"], sozlesme: ["contract"], odeme: ["invoice", "payment"],
  proje: ["project"], gorev: ["task"], izin: ["leave"],
  calisan: ["employee", "personel", "attendance"], personel: ["employee", "personel"],
  mesai: ["attendance"], vardiya: ["duty", "schedule"], takvim: ["calendar"],
  urun: ["product"], stok: ["product"], oneri: ["suggestion"],
  satin: ["invoice", "teklif", "product"], alim: ["invoice", "teklif"],
  alma: ["invoice", "teklif"], satis: ["invoice", "teklif", "satis"],
  siparis: ["invoice", "teklif"], ciro: ["tutar", "invoice"],
  gelir: ["tutar", "invoice"], sepet: ["invoice", "teklif"],
  kalem: ["kalem"], miktar: ["miktar"], fiyat: ["fiyat"],
  arac: ["vehicle"], trafik: ["traffic"], ceza: ["fine", "traffic"],
  bakim: ["maintenance"], lastik: ["tire"], sigorta: ["policy", "insurance"],
  muayene: ["inspection"], zimmet: ["custody"], masraf: ["expense"],
  bildirim: ["notification"], yorum: ["comment"], etkinlik: ["event", "calendar"],
  asama: ["asama"], oncelik: ["oncelik"], durum: ["durum"], kanal: ["kanal"],
  tutar: ["tutar", "invoice", "teklif"], tarih: ["tarih", "date"],
  sayi: [], adet: [], oran: [], ortalama: [], toplam: [],
  // Finansal / raporlama kavramlari: eskiden semada karsilik bulamiyordu.
  kar: ["tutar", "invoice", "teklif"], marj: ["tutar", "invoice", "teklif"],
  brut: ["tutar", "invoice", "teklif"], net: ["tutar", "invoice", "teklif"],
  yuzde: [], degisim: [], degisimi: [], artis: [], azalis: [],
  donemsel: [], ceyrek: [], aylik: [], yillik: [], haftalik: [],
  harcama: ["tutar", "invoice", "teklif"], maliyet: ["tutar", "invoice", "teklif"],
  performans: [], verimlilik: [], trend: [], karsilastirma: [],
  basina: [], bazinda: [], bazli: [], birim: [],
  para: ["tutar", "invoice"], doviz: ["tutar", "invoice"],
  kategori: [], bolum: [], segment: [], grup: [],
  zaman: ["tarih", "date"], donem: ["tarih", "date"], serisi: [],
  dagilim: [], analiz: [], rapor: [],
  mevcut: [], buyume: [], dusus: [],   // "toplam" yukarida tanimli
};

/** Olcum metninde gecmesi anlamli olmayan kelimeler. */
const DOLGU = new Set([
  "gore", "olan", "icin", "ile", "bir", "bu", "su", "ve", "veya", "her",
  "kac", "kacar", "nedir", "nasil", "hangi", "tum", "tumu", "tablo",
  "tablosunda", "kayit", "kayitlarin", "sayisi", "sayisini", "orani",
  "ortalama", "toplam", "dagilimi", "listesi", "analizi", "izlenmesi",
  "belirleme", "tespit", "olcumu", "gunluk", "aylik", "yillik", "son",
  "yeni", "eski", "acik", "kapali", "yuksek", "dusuk", "en", "cok", "az",
  // Fiil/sifat kaliplari. Bunlar alan kavrami degil; paydayi sisirip
  // gecerli olcumleri esigin altina itiyorlardi.
  "icinde", "yaptigi", "yapan", "ayri", "gerceklestirdigi", "gerceklesen",
  "dondur", "goster", "hesapla", "raporla", "getir", "listele", "bul",
  "benzersiz", "erken", "gec", "ilk", "son", "cesitliligi", "aldigi",
  "olan", "olusturan", "eslesen", "bazli", "gore", "sonrasi", "oncesi",
  "say", "sayan", "adedi", "degeri", "kolonu", "alani",
  // Raporlama / olcum fiil-sifatlari: semada karsilik aramaya gerek yok.
  "yuzde", "yuzdesini", "degisimi", "degisimini", "artis", "artisi",
  "azalis", "azalisi", "donemsel", "ceyrek", "ceyrekle", "icindeki",
  "karsilastir", "karsilastirma", "trend", "trendi",
  "basina", "bazinda", "birim", "birime",
]);

function normalize(s: string): string {
  return s.toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");
}

/** Turkce ekleri kabaca atar: "biletlerin" -> "bilet" ile eslessin. */
function kok(k: string): string {
  return k.length > 6 ? k.slice(0, k.length - 3) : k;
}

/** Semadan kelime dagarcigi: tablo ve kolon adlari, CamelCase bolunmus. */
export function schemaVocabulary(tablolar: Tablo[]): Set<string> {
  const s = new Set<string>();
  const ekle = (ad: string) => {
    for (const p of ad.split(/(?=[A-Z])|_/)) {
      const n = normalize(p);
      if (n.length >= 3) s.add(n);
    }
  };
  for (const t of tablolar) {
    ekle(t.ad);
    for (const k of t.kolonlar) ekle(k.ad);
  }
  return s;
}

/**
 * Bu veride KESINLIKLE karsiligi olmayan kavramlar.
 *
 * Agacin tekrar tekrar uydurdugu seyler. Yalnizca orana bakmak yetmiyordu:
 * "Chatbotun ortalama yanit suresi" %67 ortusme aliyor cunku "yanit" ve
 * "sure" semada geciyor -- ama chatbot diye bir sey YOK.
 *
 * SCHEMA_ABSENT_TERMS ile genisletilebilir; sirket kendi eksiklerini
 * kod degistirmeden ekleyebilsin.
 */
const KESIN_YOK = new Set(
  [
    "chatbot", "bot", "sss", "faq", "makale", "makalesi", "bilgi tabani",
    // "servis"/"self" cikarildi: ServiceForms tablosu var.
    // "trafik" cikarildi: VehicleTrafficFines var. Semada karsiligi olan
    // bir terimi yasaklamak, dogru olcumu eliyordu.
    "portal", "selfservis", "anket", "memnuniyet",
    "ziyaretci", "web", "sayfa", "tiklama",
    "egitim", "webinar", "sosyal", "kampanya", "reklam",
    ...(process.env.SCHEMA_ABSENT_TERMS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  ].map((x) => x.toLowerCase())
);

/** Oran esigi: cok dusuruld, cunku Turkce ek/fiil kelimeleri paydayi
 *  sisirip gecerli olcumleri eliyordu. Yalnizca cok dusuk ortusme
 *  (cogunluk semada yok) reddedilir. */
const ORAN_ESIGI = 0.25;

export interface GroundingResult {
  grounded: boolean;
  /** Semayla ortusen kelimeler; bos ise zeminsiz. */
  matched: string[];
  /** Hicbiri eslesmeyen anlamli kelimeler. */
  unmatched: string[];
  /** Zeminsizse sebebi. */
  sebep: string;
}

/**
 * Olcumun zeminli olup olmadigini soyler.
 *
 * MUHAFAZAKAR: yalnizca HICBIR kelime eslesmiyorsa zeminsiz der. Yanlis
 * pozitif calisan bir olcumu engellerdi; dogrula.ts ile ayni felsefe.
 */
export function checkGrounding(metin: string, sozluk: Set<string>): GroundingResult {
  const kelimeler = normalize(metin)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((k) => k.length >= 3 && !DOLGU.has(k) && !/^\d+$/.test(k));

  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const k of kelimeler) {
    const s = kok(k);
    let esletti = false;

    // 1) Dogrudan sema kelimesi
    for (const sk of sozluk) {
      if (sk.startsWith(s) || s.startsWith(sk)) { esletti = true; break; }
    }

    // 2) Turkce karsilik
    if (!esletti) {
      for (const [tr, ingler] of Object.entries(KARSILIK)) {
        if (!tr.startsWith(s) && !s.startsWith(tr.slice(0, 4))) continue;
        if (!ingler.length) { esletti = true; break; }
        for (const ing of ingler) {
          for (const sk of sozluk) if (sk.startsWith(ing)) { esletti = true; break; }
          if (esletti) break;
        }
        if (esletti) break;
      }
    }

    (esletti ? matched : unmatched).push(k);
  }

  // Hic anlamli kelime cikmadiysa karar veremeyiz; zeminli say.
  if (!kelimeler.length) return { grounded: true, matched, unmatched, sebep: "" };

  // 1) Kesin yok listesi. Oranı yuksek olsa bile reddedilir: tek bir
  //    "chatbot" kelimesi olcumu anlamsiz kilmaya yeter.
  //
  //    IKI SINIR:
  //    a) Yalnizca SEMAYLA ESLESMEYEN kelimelere bakilir. Liste semayi
  //       ezemez: "trafik" listede ama VehicleTrafficFines gercekten var,
  //       "servis" listede ama ServiceForms var.
  //    b) Eslesme tek yonlu: olcum kelimesi yasakli terimle BASLAMALI.
  //       Cift yonlu onek kontrolu "say" kelimesini "sayfa" sanip
  //       gecerli sayma olcumlerini eliyordu.
  const yokOlan = unmatched.filter((k) => {
    const s2 = kok(k);
    for (const y of KESIN_YOK) if (s2.startsWith(y) || k.startsWith(y)) return true;
    return false;
  });
  if (yokOlan.length) {
    return {
      grounded: false, matched, unmatched,
      sebep: `Bu veride karsiligi olmayan kavram: ${[...new Set(yokOlan)].join(", ")}. ` +
             "Boyle bir veri tutulmuyor.",
    };
  }

  // 2) Genel ortusme orani.
  const oran = matched.length / kelimeler.length;
  if (oran < ORAN_ESIGI) {
    return {
      grounded: false, matched, unmatched,
      sebep: `Olcumdeki kelimelerin cogu (${unmatched.join(", ")}) semada karsilik bulmuyor.`,
    };
  }

  return { grounded: true, matched, unmatched, sebep: "" };
}
