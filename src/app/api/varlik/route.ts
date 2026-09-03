import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { semaGetir } from "@/core/db/sema";
import { saglayiciSec } from "@/core/llm/index";
import { runEntityProfile } from "@/core/pipeline/varlikCalistir";
import { deriveSignals } from "@/core/pipeline/varlikProfili";
import { buildAdvice, factLines } from "@/core/pipeline/tavsiye";
import { parseTimeRange } from "@/core/pipeline/zamanAraligi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SECILEN varligin profilini kurar.
 *
 * Ad birden fazla kayda uydugunda ("ADA" iki musteriye) akis hicbirini
 * secmiyor, secenekleri gosteriyor. Kullanici birini tikladiginda buraya
 * geliyor.
 *
 * Gelen ad SEMAYA DEGIL VERIYE karsi dogrulanir: profil sorgusu tam
 * esitlikle calisiyor ve eslesme yoksa sonuc bos doner. Yine de metin
 * sabiti kacislaniyor.
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

  // Tablo adi semadan cozuluyor; istemciden gelen ad dogrudan sorguya
  // girmiyor.
  const tablolar = await semaGetir();
  const tablo = tablolar.find((t) => t.ad === tabloAdi) ?? null;
  if (!tablo) {
    return NextResponse.json({ hata: `Tanimsiz tablo: ${tabloAdi}` }, { status: 400 });
  }

  try {
    const olcum = await runEntityProfile(tablo, varlik, aralik, randomUUID());
    if (!olcum?.profile) {
      return NextResponse.json(
        { hata: `${varlik} icin kayit bulunamadi.` }, { status: 404 }
      );
    }

    const signals = deriveSignals(olcum.profile);
    return NextResponse.json({
      profile: olcum.profile,
      signals,
      facts: factLines(olcum.profile, signals),
      advice: await buildAdvice(saglayiciSec(), olcum.profile, signals),
      sorgular: olcum.sorgular,
    });
  } catch (e) {
    return NextResponse.json(
      { hata: e instanceof Error ? e.message : "Profil kurulamadi." },
      { status: 500 }
    );
  }
}
