import { NextResponse } from "next/server";
import { reddet, listele } from "@/core/plan/red";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan reddi.
 *
 * Simule/uygula burada DEGIL: onlar /api/islem uzerinden gider. Yazma
 * yolunun tek olmasi, prova -> onay -> uygula -> geri al zincirinin ve
 * denetim kaydinin atlanmasini imkansiz kiliyor.
 */

export async function GET(istek: Request) {
  const ajan = new URL(istek.url).searchParams.get("ajan") ?? undefined;
  return NextResponse.json({ redler: listele(ajan, 20) });
}

export async function POST(istek: Request) {
  let g: Record<string, unknown>;
  try { g = (await istek.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ hata: "Gecersiz istek." }, { status: 400 }); }

  const sebep = String(g.sebep ?? "").trim();
  const ajan = String(g.ajan ?? "").trim();
  const baslik = String(g.planBasligi ?? "").trim();

  // Sebepsiz red kaydetmek ise yaramaz: ajana verilecek baglam bos kalir.
  if (!sebep) {
    return NextResponse.json(
      { hata: "Reddetme sebebi zorunlu; sonraki turda ajana baglam olarak veriliyor." },
      { status: 400 }
    );
  }
  if (!ajan || !baslik) {
    return NextResponse.json({ hata: "Plan bilgisi eksik." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    id: reddet(ajan, baslik, sebep, String(g.reddeden ?? "arayuz")),
  });
}
