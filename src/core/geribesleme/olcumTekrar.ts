import { havuzGetir } from "../db/havuz";
import * as depo from "./depo";
import type { OlcumBaglami, OlcumSnapshot } from "./tipler";

/**
 * Saklanan olcum sorgusunu AYNEN yeniden calistirip snapshot yazar.
 *
 * Neden LLM'e yeniden sordurmuyoruz: "once" goruntusu saklanan SQL'i
 * dogrudan calistiriyordu, "sonra" goruntusu ise ayni soruyu modele
 * yeniden yazdiriyordu. Model her seferinde baska bir sorgu uretebildigi
 * icin iki taraf farkli seyleri olcuyordu; bir olcumde "3 satir -> 0
 * satir" gibi tamamen yaniltici bir fark cikti.
 *
 * Ayrica ucuz: yeniden olcum artik token harcamiyor ve arac cagrisi
 * sinirina takilamiyor.
 */
export async function olcumuTekrarla(
  denetimId: string,
  baglam: OlcumBaglami,
  tur: "once" | "sonra"
): Promise<OlcumSnapshot> {
  const havuz = await havuzGetir();
  const istek = havuz.request();
  istek.arrayRowMode = true;
  const y = await istek.query(baglam.sql);

  const ust = y.recordset?.columns ?? {};
  const kolonlar = Object.values(ust)
    .sort((a, b) => a.index - b.index)
    .map((k) => k.name);
  const satirlar = (y.recordset as unknown as unknown[][]) ?? [];

  const id = depo.snapshotKaydet(
    denetimId, baglam.dugumId, baglam.ajanKod,
    baglam.soru, baglam.sql, kolonlar, satirlar, tur
  );

  return {
    id,
    denetimId,
    dugumId: baglam.dugumId,
    ajanKod: baglam.ajanKod,
    soru: baglam.soru,
    sqlSorgu: baglam.sql,
    kolonlar,
    satirlar,
    satirSayisi: satirlar.length,
    tur,
    olusturma: new Date().toISOString(),
  };
}
