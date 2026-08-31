import { NextResponse } from "next/server";
import { geriAl, oner, reddet, uygula, OnayHatasi } from "@/core/yaz/yurutucu";
import { listele } from "@/core/yaz/denetim";
import { ISLEMLER } from "@/core/yaz/islemler";
import { yazmaAcikMi } from "@/core/yaz/havuzYaz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Beyaz listeyi ve denetim kaydini dondurur. */
export async function GET() {
  return NextResponse.json({
    yazmaAcik: yazmaAcikMi(),
    islemler: ISLEMLER.map((i) => ({
      kod: i.kod, ad: i.ad, aciklama: i.aciklama, hedefTablo: i.hedefTablo,
    })),
    kayitlar: listele(30),
  });
}

/**
 * Eylemler: oner / uygula / reddet / geri_al
 *
 * "oner" hicbir sey degistirmez; yalnizca provayi hesaplar. Degisiklik
 * ancak "uygula" ile ve onaylayan bilgisiyle olur.
 */
export async function POST(istek: Request) {
  let govde: Record<string, unknown>;
  try {
    govde = (await istek.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ hata: "Gecersiz istek." }, { status: 400 });
  }

  const eylem = String(govde.eylem ?? "");
  try {
    if (eylem === "oner") {
      // olcumBaglamlari: planin dogdugu olcum(ler). F6 bunlari yeniden
      // calistirip etkiyi olcuyor.
      const baglamlar = Array.isArray(govde.olcumBaglamlari)
        ? (govde.olcumBaglamlari as any[])
        : undefined;
      return NextResponse.json(
        await oner(String(govde.islemKodu ?? ""), govde.parametreler, baglamlar)
      );
    }
    if (eylem === "uygula") {
      return NextResponse.json(await uygula(String(govde.kayitId ?? ""), String(govde.onaylayan ?? "")));
    }
    if (eylem === "reddet") {
      return NextResponse.json(reddet(String(govde.kayitId ?? ""), String(govde.onaylayan ?? "")));
    }
    if (eylem === "geri_al") {
      return NextResponse.json(await geriAl(String(govde.kayitId ?? ""), String(govde.onaylayan ?? "")));
    }
    return NextResponse.json({ hata: `Bilinmeyen eylem: ${eylem}` }, { status: 400 });
  } catch (e) {
    const durum = e instanceof OnayHatasi ? 400 : 500;
    return NextResponse.json(
      { hata: e instanceof Error ? e.message : "Beklenmeyen hata." },
      { status: durum }
    );
  }
}
