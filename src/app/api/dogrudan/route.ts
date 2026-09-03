import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { semaGetir } from "@/core/db/sema";
import { planDirectAnswer, runDirectAnswer } from "@/core/pipeline/dogrudanCevap";
import { summarizeList } from "@/core/pipeline/ozet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dogrudan cevabi BASKA BIR TABLO uzerinden yeniden hesaplar.
 *
 * "Satin alim" hem Teklifler hem Invoices olarak yorumlanabiliyor;
 * secim otomatik yapiliyor ama kullanici degistirebilmeli.
 *
 * Model CAGRILMAZ: sorgu kodda uretiliyor, maliyet sifir. Bu yuzden
 * kullanicinin tablolar arasinda gezinmesi serbest.
 */
export async function POST(istek: Request) {
  let g: Record<string, unknown>;
  try { g = (await istek.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ hata: "Gecersiz istek." }, { status: 400 }); }

  const tabloAdi = String(g.tablo ?? "").trim();
  const soru = String(g.soru ?? "").trim();
  const zamanAraligi = String(g.zamanAraligi ?? "").trim();

  if (!tabloAdi || !soru) {
    return NextResponse.json({ hata: "Tablo ve soru zorunlu." }, { status: 400 });
  }

  // Tablo adi SEMAYA karsi dogrulanir; istemciden gelen ad dogrudan
  // sorguya girmiyor.
  const tablolar = await semaGetir();
  const tablo = tablolar.find((t) => t.ad === tabloAdi) ?? null;
  if (!tablo) {
    return NextResponse.json({ hata: `Tanimsiz tablo: ${tabloAdi}` }, { status: 400 });
  }

  const plan = planDirectAnswer(tablo, zamanAraligi);
  if (!plan) {
    return NextResponse.json(
      { hata: `${tabloAdi} bu soru sekli icin kullanilamiyor (varlik/tarih kolonu ya da zaman araligi yok).` },
      { status: 400 }
    );
  }

  try {
    const sonuc = await runDirectAnswer(plan, soru, randomUUID());
    return NextResponse.json({
      sonuc,
      ozet: summarizeList(sonuc.kolonlar, sonuc.satirlar),
      kaynak: "kod" as const,
    });
  } catch (e) {
    return NextResponse.json(
      { hata: e instanceof Error ? e.message : "Sorgu basarisiz." },
      { status: 500 }
    );
  }
}
