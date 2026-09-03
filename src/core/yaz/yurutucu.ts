import * as denetim from "./denetim";
import { AZAMI_ETKI, islemBul } from "./islemler";
import { yazmaAcikMi } from "./havuzYaz";
import type { DenetimKaydi, Prova } from "./tipler";
import * as gbDepo from "../geribesleme/depo";
import { olcumuTekrarla } from "../geribesleme/olcumTekrar";
import {
  currentMode, canRunAutomatically, autoApprover, type AutonomyMode,
} from "../otonomi/mod";
import type { OlcumBaglami } from "../geribesleme/tipler";

/**
 * Yazma yurutucusu.
 *
 * Akis: oner (prova) -> INSAN ONAYI -> uygula -> (gerekirse) geri al
 * Her adim denetim kaydina yazilir; reddedilenler ve basarisizlar dahil.
 */

export class OnayHatasi extends Error {
  constructor(mesaj: string) { super(mesaj); this.name = "OnayHatasi"; }
}

export interface Oneri {
  kayitId: string;
  islemKodu: string;
  islemAdi: string;
  hedefTablo: string;
  prova: Prova;
  /** Prova 0 kayit etkiliyorsa onaya sunulmaz. */
  onaylanabilir: boolean;
  /** Yazma yapilandirilmamissa true: yalnizca prova gorulebilir. */
  yalnizcaProva: boolean;
}

/**
 * Islemi ONERIR: parametreleri dogrular, provayi calistirir, denetime yazar.
 * HICBIR SEY DEGISTIRMEZ.
 */
export async function oner(
  islemKodu: string,
  hamParametreler: unknown,
  /**
   * Bu islemin hangi olcumden dogdugu. F6 geri beslemesi bu sorgulari
   * yeniden calistirip once/sonra karsilastirmasi yapar. Verilmezse
   * geri besleme calisamaz (olcum baglami bulunamadi der).
   */
  olcumBaglamlari?: OlcumBaglami[]
): Promise<Oneri> {
  const islem = islemBul(islemKodu);
  if (!islem) throw new OnayHatasi(`Tanimsiz islem: ${islemKodu}. Beyaz listede yok.`);

  const dogrulama = islem.parametreSemasi.safeParse(hamParametreler);
  if (!dogrulama.success) {
    const ayrinti = dogrulama.error.issues
      .map((i) => `${i.path.join(".") || "(kok)"}: ${i.message}`).join("; ");
    throw new OnayHatasi(`Gecersiz parametre: ${ayrinti}`);
  }

  const prova = await islem.prova(dogrulama.data);
  if (prova.etkilenen > AZAMI_ETKI) {
    prova.uyarilar.push(
      `${prova.etkilenen} kayit etkileniyor; tek islemde en fazla ${AZAMI_ETKI} kayda izin var.`
    );
  }

  const kayitId = denetim.oneriKaydet(
    islem.kod, islem.ad, islem.hedefTablo, dogrulama.data, prova
  );

  // Olcum baglamlari ONERI aninda saklanir: plan hangi olcumden dogduysa
  // etkisi de o olcumle olculmeli.
  for (const b of olcumBaglamlari ?? []) {
    try { gbDepo.baglamKaydet(kayitId, b); }
    catch { /* baglam kaydedilemezse islem yine de onerilebilir */ }
  }

  return {
    kayitId,
    islemKodu: islem.kod,
    islemAdi: islem.ad,
    hedefTablo: islem.hedefTablo,
    prova,
    onaylanabilir: prova.etkilenen > 0 && prova.etkilenen <= AZAMI_ETKI,
    yalnizcaProva: !yazmaAcikMi(),
  };
}

/**
 * Onaylanan islemi uygular.
 *
 * `onaylayan` ZORUNLU: sistem kendi kendini onaylayamaz. Bu alan bos
 * gecilemesin diye tip degil calisma zamani kontrolu de var -- onay
 * kapisi sessizce atlanabilecek bir sey olmamali.
 */
export async function uygula(kayitId: string, onaylayan: string): Promise<DenetimKaydi> {
  if (!onaylayan?.trim()) {
    throw new OnayHatasi("Onaylayan belirtilmeden islem uygulanamaz.");
  }

  const kayit = denetim.getir(kayitId);
  if (!kayit) throw new OnayHatasi(`Kayit bulunamadi: ${kayitId}`);
  if (kayit.durum !== "oneri") {
    throw new OnayHatasi(`Bu kayit "${kayit.durum}" durumunda; yalnizca "oneri" uygulanabilir.`);
  }
  if (!kayit.prova || kayit.prova.etkilenen === 0) {
    throw new OnayHatasi("Prova hicbir kaydi etkilemiyor; uygulanmasi anlamsiz.");
  }
  if (kayit.prova.etkilenen > AZAMI_ETKI) {
    throw new OnayHatasi(`Etkilenen kayit sayisi siniri asiyor (${kayit.prova.etkilenen} > ${AZAMI_ETKI}).`);
  }

  const islem = islemBul(kayit.islemKodu);
  if (!islem) throw new OnayHatasi(`Tanimsiz islem: ${kayit.islemKodu}`);

  denetim.durumGuncelle(kayitId, "onaylandi", { onaylayan });

  // "ONCE" goruntusu YAZMADAN HEMEN ONCE alinir. Geri besleme boylece
  // gercek bir once/sonra karsilastirmasi yapabilir; yoksa yalnizca
  // uygulamadan SONRAKI durumu olcup "referans yok" demek zorunda kaliyor.
  //
  // Oneri aninda almak yaniltici olurdu: oneri ile onay arasinda dakikalar
  // gecebilir ve o aralikta olan degisim bu isleme yazilirdi.
  await oncekiGoruntuleriAl(kayitId);

  try {
    const { oncekiDurum } = await islem.uygula(kayit.parametreler);
    denetim.durumGuncelle(kayitId, "uygulandi", { onaylayan, oncekiDurum });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    denetim.durumGuncelle(kayitId, "basarisiz", { onaylayan, hata: mesaj });
    throw e;
  }

  return denetim.getir(kayitId)!;
}

/**
 * Otonomi moduna gore, INSAN ONAYI OLMADAN uygulamayi dener.
 *
 * uygula() zayiflatilmadi: bu yol da sonunda ayni fonksiyonu cagiriyor,
 * yalnizca onaylayan alanina "otomatik:<mod>" yaziyor. Boylece denetim
 * kaydinda insan onayi ile otonomi karari birbirinden ayirt edilebiliyor.
 *
 * Izin verilmezse yazma YAPILMAZ; cagiran taraf insana sormalidir.
 */
export async function otomatikUygula(
  kayitId: string,
  mod: AutonomyMode = currentMode()
): Promise<{ uygulandi: false; sebep: string } | { uygulandi: true; kayit: DenetimKaydi }> {
  const kayit = denetim.getir(kayitId);
  if (!kayit) throw new OnayHatasi(`Kayit bulunamadi: ${kayitId}`);

  const islem = islemBul(kayit.islemKodu);
  if (!islem) throw new OnayHatasi(`Tanimsiz islem: ${kayit.islemKodu}`);

  // Risk ve geri alinabilirlik ISLEM TANIMINDAN okunuyor, cagirandan degil.
  const karar = canRunAutomatically(
    { risk: islem.risk, reversible: typeof islem.geriAl === "function" },
    mod
  );
  if (!karar.automatic) return { uygulandi: false, sebep: karar.reason };

  const sonuc = await uygula(kayitId, autoApprover(mod));
  denetim.durumGuncelle(kayitId, sonuc.durum, { otonomiModu: mod });
  return { uygulandi: true, kayit: denetim.getir(kayitId)! };
}

export function reddet(kayitId: string, reddeden: string): DenetimKaydi {
  const kayit = denetim.getir(kayitId);
  if (!kayit) throw new OnayHatasi(`Kayit bulunamadi: ${kayitId}`);
  if (kayit.durum !== "oneri") {
    throw new OnayHatasi(`Bu kayit "${kayit.durum}" durumunda; reddedilemez.`);
  }
  denetim.durumGuncelle(kayitId, "reddedildi", { onaylayan: reddeden });
  return denetim.getir(kayitId)!;
}

/** Uygulanmis islemi geri alir. */
export async function geriAl(kayitId: string, geriAlan: string): Promise<DenetimKaydi> {
  if (!geriAlan?.trim()) throw new OnayHatasi("Geri alan belirtilmeli.");

  const kayit = denetim.getir(kayitId);
  if (!kayit) throw new OnayHatasi(`Kayit bulunamadi: ${kayitId}`);
  if (kayit.durum !== "uygulandi") {
    throw new OnayHatasi(`Yalnizca "uygulandi" durumundaki islem geri alinabilir (su an "${kayit.durum}").`);
  }
  if (kayit.oncekiDurum == null) {
    throw new OnayHatasi("Onceki durum kaydedilmemis; geri alinamaz.");
  }

  const islem = islemBul(kayit.islemKodu);
  if (!islem) throw new OnayHatasi(`Tanimsiz islem: ${kayit.islemKodu}`);

  try {
    await islem.geriAl(kayit.oncekiDurum);
    denetim.durumGuncelle(kayitId, "geri_alindi", { onaylayan: geriAlan });
  } catch (e) {
    const mesaj = e instanceof Error ? e.message : String(e);
    denetim.durumGuncelle(kayitId, "basarisiz", { hata: `Geri alma basarisiz: ${mesaj}` });
    throw e;
  }

  return denetim.getir(kayitId)!;
}

/**
 * Islemle iliskili olcum sorgularini calistirip "once" goruntusu kaydeder.
 *
 * Sessizce basarisiz olur: geri besleme bir ek katman, olcum alinamadi
 * diye yazma islemi engellenmemeli.
 */
async function oncekiGoruntuleriAl(kayitId: string): Promise<void> {
  let baglamlar: OlcumBaglami[] = [];
  try { baglamlar = gbDepo.baglamlariGetir(kayitId); }
  catch (e) {
    console.error("[F6] olcum baglamlari okunamadi:", e);
    return;
  }
  if (!baglamlar.length) return;

  for (const b of baglamlar) {
    try {
      // "sonra" goruntusuyle AYNI yol: ayni sorgu, ayni sekilde.
      await olcumuTekrarla(kayitId, b, "once");
    } catch (e) {
      // Tek olcum alinamazsa digerlerine devam; ama SESSIZ kalma.
      // Bu catch bir kez "once" goruntusunun hic alinmadigini gizledi.
      console.error(`[F6] "once" goruntusu alinamadi (${b.soru}):`, e);
    }
  }
}

export { denetim };
