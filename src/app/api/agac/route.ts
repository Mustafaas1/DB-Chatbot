import { NextResponse } from "next/server";
import { agacKur } from "@/core/hedef/agac";
import { veriOzeti } from "@/core/hedef/veriOzeti";
import { semaGetir } from "@/core/db/sema";
import { durumDegerleri } from "@/core/db/degerler";
import { havuzKapat } from "@/core/db/havuz";
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

  try {
    const tablolar = await semaGetir();
    const degerler = await durumDegerleri(tablolar);
    const agac = await agacKur({
      saglayici: saglayiciSec(),
      soru,
      veriOzetiMetni: veriOzeti(tablolar, degerler),
      azamiDerinlik: 2,
      azamiCagri: 4,
    });
    return NextResponse.json(agac);
  } catch (e) {
    return NextResponse.json(
      { hata: e instanceof Error ? e.message : "Beklenmeyen hata." },
      { status: 500 }
    );
  } finally {
    await havuzKapat();
  }
}
