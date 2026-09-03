import { semaGetir, semaMetni } from "../db/sema";
import { kapsamSec } from "../db/kapsam";
import { degerlerMetni, durumDegerleri } from "../db/degerler";
import { INJECTION_RULE } from "../guvenlik/enjeksiyon";

/**
 * Sistem istemi.
 *
 * Python surumunun dersi: bu modelde DUZYAZI KURALLAR ZAYIF TUTUYOR.
 * Belirleyici olmasi gereken seyler koda alinmali, istemde kalanlar da
 * kisa ve somut ornekli olmali. Uzun nasihat listesi ise yaramiyor.
 */
export async function sistemIstemi(
  soru: string,
  /** Bolum ajaninin kapsami. Verilirse soruya gore secim yapilmaz. */
  sadeceTablolar?: readonly string[],
  /** Ajanin kimligi. Tanimlarda yaziyor ama kullanilmazsa sus olurdu. */
  rolPromptu?: string
): Promise<string> {
  const tablolar = await semaGetir();
  // Tum semayi gondermek Groq ucretsiz katmaninin 8.000 TPM sinirini tek
  // soruda asiyordu. Soruya gore daraltiyoruz; tum tablo ADLARI yine de
  // veriliyor ki model neyin var oldugunu bilsin.
  const tumAdlar = tablolar.map((t) => t.ad);
  const secilen = sadeceTablolar?.length
    ? tablolar.filter((t) => sadeceTablolar.includes(t.ad))
    : kapsamSec(soru, tablolar).secilen;
  // Durum degerleri VERITABANINDAN okunur; elle yazilirsa (Tamamlandi gibi)
  // model birebir kopyalayip yanlis filtre kuruyor.
  const degerler = degerlerMetni(await durumDegerleri(tablolar));
  const sema = semaMetni(tablolar, new Set(secilen.map((t) => t.ad)));

  return [
    rolPromptu?.trim() || "Turkce bir veri asistanisin. Kullanicilar SQL bilmez.",
    "",
    // Bu kural en uste: veriden gelen talimat taklidi her seyden once
    // reddedilmeli.
    INJECTION_RULE,
    "",
    "CALISMA",
    "- Veri gerektiren sorularda veri_sorgula aracini kullan; yalnizca aracin",
    "  dondurdugu gercek veriye dayan, veri uydurma.",
    "- Her cagrida YALNIZCA TEK SELECT gonder. Iki sorgu gerekiyorsa araci iki kez cagir.",
    "- Hata donerse hatayi oku, sorguyu duzelt, tekrar dene.",
    "- Sonucu kisa ve sade Turkce ozetle; rakamlari tek tek sayma.",
    "",
    "SQL KURALLARI (T-SQL)",
    "- LIMIT yok: TOP kullan.",
    "- Turkce metin karsilastirmasinda N onekini kullan: Asama = N'Beklemede'",
    "- Silinmis kayitlar: neredeyse tum tablolarda IsDeleted var. Aksi",
    "  istenmedikce her sorguya IsDeleted = 0 kosulunu ekle.",
    "- Para birimi kolonu (ParaBirimi) varsa tutarlari ASLA tek toplamda",
    "  birlestirme; birim bazinda grupla.",
    "- Kolonlara Turkce takma ad ver.",
    "  DOGRU : SELECT COUNT(*) AS [Bilet Sayisi]",
    "  YANLIS: SELECT COUNT(*) AS BiletSayisi",
    "",
    "GRUPLAMA (bu modelde en sik yapilan hata)",
    "- Soruda '...-e gore' geciyorsa GROUP BY kullan, satir listeleme.",
    "  Soru  : Asamalarina gore acik destek biletleri",
    "  DOGRU : SELECT Asama AS [Asama], COUNT(*) AS [Bilet Sayisi]",
    "          FROM dbo.TicketRecords",
    "          WHERE IsDeleted = 0 AND Asama <> N'Tamamlandı'",
    "          GROUP BY Asama",
    "  YANLIS: SELECT TOP 10 BiletNo, Baslik, Asama FROM dbo.TicketRecords",
    "- Listeleme yalnizca 'listele', 'getir', 'en cok ... 10' gibi",
    "  aciklikla satir istenen sorularda yapilir.",
    "",
    "DURUM DEGERLERI (veritabanindan okundu; baskasini UYDURMA)",
    degerler,
    "- Turkce karakterleri AYNEN yaz. Yanlis yazim sessizce BOS sonuc verir.",
    "- 'Acik' bilet demek: Asama <> N'Tamamlandı'",
    "- Tarih kolonlari datetime2; gun bazinda karsilastirirken CAST(... AS date) kullan.",
    "",
    "--- TUM TABLOLAR ---",
    tumAdlar.join(", "),
    "",
    "--- SORUYLA ILGILI TABLOLARIN AYRINTISI ---",
    sema,
    "",
    "Yukaridaki listede olup ayrintisi verilmeyen bir tabloya ihtiyacin",
    "olursa yine sorgulayabilirsin; kolon adlarini tahmin etme, once",
    "SELECT TOP 1 * ile bak.",
    "",
    "Bugunun tarihi: " + new Date().toISOString().slice(0, 10),
  ].join("\n");
}
