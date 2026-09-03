import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { semaGetir } from "@/core/db/sema";
import { veriSorgulaAraci } from "@/core/db/aracSorgu";
import { pickAnalysisColumns } from "@/core/pipeline/nedenAnalizi";
import { buildDetailQuery, pickDetailColumns } from "@/core/pipeline/detay";
import { sqlLiteral } from "@/core/pipeline/varlik";
import { parseTimeRange } from "@/core/pipeline/zamanAraligi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ozet tablosundaki bir satirin AYRINTISI.
 *
 * "3 teklif, 671.946 TRY" satirina tiklaninca o uc teklifin kendisi.
 * Model CAGRILMAZ: sorgu kodda uretiliyor, maliyet sifir. Bu yuzden
 * kullanicinin satirlar arasinda gezinmesi serbest.
 */
export async function POST(istek: Request) {
  let g: Record<string, unknown>;
  try { g = (await istek.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ hata: "Gecersiz istek." }, { status: 400 }); }

  const tabloAdi = String(g.tablo ?? "").trim();
  const varlik = String(g.varlik ?? "").trim();
  const zamanAraligi = String(g.zamanAraligi ?? "").trim();

  if (!tabloAdi || !varlik) {
    return NextResponse.json({ hata: "Tablo ve varlik zorunlu." }, { status: 400 });
  }

  const aralik = parseTimeRange(zamanAraligi);
  if (!aralik) {
    return NextResponse.json(
      { hata: `Zaman araligi anlasilamadi: "${zamanAraligi}"` }, { status: 400 }
    );
  }

  // Tablo adi SEMADAN cozuluyor; istemciden gelen ad dogrudan sorguya
  // girmiyor. Varlik adi ise metin sabiti olarak kacislaniyor.
  const tablolar = await semaGetir();
  const tablo = tablolar.find((t) => t.ad === tabloAdi) ?? null;
  if (!tablo) {
    return NextResponse.json({ hata: `Tanimsiz tablo: ${tabloAdi}` }, { status: 400 });
  }

  const k = pickAnalysisColumns(tablo);
  if (!k) {
    return NextResponse.json(
      { hata: `${tabloAdi} icin varlik/tarih kolonu bulunamadi.` }, { status: 400 }
    );
  }

  try {
    const sql = buildDetailQuery(k, pickDetailColumns(tablo), varlik, aralik, sqlLiteral);
    const sonuc = await veriSorgulaAraci.calistir(
      { sorgu: sql }, { izId: randomUUID(), provaMi: false }
    );
    return NextResponse.json({
      kolonlar: sonuc.kolonlar,
      satirlar: sonuc.satirlar,
    });
  } catch (e) {
    return NextResponse.json(
      { hata: e instanceof Error ? e.message : "Ayrinti getirilemedi." },
      { status: 500 }
    );
  }
}
