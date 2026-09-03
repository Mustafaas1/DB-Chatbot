import { buildTree } from "@/core/hedef/agac";
import { dataOverview } from "@/core/hedef/veriOzeti";
import { olcumDugumleri } from "@/core/hedef/tipler";
import type { GoalNodeGenis } from "@/schemas/index";
import { dagit } from "@/core/ajan/dagitici";
import { dataAnalyst } from "@/agents/data-analyst";
import { olcumleriCalistir, type OlcumSonucu } from "@/core/ajan/olcum";
import { semaGetir, type Tablo } from "@/core/db/sema";
import { durumDegerleri } from "@/core/db/degerler";
import { saglayiciSec } from "@/core/llm/index";
import { extractIntent } from "@/core/pipeline/intent";
import { diagnose } from "@/core/pipeline/teshis";
import { buildPlans } from "@/core/pipeline/plan";
import { sistemKur } from "@/core/kur";
import { Budget } from "@/core/butce/butce";
import { buildListingMeasurement, rankTableCandidates } from "@/core/hedef/listeleyici";
import { runListingMeasurement } from "@/core/hedef/listeleyiciCalistir";
import { runCauseAnalysis } from "@/core/pipeline/nedenAnaliziCalistir";
import { planDirectAnswer, runDirectAnswer } from "@/core/pipeline/dogrudanCevap";
import { runEntityInsight } from "@/core/pipeline/varlikCalistir";
import { parseTimeRange } from "@/core/pipeline/zamanAraligi";
import { summarizeList } from "@/core/pipeline/ozet";
import { schemaVocabulary, checkGrounding } from "@/core/hedef/zemin";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kullanicinin "devam et" dedigi tur: agac hazir, kalan olcumler bilinir. */
interface DevamGovdesi {
  hedef: string;
  dugumler: GoalNodeGenis[];
  /** Bu turda ATLANACAK dugumler: onceki turda zaten olculduler. */
  olculenler: string[];
  /** Kullanicinin verdigi ek butce. */
  ekToken?: number;
  ekTur?: number;
}

/**
 * Literal soruyu olculebilir bir istege cevirir.
 *
 * Modelin kendi basina "getir" sorusundan makul bir sorgu uretmedigi
 * goruldu; niyetten cikan yapiyi acikca geri veriyoruz.
 */
function dogrudanSoru(soru: string, niyet: { metrik: string; zamanAraligi: string }): string {
  const parcalar = [soru];
  if (niyet.zamanAraligi.trim()) {
    parcalar.push(`Zaman araligi: ${niyet.zamanAraligi}. Tarih filtresini MUTLAKA uygula.`);
  }
  if (niyet.metrik.trim()) parcalar.push(`Olculecek: ${niyet.metrik}.`);
  parcalar.push(
    "Ilgili kolonlari SEC (SELECT * KULLANMA), varlik basina grupla ve",
    "sayisal olculeri (adet, toplam tutar) ayni sorguda dondur.",
    "En fazla 100 satir."
  );
  return parcalar.join(" ");
}

/**
 * Zinciri adim adim yayinlar (Server-Sent Events).
 *
 * Tek yanit beklemek 60+ saniye suruyor. Akis, agac kurulur kurulmaz
 * gonderiliyor; olcumler bittikce ekleniyor. Kullanici bos ekrana bakmiyor.
 */
export async function POST(istek: Request) {
  let soru: string;
  let devam: DevamGovdesi | null = null;
  try {
    const g = (await istek.json()) as Record<string, unknown>;
    soru = String(g?.soru ?? "").trim();
    devam = (g?.devam as DevamGovdesi | undefined) ?? null;
  } catch {
    return new Response("Gecersiz istek", { status: 400 });
  }
  if (!soru) return new Response("Soru bos olamaz", { status: 400 });

  const kodlayici = new TextEncoder();
  const akis = new ReadableStream({
    async start(kontrol) {
      const yolla = (veri: unknown) =>
        kontrol.enqueue(kodlayici.encode(`data: ${JSON.stringify(veri)}\n\n`));

      // Butce soru basina. Devam turunda kullanici ek butce verdi; sifirdan
      // baslamak butcenin anlamini yok ederdi, o yuzden limiti YUKSELTIYORUZ.
      const butce = new Budget(
        devam?.ekToken ? Number(devam.ekToken) : undefined,
        devam?.ekTur ? Number(devam.ekTur) : undefined
      );

      /** Butce dolduysa akisi kapatir; true donerse cagiran durmalidir. */
      const butceDoldu = (kalanDugumler: string[], hedef: string, dugumler: GoalNodeGenis[]) => {
        const d = butce.state();
        if (!d.exceeded) return false;
        yolla({
          tur: "butce",
          state: d,
          // Devam icin gereken her sey: sunucu tur arasi durum tutmuyor.
          kalan: kalanDugumler.length,
          devam: kalanDugumler.length
            ? { hedef, dugumler, olculenler: dugumler.map((x) => x.id).filter((i) => !kalanDugumler.includes(i)) }
            : null,
        });
        return true;
      };

      const sistem = await sistemKur();
      try {
        const saglayici = saglayiciSec();
        const tablolar = await semaGetir();
        const degerler = await durumDegerleri(tablolar);

        let hedef: string;
        let dugumler: GoalNodeGenis[];
        /** Eklenen listeleyici olcumun id'si; kota kesmeden once calissin. */
        let listeleyiciId: string | null = null;
        /** Kod tarafindan calistirilan listeleyici olcumun sonucu. */
        let listeSonucu: OlcumSonucu | null = null;
        /** Neden analizinin uzerinde calisacagi tablo. */
        let analizTablosu: Tablo | null = null;

        if (devam) {
          // S0 ve S1 ATLANIYOR: agac istemciden geldi. Tekrar kurmak,
          // butceyi korumak icin durdugumuz isi bastan yapmak olurdu.
          hedef = devam.hedef;
          dugumler = devam.dugumler;
          yolla({ tur: "devam", olculen: devam.olculenler.length });
        } else {
          // S0 - INTENT: ortuk hedefi cikar. Agacin KOKU bu olur; ham soru
          // kok olursa agac raporlama agacina donusuyor, kaldirac aramiyor.
          const { niyet, fellBack, kullanim } = await extractIntent(saglayici, soru);
          butce.spend(kullanim);
          yolla({ tur: "niyet", niyet, geriDusuldu: fellBack });

          const agac = await buildTree({
            saglayici, soru: niyet.ortukHedef,
            veriOzetiMetni: dataOverview(tablolar, degerler),
            azamiDerinlik: 2, azamiCagri: 4,
          });
          butce.spend(agac.kullanim);
          yolla({ tur: "agac", agac });

          hedef = niyet.ortukHedef;
          dugumler = agac.dugumler;

          // LISTELEYICI OLCUM KURALI.
          // Agac hep toplu olcum uretiyor; toplu sonuc somut kayit
          // icermedigi icin hicbir plan calistirilabilir aksiyon
          // kuramiyordu. Satir donduren bir dal ekliyoruz.
          const listeleyici = buildListingMeasurement(
            dugumler, tablolar, niyet.zamanAraligi, niyet.metrik
          );
          // Analiz ve listeleme AYNI tabloyu kullaniyor; secim metrige
          // gore bir kez yapiliyor.
          if (listeleyici) analizTablosu = listeleyici.tablo;

          if (listeleyici) {
            dugumler = [...dugumler, listeleyici.dugum];
            listeleyiciId = listeleyici.dugum.id;
            yolla({ tur: "listeleyici", dugum: listeleyici.dugum });

            // SQL'i KOD uretiyor ve DOGRUDAN calistiriyor; ajan yok.
            // Ajana yazdirmak degiskendi: ayni olcum bir kosuda 20 satir,
            // digerinde 0 donduruyordu. Token da harcamiyor.
            try {
              listeSonucu = await runListingMeasurement(
                listeleyici.dugum.id, listeleyici.dugum.statement,
                listeleyici.tablo, listeleyici.kimlik, listeleyici.etiket
              );
            } catch (e) {
              yolla({
                tur: "hata", dugumId: listeleyici.dugum.id,
                ajanKod: dataAnalyst.kod, baslik: listeleyici.dugum.statement,
                mesaj: e instanceof Error ? e.message : String(e),
              });
            }

          }

          // VARLIK ODAKLI CEVAP.
          //
          // "Fellas diye bir musteriye bu ay kac satis yaptik?" sorusu
          // dogrudan cevaptan FARKLI bir sekil: cevap tum musteri listesi
          // degil, TEK varligin sayisi ve o sayinin baglami.
          //
          // Once bu deneniyor cunku tutarsa dogrudan cevap gereksiz --
          // tek musteri sorulmusken 52 musteriyi "sorunun cevabi" diye
          // gostermek soruyu cevaplamamak olurdu.
          let varlikCevapladi = false;
          if (analizTablosu && niyet.varlik.trim()) {
            const aralik = parseTimeRange(niyet.zamanAraligi);
            // Zaman araligi ayristirilamiyorsa profil kurulamaz: "bu ay"
            // ile "son 1 ay" farkli donemler ve tahmin etmiyoruz.
            if (aralik) {
              try {
                const icgoru = await runEntityInsight(
                  saglayici, analizTablosu, niyet.varlik, aralik, randomUUID()
                );
                if (icgoru) {
                  if (icgoru.advice) butce.spend(icgoru.advice.kullanim);
                  yolla({ tur: "varlik", icgoru, zamanAraligi: niyet.zamanAraligi });
                  varlikCevapladi = icgoru.profile != null;
                }
              } catch (e) {
                // Varlik karti bir EK katman; dusmesi akisi durdurmamali.
                // Sessizce yutmuyoruz: sunucu gunlugune yaziliyor.
                console.error("[varlik icgorusu]", e);
              }
            }
          }

          // KRITER 1 - DOGRUDAN CEVAP.
          //
          // HIBRIT: soru kodun tanidigi sekle ("varlik basina olcum,
          // su zaman araliginda") uyuyorsa SQL'i kod uretir; uymuyorsa
          // ajana duser. Ajan yolu kosudan kosuya farkli sorgu yaziyordu
          // -- bir kosu 73 satir, digeri `Tutar IS NOT NULL` ekleyip 33.
          if (niyet.tur === "veri_sorusu" && !varlikCevapladi && !butce.isExceeded()) {
            const plan = planDirectAnswer(analizTablosu, niyet.zamanAraligi);

            if (plan) {
              try {
                const sonuc = await runDirectAnswer(plan, soru, randomUUID());
                yolla({
                  tur: "dogrudanCevap",
                  sonuc,
                  ozet: summarizeList(sonuc.kolonlar, sonuc.satirlar),
                  kaynak: "kod",
                  tablo: plan.tablo.ad,
                  zamanAraligi: niyet.zamanAraligi,
                  // Secim otomatik yapildi ama tek dogru yorum olmayabilir;
                  // kullanici diger tablolari deneyebilsin.
                  adaylar: rankTableCandidates(dugumler, tablolar, niyet.metrik)
                    .map((a) => a.tablo.ad),
                });
              } catch (e) {
                yolla({
                  tur: "hata",
                  mesaj: `Dogrudan cevap sorgusu basarisiz: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                });
              }
            } else {
              // Sekil taninmadi: ajan yazsin.
              for await (const olay of olcumleriCalistir({
                saglayici, kayit: sistem.kayit, tablolar, degerler,
                esZamanli: 1, azamiOlcum: 1,
                // Bolum ajanina DAGITMIYORUZ: kapsaminda ilgili tablo
                // olmayan bir ajana dusup sonucu bosaltiyordu.
                atamalar: [{
                  ajan: dataAnalyst,
                  puan: 1,
                  belirsiz: false,
                  dugum: {
                    id: randomUUID(), parentId: null, statement: soru,
                    type: "metric", rationale: "",
                    measurementQuery: dogrudanSoru(soru, niyet),
                    evidence: [], children: [], status: "pending",
                  } as GoalNodeGenis,
                }],
              })) {
                if (olay.tur !== "bitti") continue;
                butce.spend(olay.sonuc.kullanim);
                // Ozet MODELDEN degil, donen satirlardan hesaplaniyor.
                yolla({
                  tur: "dogrudanCevap",
                  sonuc: olay.sonuc,
                  ozet: summarizeList(olay.sonuc.kolonlar, olay.sonuc.satirlar),
                  kaynak: "ajan",
                  tablo: null,
                  zamanAraligi: niyet.zamanAraligi,
                  adaylar: [],
                });
              }
            }
          }

          // KRITER 2 - NEDEN ANALIZI.
          //
          // Listeleyici olcum EKLENMIS OLMASINDAN BAGIMSIZ calisir. Once
          // `if (listeleyici)` blogunun icindeydi; agac kendi "...listesi"
          // olcumunu urettiginde listeleyici eklenmiyor ve analiz de
          // sessizce atlaniyordu. Analizin tek ihtiyaci hedef tablo.
          if (analizTablosu) {
            try {
              const analiz = await runCauseAnalysis(analizTablosu, "neden-analizi");
              if (analiz) yolla({ tur: "nedenAnalizi", analiz });
            } catch (e) {
              console.error("[neden analizi]", e);
            }
          }

          // KRITER 2 - EKSIK BOYUT.
          // Kullanici "kanala gore" gibi bir kirilim istediyse ve veride
          // karsiligi yoksa, sessizce atlamak yerine SOYLE.
          if (niyet.segment.trim()) {
            const z = checkGrounding(niyet.segment, schemaVocabulary(tablolar));
            if (!z.grounded) {
              yolla({ tur: "eksikBoyut", segment: niyet.segment, sebep: z.sebep });
            }
          }
        }

        const atlanacak = new Set(devam?.olculenler ?? []);
        const olcumler = olcumDugumleri(dugumler).filter((d) => !atlanacak.has(d.id));
        // Listeleyici olcum AJANA DAGITILMIYOR: SQL'i kod uretti ve
        // yukarida calistirdi. Kalanlar normal dagitimdan geciyor.
        const atamalar = dagit(
          olcumler.filter((d) => d.id !== listeleyiciId), tablolar
        );
        yolla({
          tur: "plan",
          atamalar: atamalar.map((a) => ({
            dugumId: a.dugum.id, baslik: a.dugum.statement,
            ajanKod: a.ajan.kod, ajanAd: a.ajan.ad, renk: a.ajan.renk,
            belirsiz: a.belirsiz,
          })),
        });

        // Agac kurulurken butce bitmis olabilir: olcume hic girmeyelim.
        if (butceDoldu(atamalar.map((a) => a.dugum.id), hedef, dugumler)) return;

        /**
         * Bir olcum sonucunu teshis + plan asamalarindan gecirir.
         *
         * Hem ajan olcumleri hem KOD tarafindan calistirilan listeleyici
         * olcum ayni yoldan geciyor; iki ayri kod yolu tutmak, birinde
         * yapilan duzeltmenin digerine gecmemesi demekti.
         */
        const sonucuIsle = async (sonuc: OlcumSonucu) => {
          butce.spend(sonuc.kullanim);
          const teshis = diagnose(sonuc);
          yolla({ tur: "teshis", teshis });

          // S4 - PLAN: bos olcumden plan uretmenin anlami yok; kota
          // bosa gitmesin.
          if (!sonuc.bosMu && !butce.isExceeded()) {
            const { planlar, kullanim } = await buildPlans(
              saglayici, sonuc, teshis, hedef, { tablolar, degerler }
            );
            butce.spend(kullanim);
            if (planlar.length) yolla({ tur: "planlar", planlar });
          }
        };

        // Listeleyici olcum ONCE islensin: aksiyon uretebilen dal o, kota
        // bittiginde bile plan cikarabilmis olalim.
        if (listeSonucu) {
          yolla({ tur: "bitti", sonuc: listeSonucu });
          await sonucuIsle(listeSonucu);
        }

        const bekleyen = new Set(atamalar.map((a) => a.dugum.id));
        for await (const olay of olcumleriCalistir({
          saglayici, kayit: sistem.kayit, atamalar,
          esZamanli: 2, azamiOlcum: 8,
          // Dogrulama: olmayan degere atif yapan olcumler calistirilmadan
          // elenir, boylece kota bos sorguya harcanmaz.
          tablolar, degerler,
        })) {
          yolla(olay);
          if ("dugumId" in olay) bekleyen.delete(olay.dugumId);

          // S2 - DIAGNOSE: olcum biter bitmez hesaplanabilir bulgulari
          // cikar. LLM cagrisi yok, tamami aritmetik.
          if (olay.tur === "bitti") {
            bekleyen.delete(olay.sonuc.dugumId);
            await sonucuIsle(olay.sonuc);
          }

          // Olcumler arasinda kontrol: siradaki olcume girmeden dur.
          if (butceDoldu([...bekleyen], hedef, dugumler)) return;
        }

        yolla({ tur: "bitti", butce: butce.state() });
      } catch (e) {
        yolla({ tur: "hata", mesaj: e instanceof Error ? e.message : String(e) });
      } finally {
        await sistem.kapat();
        kontrol.close();
      }
    },
  });

  return new Response(akis, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
