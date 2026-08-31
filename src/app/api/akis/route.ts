import { agacKur } from "@/core/hedef/agac";
import { veriOzeti } from "@/core/hedef/veriOzeti";
import { olcumDugumleri } from "@/core/hedef/tipler";
import { dagit } from "@/core/ajan/dagitici";
import { olcumleriCalistir } from "@/core/ajan/olcum";
import { semaGetir } from "@/core/db/sema";
import { durumDegerleri } from "@/core/db/degerler";
import { saglayiciSec } from "@/core/llm/index";
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

        const agac = await agacKur({
          saglayici, soru,
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
