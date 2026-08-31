import { agacKur } from "@/core/hedef/agac";
import { veriOzeti } from "@/core/hedef/veriOzeti";
import { olcumDugumleri } from "@/core/hedef/tipler";
import { dagit } from "@/core/ajan/dagitici";
import { olcumleriCalistir } from "@/core/ajan/olcum";
import { semaGetir } from "@/core/db/sema";
import { durumDegerleri } from "@/core/db/degerler";
import { saglayiciSec } from "@/core/llm/index";
import { niyetCikar } from "@/core/pipeline/intent";
import { teshisCikar } from "@/core/pipeline/teshis";
import { planUret } from "@/core/pipeline/plan";
import { sistemKur } from "@/core/kur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Zinciri adim adim yayinlar (Server-Sent Events).
 *
 * Tek yanit beklemek 60+ saniye suruyor. Akis, agac kurulur kurulmaz
 * gonderiliyor; olcumler bittikce ekleniyor. Kullanici bos ekrana bakmiyor.
 */
export async function POST(istek: Request) {
  let soru: string;
  try {
    soru = String((await istek.json())?.soru ?? "").trim();
  } catch {
    return new Response("Gecersiz istek", { status: 400 });
  }
  if (!soru) return new Response("Soru bos olamaz", { status: 400 });

  const kodlayici = new TextEncoder();
  const akis = new ReadableStream({
    async start(kontrol) {
      const yolla = (veri: unknown) =>
        kontrol.enqueue(kodlayici.encode(`data: ${JSON.stringify(veri)}\n\n`));

      const sistem = await sistemKur();
      try {
        const saglayici = saglayiciSec();
        const tablolar = await semaGetir();
        const degerler = await durumDegerleri(tablolar);

        // S0 - INTENT: ortuk hedefi cikar. Agacin KOKU bu olur; ham soru
        // kok olursa agac raporlama agacina donusuyor, kaldirac aramiyor.
        const { niyet, geriDusuldu } = await niyetCikar(saglayici, soru);
        yolla({ tur: "niyet", niyet, geriDusuldu });

        const agac = await agacKur({
          saglayici, soru: niyet.ortukHedef,
          veriOzetiMetni: veriOzeti(tablolar, degerler),
          azamiDerinlik: 2, azamiCagri: 4,
        });
        yolla({ tur: "agac", agac });

        const atamalar = dagit(olcumDugumleri(agac.kok));
        yolla({
          tur: "plan",
          atamalar: atamalar.map((a) => ({
            dugumId: a.dugum.id, baslik: a.dugum.baslik,
            ajanKod: a.ajan.kod, ajanAd: a.ajan.ad, renk: a.ajan.renk,
          })),
        });

        for await (const olay of olcumleriCalistir({
          saglayici, kayit: sistem.kayit, atamalar,
          esZamanli: 2, azamiOlcum: 4,
          // Dogrulama: olmayan degere atif yapan olcumler calistirilmadan
          // elenir, boylece kota bos sorguya harcanmaz.
          tablolar, degerler,
        })) {
          yolla(olay);
          // S2 - DIAGNOSE: olcum biter bitmez hesaplanabilir bulgulari
          // cikar. LLM cagrisi yok, tamami aritmetik.
          if (olay.tur === "bitti") {
            const teshis = teshisCikar(olay.sonuc);
            yolla({ tur: "teshis", teshis });

            // S4 - PLAN: bos olcumden plan uretmenin anlami yok; kota
            // bosa gitmesin.
            if (!olay.sonuc.bosMu) {
              const { planlar } = await planUret(
                saglayici, olay.sonuc, teshis, niyet.ortukHedef
              );
              if (planlar.length) yolla({ tur: "planlar", planlar });
            }
          }
        }

        yolla({ tur: "bitti" });
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
