import type { Tablo } from "../db/sema";
import type { Saglayici } from "../llm/tipler";
import { veriSorgulaAraci } from "../db/aracSorgu";
import { pickAnalysisColumns } from "./nedenAnalizi";
import {
  pickSingleMatch, resolveEntity, sqlLiteral,
  type EntityResolution,
} from "./varlik";
import {
  buildEntityProfileQuery, buildPeerQuery, deriveSignals,
  readEntityProfile, readPeerPosition,
  type EntityProfile, type Signal,
} from "./varlikProfili";
import { buildAdvice, factLines, type Advice } from "./tavsiye";
import type { TimeRange } from "./zamanAraligi";

/**
 * VARLIK ODAKLI CEVAP: coz -> olc -> yorumla.
 *
 * "Fellas diye bir musteriye bu ay kac kere satis yaptik?" gibi sorular
 * icin. Once ad veritabaninda cozulur, sonra profil sorgulari calisir,
 * en sonda tavsiye kurulur.
 *
 * Her adim bir ONCEKININ basarisina bagli ve basarisizlik SESSIZ DEGIL:
 * eslesme yoksa "boyle bir kayit yok", birden fazlaysa secenekler
 * gosterilir. Ikisinde de profil kurulmaz -- yanlis varligin sayilarini
 * gostermek hicbir sayi gostermemekten kotudur.
 */

export interface EntityInsight {
  resolution: EntityResolution;
  /** Yalnizca TEK eslesme varsa dolu. */
  profile: EntityProfile | null;
  signals: Signal[];
  /** Modele verilen gercek satirlari; arayuzde de gosteriliyor. */
  facts: string[];
  advice: Advice | null;
  sorgular: { profil: string; akran: string } | null;
  sureMs: number;
}

/**
 * Profil sorgularini calistirir. Ad ZATEN cozulmus olmali: buraya gelen
 * deger veritabanindan okundu, modelin yazdigi hali degil.
 */
export async function runEntityProfile(
  tablo: Tablo, entity: string, range: TimeRange, izId: string
): Promise<{
  profile: EntityProfile | null;
  sorgular: { profil: string; akran: string };
} | null> {
  const k = pickAnalysisColumns(tablo);
  if (!k) return null;

  const baglam = { izId, provaMi: false };
  const profilSql = buildEntityProfileQuery(k, entity, range, sqlLiteral);
  const akranSql = buildPeerQuery(k, entity, range, sqlLiteral);

  const [p, a] = await Promise.all([
    veriSorgulaAraci.calistir({ sorgu: profilSql }, baglam),
    veriSorgulaAraci.calistir({ sorgu: akranSql }, baglam),
  ]);

  return {
    profile: readEntityProfile(
      entity, k.tablo, range, p.kolonlar, p.satirlar,
      readPeerPosition(a.kolonlar, a.satirlar)
    ),
    sorgular: { profil: p.calisanSql, akran: a.calisanSql },
  };
}

export async function runEntityInsight(
  saglayici: Saglayici,
  tablo: Tablo,
  parca: string,
  range: TimeRange,
  izId: string
): Promise<EntityInsight | null> {
  const t0 = Date.now();

  const resolution = await resolveEntity(tablo, parca, izId);
  if (!resolution) return null;

  const bos = (): EntityInsight => ({
    resolution, profile: null, signals: [], facts: [],
    advice: null, sorgular: null, sureMs: Date.now() - t0,
  });

  // Sifir ya da belirsiz eslesme: kart yine gosterilir ama SAYISIZ.
  // Kullanici ya adi duzeltir ya da eslesmelerden birini secer.
  const tek = pickSingleMatch(resolution);
  if (!tek) return bos();

  const olcum = await runEntityProfile(tablo, tek.value, range, izId);
  if (!olcum?.profile) return bos();

  const signals = deriveSignals(olcum.profile);
  return {
    resolution,
    profile: olcum.profile,
    signals,
    facts: factLines(olcum.profile, signals),
    advice: await buildAdvice(saglayici, olcum.profile, signals),
    sorgular: olcum.sorgular,
    sureMs: Date.now() - t0,
  };
}
