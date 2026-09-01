import sql from "mssql";
import { z } from "zod";
import { havuzGetir } from "../db/havuz";
import { yazmaHavuzuGetir } from "./havuzYaz";
import type { IslemTanimi, Prova } from "./tipler";

/**
 * BEYAZ LISTE.
 *
 * Buraya eklenmemis hicbir yazma yapilamaz. Her islem tipli parametre alir;
 * LLM yalnizca parametre onerir, SQL yazmaz.
 */

const AZAMI_ETKI = 50;

const BiletAtaP = z.object({
  biletNo: z.string().min(1).max(40).describe("Atanacak biletin numarasi"),
  kisi: z.string().min(1).max(120).describe("Atanacak kisinin adi"),
});
type BiletAtaP = z.infer<typeof BiletAtaP>;

const BiletAsamaP = z.object({
  biletNo: z.string().min(1).max(40),
  asama: z.enum(["Beklemede", "İşlemde", "Tamamlandı"])
    .describe("Yeni asama. Veritabanindaki gercek degerler."),
});
type BiletAsamaP = z.infer<typeof BiletAsamaP>;

interface BiletDurumu { biletNo: string; alan: string; onceki: string | null; }

/** Biletin bir alanini okur; prova ve geri alma bunu kullanir. */
async function biletAlaniOku(biletNo: string, alan: "AtananKisi" | "Asama"):
  Promise<{ bulundu: boolean; deger: string | null; baslik: string }> {
  // OKUMA havuzu: prova hicbir sey degistirmez, bu yuzden yazma
  // yapilandirilmamis olsa bile calisabilmeli. Yazma havuzunu kullanmak
  // provayi gereksiz yere yazma yetkisine bagliyordu.
  const havuz = await havuzGetir();
  const y = await havuz.request()
    .input("biletNo", sql.NVarChar(40), biletNo)
    .query(`SELECT TOP 2 ${alan} AS deger, Baslik FROM dbo.TicketRecords
            WHERE BiletNo = @biletNo AND IsDeleted = 0`);
  const r = y.recordset[0] as { deger: string | null; Baslik: string } | undefined;
  return { bulundu: !!r, deger: r?.deger ?? null, baslik: r?.Baslik ?? "" };
}

function provaYap(
  bulundu: boolean, biletNo: string, baslik: string, alan: string,
  onceki: string | null, sonraki: string, etiket: string
): Prova {
  if (!bulundu) {
    return {
      ozet: `${biletNo} numarali bilet bulunamadi.`,
      etkilenen: 0, degisiklikler: [],
      uyarilar: ["Bilet yok ya da silinmis; islem uygulanmayacak."],
    };
  }
  const oncekiMetin = onceki ?? "(bos)";
  if (oncekiMetin === sonraki) {
    return {
      ozet: `${biletNo} zaten "${sonraki}" durumunda.`,
      etkilenen: 0, degisiklikler: [],
      uyarilar: ["Deger degismiyor; islem gereksiz."],
    };
  }
  return {
    ozet: `${biletNo} (${baslik}) biletinin ${etiket} "${oncekiMetin}" -> "${sonraki}"`,
    etkilenen: 1,
    degisiklikler: [{ kimlik: biletNo, alan, onceki: oncekiMetin, sonraki }],
    uyarilar: [],
  };
}

async function biletAlaniYaz(
  biletNo: string, alan: "AtananKisi" | "Asama", deger: string
): Promise<number> {
  const havuz = await yazmaHavuzuGetir();
  // SAKLI YORDAM uzerinden: ajan_yazar'in tabloya dogrudan yazma yetkisi
  // YOKTUR, yalnizca bu yordamlara EXECUTE yetkisi vardir.
  const yordam = alan === "AtananKisi" ? "dbo.sp_ajan_bilet_ata" : "dbo.sp_ajan_bilet_asama";
  const y = await havuz.request()
    .input("BiletNo", sql.NVarChar(40), biletNo)
    .input("Deger", sql.NVarChar(120), deger)
    .execute(yordam);
  const r = y.recordset?.[0] as { Etkilenen?: number } | undefined;
  return r?.Etkilenen ?? 0;
}

export const biletAta: IslemTanimi<BiletAtaP> = {
  kod: "bilet_ata",
  ad: "Bileti kişiye ata",
  aciklama: "Bir destek biletinin atanan kişisini değiştirir.",
  // Tek alan, geri alinabilir, tek kayit: dusuk risk.
  risk: "low",
  hedefTablo: "TicketRecords",
  parametreSemasi: BiletAtaP,

  async prova(p) {
    const { bulundu, deger, baslik } = await biletAlaniOku(p.biletNo, "AtananKisi");
    return provaYap(bulundu, p.biletNo, baslik, "AtananKisi", deger, p.kisi, "atanan kisisi");
  },

  async uygula(p) {
    const { deger } = await biletAlaniOku(p.biletNo, "AtananKisi");
    const etkilenen = await biletAlaniYaz(p.biletNo, "AtananKisi", p.kisi);
    const onceki: BiletDurumu = { biletNo: p.biletNo, alan: "AtananKisi", onceki: deger };
    return { etkilenen, oncekiDurum: onceki };
  },

  async geriAl(oncekiDurum) {
    const d = oncekiDurum as BiletDurumu;
    const etkilenen = await biletAlaniYaz(d.biletNo, "AtananKisi", d.onceki ?? "");
    return { etkilenen };
  },
};

export const biletAsamaDegistir: IslemTanimi<BiletAsamaP> = {
  kod: "bilet_asama_degistir",
  ad: "Bilet aşamasını değiştir",
  aciklama: "Bir destek biletinin aşamasını değiştirir (Beklemede / İşlemde / Tamamlandı).",
  // Asama degisimi is akisini etkiliyor (SLA, raporlama): orta risk.
  risk: "medium",
  hedefTablo: "TicketRecords",
  parametreSemasi: BiletAsamaP,

  async prova(p) {
    const { bulundu, deger, baslik } = await biletAlaniOku(p.biletNo, "Asama");
    return provaYap(bulundu, p.biletNo, baslik, "Asama", deger, p.asama, "aşaması");
  },

  async uygula(p) {
    const { deger } = await biletAlaniOku(p.biletNo, "Asama");
    const etkilenen = await biletAlaniYaz(p.biletNo, "Asama", p.asama);
    const onceki: BiletDurumu = { biletNo: p.biletNo, alan: "Asama", onceki: deger };
    return { etkilenen, oncekiDurum: onceki };
  },

  async geriAl(oncekiDurum) {
    const d = oncekiDurum as BiletDurumu;
    if (!d.onceki) throw new Error("Onceki asama bilinmiyor; geri alinamaz.");
    const etkilenen = await biletAlaniYaz(d.biletNo, "Asama", d.onceki);
    return { etkilenen };
  },
};

export const ISLEMLER: readonly IslemTanimi<any>[] = [biletAta, biletAsamaDegistir];

export function islemBul(kod: string): IslemTanimi<any> | undefined {
  return ISLEMLER.find((i) => i.kod === kod);
}

export { AZAMI_ETKI };
