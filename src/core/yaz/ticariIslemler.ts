import sql from "mssql";
import { z } from "zod";
import { havuzGetir } from "../db/havuz";
import { yazmaHavuzuGetir } from "./havuzYaz";
import type { IslemTanimi, Prova } from "./tipler";

/**
 * Teklif ve fatura yazma islemleri.
 *
 * islemler.ts'teki destek bileti islemleriyle ayni sozlesme: LLM yalnizca
 * PARAMETRE onerir, SQL yazmaz; yazma saklı yordam uzerinden gider
 * (sql/f5_teklif_fatura.sql).
 *
 * Ayri dosyada: islemler.ts destek alanina ozgu yardimcilarla dolu ve
 * ikisini karistirmak her iki tarafi da okunmaz kilardi.
 */

const TeklifDurumP = z.object({
  teklifNo: z.string().min(1).max(60).describe("Teklif numarasi"),
  durum: z.enum(["Teklif", "Gönderildi", "Kazanıldı", "Kaybedildi"])
    .describe("Yeni durum. Veritabanindaki gercek degerler."),
});
type TeklifDurumP = z.infer<typeof TeklifDurumP>;

const TeklifTemsilciP = z.object({
  teklifNo: z.string().min(1).max(60).describe("Teklif numarasi"),
  temsilci: z.string().min(1).max(200).describe("Satis temsilcisinin adi"),
});
type TeklifTemsilciP = z.infer<typeof TeklifTemsilciP>;

const FaturaDurumP = z.object({
  faturaId: z.string().min(1).max(60).describe("Fatura Id (GUID)"),
  durum: z.enum(["Faturalanacak", "Kesildi"])
    .describe("Yeni durum. Veritabanindaki gercek degerler."),
});
type FaturaDurumP = z.infer<typeof FaturaDurumP>;

interface OncekiDeger { kimlik: string; alan: string; onceki: string | null; }

/** Kayit basligiyla birlikte tek alani okur; prova ve geri alma kullanir. */
async function alanOku(
  tablo: "Teklifler" | "Invoices",
  kimlikKolonu: string,
  kimlik: string,
  alan: string,
  baslikKolonu: string
): Promise<{ bulundu: boolean; deger: string | null; baslik: string }> {
  // OKUMA havuzu: prova hicbir sey degistirmiyor, yazma yapilandirilmamis
  // olsa bile gorulebilmeli.
  const havuz = await havuzGetir();
  const y = await havuz.request()
    .input("kimlik", sql.NVarChar(60), kimlik)
    .query(
      `SELECT TOP 2 ${alan} AS deger, ${baslikKolonu} AS baslik
         FROM dbo.${tablo}
        WHERE ${kimlikKolonu} = ${tablo === "Invoices" ? "TRY_CAST(@kimlik AS UNIQUEIDENTIFIER)" : "@kimlik"}
          AND IsDeleted = 0`
    );
  const r = y.recordset[0] as { deger: string | null; baslik: string | null } | undefined;
  return { bulundu: !!r, deger: r?.deger ?? null, baslik: r?.baslik ?? "" };
}

function provaYap(
  bulundu: boolean, kimlik: string, baslik: string, alan: string,
  onceki: string | null, sonraki: string, etiket: string, tur: string
): Prova {
  if (!bulundu) {
    return {
      ozet: `${kimlik} numarali ${tur} bulunamadi.`,
      etkilenen: 0, degisiklikler: [],
      uyarilar: [`${tur} yok ya da silinmis; islem uygulanmayacak.`],
    };
  }
  const oncekiMetin = onceki ?? "(bos)";
  if (oncekiMetin === sonraki) {
    return {
      ozet: `${kimlik} zaten "${sonraki}" durumunda.`,
      etkilenen: 0, degisiklikler: [],
      uyarilar: ["Deger degismiyor; islem gereksiz."],
    };
  }
  return {
    ozet: `${kimlik}${baslik ? ` (${baslik})` : ""} ${tur}nin ${etiket} "${oncekiMetin}" -> "${sonraki}"`,
    etkilenen: 1,
    degisiklikler: [{ kimlik, alan, onceki: oncekiMetin, sonraki }],
    uyarilar: [],
  };
}

async function yordamCalistir(
  yordam: string, kimlikAdi: string, kimlik: string, deger: string
): Promise<number> {
  const havuz = await yazmaHavuzuGetir();
  // ajan_yazar'in tabloya dogrudan yazma yetkisi YOK; yalnizca EXECUTE.
  const y = await havuz.request()
    .input(kimlikAdi, sql.NVarChar(60), kimlik)
    .input("Deger", sql.NVarChar(200), deger)
    .execute(yordam);
  const r = y.recordset?.[0] as { Etkilenen?: number } | undefined;
  return r?.Etkilenen ?? 0;
}

export const teklifDurumDegistir: IslemTanimi<TeklifDurumP> = {
  kod: "teklif_durum_degistir",
  ad: "Teklif durumunu değiştir",
  aciklama: "Bir teklifin durumunu değiştirir (Teklif / Gönderildi / Kazanıldı / Kaybedildi).",
  // Satis hunisini ve raporlamayi etkiliyor: orta risk.
  risk: "medium",
  hedefTablo: "Teklifler",
  kimlikParametresi: "teklifNo",
  kimlikKolonu: "TeklifNo",
  parametreSemasi: TeklifDurumP,

  async prova(p) {
    const { bulundu, deger, baslik } = await alanOku("Teklifler", "TeklifNo", p.teklifNo, "Durum", "Baslik");
    return provaYap(bulundu, p.teklifNo, baslik, "Durum", deger, p.durum, "durumu", "teklifi");
  },

  async uygula(p) {
    const { deger } = await alanOku("Teklifler", "TeklifNo", p.teklifNo, "Durum", "Baslik");
    const etkilenen = await yordamCalistir("dbo.sp_ajan_teklif_durum", "TeklifNo", p.teklifNo, p.durum);
    const onceki: OncekiDeger = { kimlik: p.teklifNo, alan: "Durum", onceki: deger };
    return { etkilenen, oncekiDurum: onceki };
  },

  async geriAl(oncekiDurum) {
    const d = oncekiDurum as OncekiDeger;
    const etkilenen = await yordamCalistir("dbo.sp_ajan_teklif_durum", "TeklifNo", d.kimlik, d.onceki ?? "");
    return { etkilenen };
  },
};

export const teklifTemsilciAta: IslemTanimi<TeklifTemsilciP> = {
  kod: "teklif_temsilci_ata",
  ad: "Teklife satış temsilcisi ata",
  aciklama: "Bir teklifin satış temsilcisini değiştirir.",
  // Tek alan, geri alinabilir, mali sonucu yok: dusuk risk.
  risk: "low",
  hedefTablo: "Teklifler",
  kimlikParametresi: "teklifNo",
  kimlikKolonu: "TeklifNo",
  kisiParametresi: "temsilci",
  parametreSemasi: TeklifTemsilciP,

  async prova(p) {
    const { bulundu, deger, baslik } = await alanOku("Teklifler", "TeklifNo", p.teklifNo, "SatisTemsilcisi", "Baslik");
    return provaYap(bulundu, p.teklifNo, baslik, "SatisTemsilcisi", deger, p.temsilci, "satis temsilcisi", "teklifi");
  },

  async uygula(p) {
    const { deger } = await alanOku("Teklifler", "TeklifNo", p.teklifNo, "SatisTemsilcisi", "Baslik");
    const etkilenen = await yordamCalistir("dbo.sp_ajan_teklif_temsilci", "TeklifNo", p.teklifNo, p.temsilci);
    const onceki: OncekiDeger = { kimlik: p.teklifNo, alan: "SatisTemsilcisi", onceki: deger };
    return { etkilenen, oncekiDurum: onceki };
  },

  async geriAl(oncekiDurum) {
    const d = oncekiDurum as OncekiDeger;
    const etkilenen = await yordamCalistir("dbo.sp_ajan_teklif_temsilci", "TeklifNo", d.kimlik, d.onceki ?? "");
    return { etkilenen };
  },
};

export const faturaDurumDegistir: IslemTanimi<FaturaDurumP> = {
  kod: "fatura_durum_degistir",
  ad: "Fatura durumunu değiştir",
  aciklama: "Bir faturanın durumunu değiştirir (Faturalanacak / Kesildi).",
  // MALI olay: faturayi "Kesildi" yapmak muhasebeye yansir. YUKSEK risk,
  // yani hicbir otonomi modunda onaysiz calismaz.
  risk: "high",
  hedefTablo: "Invoices",
  kimlikParametresi: "faturaId",
  kimlikKolonu: "Id",
  parametreSemasi: FaturaDurumP,

  async prova(p) {
    const { bulundu, deger, baslik } = await alanOku("Invoices", "Id", p.faturaId, "Durum", "MusteriAdi");
    return provaYap(bulundu, p.faturaId, baslik, "Durum", deger, p.durum, "durumu", "faturasi");
  },

  async uygula(p) {
    const { deger } = await alanOku("Invoices", "Id", p.faturaId, "Durum", "MusteriAdi");
    const etkilenen = await yordamCalistir("dbo.sp_ajan_fatura_durum", "FaturaId", p.faturaId, p.durum);
    const onceki: OncekiDeger = { kimlik: p.faturaId, alan: "Durum", onceki: deger };
    return { etkilenen, oncekiDurum: onceki };
  },

  async geriAl(oncekiDurum) {
    const d = oncekiDurum as OncekiDeger;
    const etkilenen = await yordamCalistir("dbo.sp_ajan_fatura_durum", "FaturaId", d.kimlik, d.onceki ?? "");
    return { etkilenen };
  },
};
