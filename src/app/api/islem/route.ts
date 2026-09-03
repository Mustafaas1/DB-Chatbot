import { NextResponse } from "next/server";
import { geriAl, oner, reddet, uygula, OnayHatasi } from "@/core/yaz/yurutucu";
import { listele } from "@/core/yaz/denetim";
import { ISLEMLER } from "@/core/yaz/islemler";
import { yazmaAcikMi } from "@/core/yaz/havuzYaz";
import { ajanTanimiBul } from "@/agents";
import type { OlcumBaglami } from "@/core/geribesleme/tipler";

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
      // Arayuz tablo kapsamini bilmiyor; ajan tanimindan dolduruyoruz.
      // Istemciye sordurmak, kapsami istemciden gelen veriye baglardi.
      //
      // sql alani GERCEKTEN sorgu olmali. Bir kez dogal dilde soru
      // gonderildi; "once" goruntusu alinamadi ve hata sessizce yutuldu,
      // etki raporu da sebebini soyleyemedi. Simdi sinirda reddediyoruz.
      const ham = Array.isArray(govde.olcumBaglamlari)
        ? (govde.olcumBaglamlari as OlcumBaglami[])
        : [];
      const sorguDegil = ham.find((b) => !/^\s*(SELECT|WITH)\b/i.test(b?.sql ?? ""));
      if (sorguDegil) {
        return NextResponse.json({
          hata: `Olcum baglami SQL degil: "${String(sorguDegil.sql ?? "").slice(0, 60)}". ` +
                "Baglam calistirilmis olcumun sorgusundan gelmeli.",
        }, { status: 400 });
      }
      const baglamlar = Array.isArray(govde.olcumBaglamlari)
        ? ham.map((b) => ({
            ...b,
            tablolar: b.tablolar?.length
              ? b.tablolar
              : [...(ajanTanimiBul(b.ajanKod)?.tablolar ?? [])],
          }))
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
