/**
 * F1 CLI: arac kaydini ve DB okuma aracini komut satirindan surer.
 *
 *   npm run cli -- liste
 *   npm run cli -- sema veri_sorgula
 *   npm run cli -- calistir veri_sorgula "{\"sorgu\":\"SELECT 1 AS x\"}"
 *   npm run cli -- calistir veri_sorgula "{...}" --prova
 */
import { baglamOlustur, sistemKur } from "../core/kur.js";

const RENK = { sonuc: "[32m", hata: "[31m", soluk: "[90m", bitir: "[0m" };

function yardim(): void {
  console.log(`Kullanim:
  liste                       Kayitli araclari listeler
  sema <arac>                 Aracin girdi semasini (JSON Schema) gosterir
  calistir <arac> <json>      Araci calistirir. --prova ile gercekten calismaz.`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const provaMi = argv.includes("--prova");
  const [komut, ...kalan] = argv.filter((a) => a !== "--prova");

  if (!komut || komut === "yardim") { yardim(); return 0; }

  const sistem = await sistemKur();
  try {
    if (komut === "liste") {
      const araclar = sistem.kayit.liste();
      if (!araclar.length) { console.log("Kayitli arac yok."); return 0; }
      for (const a of araclar) {
        const etiket = a.yanEtki === "yazma" ? `${RENK.hata}[yazma]${RENK.bitir}` : `${RENK.sonuc}[okuma]${RENK.bitir}`;
        console.log(`${a.ad}  ${etiket} ${RENK.soluk}(${a.kaynak})${RENK.bitir}`);
        console.log(`  ${a.aciklama}`);
      }
      console.log(`${RENK.soluk}${araclar.length} arac${RENK.bitir}`);
      return 0;
    }

    if (komut === "sema") {
      const ad = kalan[0];
      if (!ad) { console.error("Arac adi gerekli."); return 2; }
      const semalar = sistem.kayit.anthropicSemalari().filter((s) => s.name === ad);
      if (!semalar.length) { console.error(`Boyle bir arac yok: ${ad}`); return 2; }
      console.log(JSON.stringify(semalar[0], null, 2));
      return 0;
    }

    if (komut === "calistir") {
      const [ad, hamJson] = kalan;
      if (!ad) { console.error("Arac adi gerekli."); return 2; }
      let girdi: unknown = {};
      if (hamJson) {
        try { girdi = JSON.parse(hamJson); }
        catch { console.error("Girdi gecerli JSON degil."); return 2; }
      }

      const sonuc = await sistem.kayit.calistir(ad, girdi, baglamOlustur(provaMi));
      if (!sonuc.ok) {
        console.error(`${RENK.hata}HATA [${sonuc.kod}]${RENK.bitir} ${sonuc.hata}`);
        return 1;
      }
      console.log(JSON.stringify(sonuc.deger, null, 2));
      console.log(`${RENK.soluk}${sonuc.sureMs} ms${provaMi ? " (prova)" : ""}${RENK.bitir}`);
      return 0;
    }

    console.error(`Bilinmeyen komut: ${komut}`);
    yardim();
    return 2;
  } finally {
    await sistem.kapat();
  }
}

main().then((k) => process.exit(k)).catch((e) => {
  console.error(`${RENK.hata}Beklenmeyen hata:${RENK.bitir}`, e instanceof Error ? e.message : e);
  process.exit(1);
});
