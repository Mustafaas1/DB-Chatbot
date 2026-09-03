import type { Tablo } from "../db/sema";
import { veriSorgulaAraci } from "../db/aracSorgu";
import {
  pickAnalysisColumns, comparePeriods, buildPeriodQuery, deriveSegments, buildEntityQuery,
  type PeriodDelta, type Segmentation,
} from "./nedenAnalizi";
import {
  buildBreakdownQuery, buildNewVsReturningQuery, isUsefulBreakdown,
  pickBreakdownColumns, readBreakdown, readNewVsReturning,
  type Breakdown, type NewVsReturning,
} from "./kirilim";
import type { TimeRange } from "./zamanAraligi";

/**
 * Neden analizini calistirir.
 *
 * Iki sorgu, ikisi de KODDAN; model devrede degil, token harcanmiyor.
 * Sorgular yine sqlDogrula'dan geciyor.
 */

export interface CauseAnalysis {
  tablo: string;
  donem: PeriodDelta[];
  segment: Segmentation;
  /** Atif ve kategori kirilimleri; yalnizca BILGI TASIYANLAR. */
  kirilimlar: Breakdown[];
  /** Yeni mi mevcut mu; hesaplanamazsa null. */
  yeniMevcut: NewVsReturning | null;
  /** Uretilen sorgular; arayuzde gosterilip denetlenebilsin. */
  sorgular: { donem: string; varlik: string };
  sureMs: number;
}

export async function runCauseAnalysis(
  tablo: Tablo,
  izId: string,
  range: TimeRange = { kind: "relative", days: 30 }
): Promise<CauseAnalysis | null> {
  const k = pickAnalysisColumns(tablo);
  // Varlik ya da tarih kolonu yoksa donem/segment analizi anlamsiz.
  if (!k) return null;

  const t0 = Date.now();
  const baglam = { izId, provaMi: false };
  const dSql = buildPeriodQuery(k);
  const vSql = buildEntityQuery(k, range);

  // KIRILIMLAR: kanal kolonu yok, ama atif/kategori/yeni-mevcut var.
  // Hepsi TEK TABLO, join yok; sema bagimsizligini koruyor.
  const kirilimKolonlari = pickBreakdownColumns(tablo, [
    k.varlik, k.tarih, k.tutar ?? "", k.paraBirimi ?? "",
  ]);
  const kirilimIsleri = [
    ...(kirilimKolonlari.attribution
      ? [{ kolon: kirilimKolonlari.attribution, tur: "attribution" as const }]
      : []),
    ...kirilimKolonlari.categories.map((kolon) => ({ kolon, tur: "category" as const })),
  ];

  const [d, v, yeniMevcutSonuc, ...kirilimSonuclari] = await Promise.all([
    veriSorgulaAraci.calistir({ sorgu: dSql }, baglam),
    veriSorgulaAraci.calistir({ sorgu: vSql }, baglam),
    veriSorgulaAraci.calistir({ sorgu: buildNewVsReturningQuery(k, range) }, baglam),
    ...kirilimIsleri.map((i) =>
      veriSorgulaAraci.calistir({ sorgu: buildBreakdownQuery(k, i.kolon, range) }, baglam)
    ),
  ]);

  return {
    tablo: tablo.ad,
    donem: comparePeriods(d.kolonlar, d.satirlar),
    segment: deriveSegments(v.kolonlar, v.satirlar),
    // Bilgi tasimayan kirilim GOSTERILMIYOR: "%100 bos" bir dagilim degil.
    kirilimlar: kirilimIsleri
      .map((i, n) => readBreakdown(
        i.kolon, i.tur,
        kirilimSonuclari[n]!.kolonlar, kirilimSonuclari[n]!.satirlar
      ))
      .filter(isUsefulBreakdown),
    yeniMevcut: readNewVsReturning(yeniMevcutSonuc.kolonlar, yeniMevcutSonuc.satirlar),
    sorgular: { donem: d.calisanSql, varlik: v.calisanSql },
    sureMs: Date.now() - t0,
  };
}
