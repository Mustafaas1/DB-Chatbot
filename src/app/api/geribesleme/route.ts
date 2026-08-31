import { NextResponse } from "next/server";
import { geriBeslemeCalistir } from "@/core/geribesleme/dongu";
import { geriBeslemeDurumlari } from "@/core/geribesleme/depo";
import { listele } from "@/core/yaz/denetim";
import { saglayiciSec } from "@/core/llm/index";
import { sistemKur } from "@/core/kur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Geri besleme yapilabilecek islemlerin listesini dondurur.
 *
 * Yalnizca "uygulandi" durumundaki denetim kayitlari gelir;
 * her biri icin snapshot durumu (once/sonra var mi) eklenir.
 */
export async function GET() {
  const kayitlar = listele(50);
  const uygulanmis = kayitlar.filter((k) => k.durum === "uygulandi");
  const durumlar = geriBeslemeDurumlari(uygulanmis.map((k) => k.id));
  const durumHarita = new Map(durumlar.map((d) => [d.denetimId, d]));

  return NextResponse.json({
    kayitlar: uygulanmis.map((k) => {
      const durum = durumHarita.get(k.id);
      return {
        id: k.id,
        islemAdi: k.islemAdi,
        hedefTablo: k.hedefTablo,
        parametreler: k.parametreler,
        onaylayan: k.onaylayan,
        olusturma: k.olusturma,
        guncelleme: k.guncelleme,
        provaOzet: k.prova?.ozet ?? null,
        onceVar: durum?.onceVar ?? false,
        sonraVar: durum?.sonraVar ?? false,
        sonOlcum: durum?.sonOlcum ?? null,
      };
    }),
  });
}

/**
 * POST: Geri besleme dongusunu baslatir (SSE).
 *
 * Istek: { denetimId: string }
 * SSE olaylari: basladi, once_tamam, sonra_basladi, sonra_tamam, etki, bitti, hata, uyari
 */
export async function POST(istek: Request) {
  let denetimId: string;
  try {
    const govde = await istek.json();
    denetimId = String(govde?.denetimId ?? "").trim();
  } catch {
    return new Response("Geçersiz istek", { status: 400 });
  }
  if (!denetimId) return new Response("denetimId boş olamaz", { status: 400 });

  const kodlayici = new TextEncoder();
  const akis = new ReadableStream({
    async start(kontrol) {
      const yolla = (veri: unknown) =>
        kontrol.enqueue(kodlayici.encode(`data: ${JSON.stringify(veri)}\n\n`));

      const sistem = await sistemKur();
      try {
        const saglayici = saglayiciSec();
        for await (const olay of geriBeslemeCalistir({
          denetimId,
          saglayici,
          kayit: sistem.kayit,
          referansOlustur: true,
        })) {
          yolla(olay);
        }
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
