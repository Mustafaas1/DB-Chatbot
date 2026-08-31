import { NextResponse } from "next/server";
import { baglamOlustur, sistemKur } from "@/core/kur";
import { donguCalistir } from "@/core/ajan/dongu";
import { sistemIstemi } from "@/core/ajan/istem";
import { saglayiciSec } from "@/core/llm/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(istek: Request) {
  let soru: string;
  try {
    const govde = await istek.json();
    soru = String(govde?.soru ?? "").trim();
  } catch {
    return NextResponse.json({ hata: "Gecersiz istek." }, { status: 400 });
  }
  if (!soru) return NextResponse.json({ hata: "Soru bos olamaz." }, { status: 400 });

  const sistem = await sistemKur();
  try {
    const sonuc = await donguCalistir({
      saglayici: saglayiciSec(),
      kayit: sistem.kayit,
      baglam: baglamOlustur(false),
      sistemIstemi: await sistemIstemi(soru),
      soru,
    });

    // Son basarili sorgunun tablosunu arayuze tasi.
    const sonAdim = [...sonuc.adimlar].reverse().find((a) => a.ok);
    let tablo: { kolonlar: string[]; satirlar: unknown[][] } | null = null;
    if (sonAdim) {
      try {
        const c = JSON.parse(sonAdim.ozet);
        if (Array.isArray(c?.kolonlar) && Array.isArray(c?.satirlar)) {
          tablo = { kolonlar: c.kolonlar, satirlar: c.satirlar };
        }
      } catch { /* tablo yoksa sorun degil */ }
    }

    return NextResponse.json({
      cevap: sonuc.cevap,
      tablo,
      adimlar: sonuc.adimlar.map((a) => ({
        ad: a.ad,
        sorgu: (a.girdi as { sorgu?: string })?.sorgu ?? "",
        ok: a.ok,
        sureMs: a.sureMs,
      })),
      kullanim: sonuc.kullanim,
      tamamlandi: sonuc.tamamlandi,
    });
  } catch (e) {
    return NextResponse.json(
      { hata: e instanceof Error ? e.message : "Beklenmeyen hata." },
      { status: 500 }
    );
  } finally {
    await sistem.kapat();
  }
}
