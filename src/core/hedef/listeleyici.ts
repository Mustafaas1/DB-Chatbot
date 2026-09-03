import { randomUUID } from "node:crypto";
import type { Tablo } from "../db/sema";
import type { GoalNodeGenis } from "../../schemas/index";
import { ISLEMLER } from "../yaz/islemler";
import { KARSILIK } from "./zemin";

/**
 * LISTELEYICI OLCUM KURALI.
 *
 * Agac neredeyse her zaman TOPLU olcum uretiyor: COUNT, SUM, GROUP BY.
 * Toplu sonuc somut kayit icermez; plan asamasi gercek bir bilete/teklife
 * baglanamaz ve aksiyon uretilemez ("... gercek bir kayda baglanamadi").
 *
 * Bu yuzden agaca, yazma islemi TANIMLI bir tablodan satir donduren en az
 * bir olcum ekliyoruz. Boylece en az bir dal somut kayit uretiyor ve
 * uzerine calistirilabilir aksiyon kurulabiliyor.
 *
 * Olcum sorusu KODDA kuruluyor; modelden "listeleyici bir olcum de uret"
 * diye rica etmek guvenilir degildi -- bu projede duzyazi kural defalarca
 * tutmadi.
 */

/** Yazma islemi tanimli tablolar: yalnizca bunlar aksiyona donusebilir. */
function writableTables(): string[] {
  return [...new Set(ISLEMLER.map((i) => i.hedefTablo.toLowerCase()))];
}

/** Tablonun kelime dagarcigi: adi + kolon adlari, CamelCase bolunmus. */
function tableVocabulary(tablo: Tablo): Set<string> {
  const s = new Set<string>();
  const ekle = (ad: string) => {
    for (const p of ad.split(/(?=[A-Z])|_/)) {
      const n = flatten(p);
      if (n.length >= 3) s.add(n);
    }
  };
  ekle(tablo.ad);
  for (const k of tablo.kolonlar) ekle(k.ad);
  return s;
}

/**
 * Metnin bu tabloya ne kadar ait oldugu.
 *
 * Turkce terimler zemin.ts'teki KARSILIK sozlugu uzerinden Ingilizce
 * sema adlarina cevriliyor: "satin alim" -> invoice/teklif. Ayni sozlugu
 * paylasmak, iki yerde ayri esleme tutmanin kaymasini onluyor.
 */
function tableScore(tablo: Tablo, metin: string): number {
  const sozluk = tableVocabulary(tablo);
  const duz = flatten(metin);
  const kelimeler = duz.split(/[^a-z0-9]+/).filter((k) => k.length >= 3);

  let puan = 0;
  // Tablo adinin dogrudan gecmesi en guclu sinyal.
  if (duz.includes(flatten(tablo.ad))) puan += 10;

  for (const k of kelimeler) {
    // 1) Dogrudan sema kelimesi (kolon adi dahil).
    if ([...sozluk].some((sk) => sk.startsWith(k) || k.startsWith(sk))) { puan += 2; continue; }
    // 2) Turkce karsilik uzerinden.
    for (const [tr, ingler] of Object.entries(KARSILIK)) {
      if (!k.startsWith(tr.slice(0, 4)) && !tr.startsWith(k)) continue;
      if (ingler.some((ing) => [...sozluk].some((sk) => sk.startsWith(ing)))) {
        puan += 3;
        break;
      }
    }
  }
  return puan;
}

/**
 * Listeleyici olcumun hangi tablodan alinacagini secer.
 *
 * NIYETIN METRIGI agirlikli: agacta hangi tablo adinin cok gectigine
 * bakmak yaniltiyordu. Satin alma sorusunda agac cogunlukla bilet
 * olcumleri urettigi icin TicketRecords seciliyor, satin alma sorusuna
 * bilet planlariyla cevap veriliyordu.
 */
export interface TableCandidate {
  tablo: Tablo;
  metricScore: number;
  treeScore: number;
}

/**
 * Aday tablolari PUANA GORE SIRALI dondurur.
 *
 * Yalnizca en iyiyi degil TUM adaylari veriyoruz: "satin alim" hem
 * Teklifler hem Invoices olarak yorumlanabiliyor ve secim kosudan
 * kosuya degisebiliyor. Kullaniciya secenegi gostermek, sessizce birini
 * secip digerini gizlemekten dogru.
 *
 * Siralama SOZLUKBILIMSEL: once metrik puani, esitlikte agac.
 * Carpan denendi ama yetmedi -- agacta tablo ADININ gecmesi tek basina
 * +10 getiriyor ve uc bilet olcumu metrikteki tek "teklif" sinyalini
 * eziyordu. Kullanicinin ne sordugu, agacin nereye daldigindan once gelir.
 */
export function rankTableCandidates(
  dugumler: GoalNodeGenis[],
  tablolar: Tablo[],
  metrik = ""
): TableCandidate[] {
  const agacMetni = dugumler
    .map((d) => `${d.statement} ${d.measurementQuery ?? ""}`)
    .join(" ");

  return writableTables()
    .map((ad) => tablolar.find((t) => t.ad.toLowerCase() === ad))
    .filter((t): t is Tablo => Boolean(t))
    .map((tablo) => ({
      tablo,
      metricScore: tableScore(tablo, metrik),
      treeScore: tableScore(tablo, agacMetni),
    }))
    .sort((a, b) =>
      b.metricScore - a.metricScore || b.treeScore - a.treeScore
    );
}

function pickTargetTable(
  dugumler: GoalNodeGenis[],
  tablolar: Tablo[],
  metrik = ""
): Tablo | null {
  // Hicbiri gecmiyorsa yine de ilk yazilabilir tabloyu doner: aksiyonsuz
  // kalmaktansa ilgisi zayif ama somut bir dal daha iyi.
  return rankTableCandidates(dugumler, tablolar, metrik)[0]?.tablo ?? null;
}

/** Insan tarafindan okunabilir kimlik kolonu tercih edilir. */
const KIMLIK_ONCELIGI = [/^BiletNo$/i, /No$/i, /Kod$/i, /^Id$/i];

function identityColumn(tablo: Tablo): string | null {
  // Tabloya yazma islemi tanimliysa ONUN kolonu esastir: listelenen
  // kimlik, islemin bekledigi kimlikle ayni olmali.
  const islem = ISLEMLER.find(
    (i) => i.hedefTablo.toLowerCase() === tablo.ad.toLowerCase()
  );
  if (islem && tablo.kolonlar.some((c) => c.ad === islem.kimlikKolonu)) {
    return islem.kimlikKolonu;
  }

  for (const desen of KIMLIK_ONCELIGI) {
    const k = tablo.kolonlar.find((c) => desen.test(c.ad));
    if (k) return k.ad;
  }
  return null;
}

function labelColumn(tablo: Tablo, kimlik: string): string | null {
  return tablo.kolonlar.find(
    (c) => c.ad !== kimlik && /char/i.test(c.tip)
      && /(baslik|ad|adi|konu|title|name|musteri)/i.test(c.ad)
  )?.ad ?? null;
}

/**
 * Turkce harfleri ASCII'ye indirger.
 *
 * Kalip eslesmesinde \b KULLANILAMIYOR: \b ASCII tabanli, "sayisi"
 * eslesirken "sayısı" eslesmiyordu (sondaki 'ı' kelime karakteri
 * sayilmiyor). Metni once duzlestirmek hem bunu hem de yazim
 * farklarini tek seferde cozuyor.
 */
function flatten(m: string): string {
  return m.toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c");
}

/**
 * Listeleyici olcum dugumunu uretir.
 *
 * AGACTA BENZERI VARSA BILE uretiliyor. Onceden "zaten listeleyici bir
 * olcum var mi" diye bakip atliyorduk; bir kosuda agac "Son bir ay
 * icindeki faturali musterilerin listesi" uretti, kural atlandi, ama o
 * olcum ajan tarafindan yazildigi icin baglanabilir kimlik dondurmedi ve
 * hicbir plan aksiyon kuramadi.
 *
 * Bizimki 0 token ve ~100 ms; atlamanin kazanci yok, riski var.
 */
export interface ListingPlan {
  dugum: GoalNodeGenis;
  /** SQL'i kod uretecek; calistiran taraf bunlara ihtiyac duyuyor. */
  tablo: Tablo;
  kimlik: string;
  etiket: string | null;
}

export function buildListingMeasurement(
  dugumler: GoalNodeGenis[],
  tablolar: Tablo[],
  zamanAraligi = "",
  /** Niyetin metrigi; tablo secimini bu belirliyor. */
  metrik = ""
): ListingPlan | null {
  const tablo = pickTargetTable(dugumler, tablolar, metrik);
  if (!tablo) return null;

  const kimlik = identityColumn(tablo);
  if (!kimlik) return null;

  const etiket = labelColumn(tablo, kimlik);
  const kolonlar = [kimlik, etiket].filter(Boolean).join(", ");

  const parcalar = [
    `${tablo.ad} tablosundan ${kolonlar} kolonlarini LISTELE.`,
    // SQL'i kod uretiyor; bu metin yalnizca arayuzde ne yapildigini
    // anlatiyor.
    "Toplama YAPMA: satirlari tek tek dondur, gruplama ve sayim kullanma.",
    "En fazla 20 satir.",
  ];
  // Tarih FILTRESI degil, tarihe gore SIRALAMA istiyoruz.
  //
  // "son 1 ay" filtresi verildiginde model yanlis tarih kolonunu secip
  // sonucu sifirliyordu. Bu olcumun isi KPI cevaplamak degil, aksiyonun
  // baglanacagi somut kimlikleri uretmek; guncel olmalari yeterli.
  if (zamanAraligi.trim()) {
    parcalar.push(`En guncel kayitlar once gelsin (tarihe gore azalan). Ilgi araligi: ${zamanAraligi}.`);
  }

  // Kok'e baglaniyor: belirli bir kaldiracin altinda degil, agacin
  // tamamina hizmet ediyor.
  const kok = dugumler.find((d) => d.parentId === null);

  return {
    tablo,
    kimlik,
    etiket,
    dugum: {
      id: randomUUID(),
      parentId: kok?.id ?? null,
      statement: `Üzerinde işlem yapılabilecek güncel ${tablo.ad} kayıtları`,
      type: "metric",
      rationale:
        "Aksiyonların gerçek bir kayda bağlanabilmesi için somut satır gerekir; " +
        "toplu ölçümler kimlik üretmez.",
      measurementQuery: parcalar.join(" "),
      evidence: [],
      children: [],
      status: "pending",
    } as GoalNodeGenis,
  };
}
