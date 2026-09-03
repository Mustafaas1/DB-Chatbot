"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Diagnosis } from "@/core/pipeline/teshis";
import type { AgacYaniti } from "./HedefAgaci";
import type { CalisanOlcum, OlcumHatasi, OlcumSonucu } from "./AjanSekmeleri";
import type { Plan } from "./Planlar";
import type { StreamEvent, ResumeInfo } from "@/core/pipeline/olaylar";
import type { ListSummary } from "@/core/pipeline/ozet";
import type { CauseAnalysis } from "@/core/pipeline/nedenAnaliziCalistir";
import type { EntityInsight } from "@/core/pipeline/varlikCalistir";
import type { BudgetState } from "@/core/butce/butce";
import { agIstegi, hataMesaji } from "./istek";
import { belirteciTopla } from "./belirtec";

/**
 * SSE akisinin butun durumu, TEK yerde.
 *
 * Onceden hepsi `page.tsx` icindeydi. Widget de ayni akisi gosterecegi
 * icin iki kopya olusacakti; bu projede ayni sinif hata (F6'da onceki ve
 * sonraki olcumun iki ayri kod yolundan gecmesi) bir kez yasandi ve
 * duzeltmesi ikisini tek yolda birlestirmek olmustu.
 *
 * Kanca YALNIZCA durum tutar; nasil gorunecegine karisan hicbir sey yok.
 */

export interface Niyet {
  metrik: string;
  zamanAraligi: string;
  segment: string;
  varlik: string;
  ortukHedef: string;
  tur: string;
}

export interface DogrudanCevapDurumu {
  sonuc: OlcumSonucu;
  ozet: ListSummary;
  kaynak: "kod" | "ajan";
  tablo: string | null;
  zamanAraligi: string;
  adaylar: string[];
}

export interface ButceDurumu {
  durum: BudgetState;
  kalan: number;
  devam: ResumeInfo | null;
}

export interface AkisDurumu {
  soru: string;
  calisiyor: boolean;
  /** Su an hangi asamada oldugunu anlatan kisa metin. */
  asama: string;
  hata: string;
  niyet: Niyet | null;
  agac: AgacYaniti | null;
  sonuclar: OlcumSonucu[];
  calisanlar: CalisanOlcum[];
  hatalar: OlcumHatasi[];
  atlananlar: { baslik: string; sebep: string }[];
  gecersizler: { baslik: string; soru: string; sebepler: string[] }[];
  planlar: Plan[];
  teshisler: Diagnosis[];
  dogrudan: DogrudanCevapDurumu | null;
  varlik: { icgoru: EntityInsight; zamanAraligi: string } | null;
  eksikBoyut: { segment: string; sebep: string } | null;
  analiz: CauseAnalysis | null;
  butce: ButceDurumu | null;
  /** Hic soru sorulmus mu; bos ekrani ayirt etmek icin. */
  basladiMi: boolean;
}

export interface Akis extends AkisDurumu {
  sor: (metin: string, devamGovdesi?: unknown) => Promise<void>;
  butceyiKapat: () => void;
  sifirla: () => void;
}

export function useAkis(): Akis {
  const [soru, setSoru] = useState("");
  const [calisiyor, setCalisiyor] = useState(false);
  const [asama, setAsama] = useState("");
  const [hata, setHata] = useState("");
  const [niyet, setNiyet] = useState<Niyet | null>(null);
  const [agac, setAgac] = useState<AgacYaniti | null>(null);
  const [sonuclar, setSonuclar] = useState<OlcumSonucu[]>([]);
  const [calisanlar, setCalisanlar] = useState<CalisanOlcum[]>([]);
  const [hatalar, setHatalar] = useState<OlcumHatasi[]>([]);
  const [atlananlar, setAtlananlar] = useState<{ baslik: string; sebep: string }[]>([]);
  const [gecersizler, setGecersizler] =
    useState<{ baslik: string; soru: string; sebepler: string[] }[]>([]);
  const [planlar, setPlanlar] = useState<Plan[]>([]);
  const [teshisler, setTeshisler] = useState<Diagnosis[]>([]);
  const [dogrudan, setDogrudan] = useState<DogrudanCevapDurumu | null>(null);
  const [varlik, setVarlik] =
    useState<{ icgoru: EntityInsight; zamanAraligi: string } | null>(null);
  const [eksikBoyut, setEksikBoyut] =
    useState<{ segment: string; sebep: string } | null>(null);
  const [analiz, setAnaliz] = useState<CauseAnalysis | null>(null);
  const [butce, setButce] = useState<ButceDurumu | null>(null);
  const [basladiMi, setBasladiMi] = useState(false);

  // `calisiyor`u kapali devrede okumak icin: `sor` bir kez kuruluyor ve
  // bagimliliga eklemek her calismada yeni fonksiyon uretirdi.
  const calisiyorRef = useRef(false);

  // Tek basina sayfada belirtec adres parcasindan gelir (#token=...).
  // Widget yolunda bunu `widget/kabuk.ts` host'tan aliyor.
  useEffect(() => { belirteciTopla(); }, []);

  const sifirla = useCallback(() => {
    setAgac(null); setSonuclar([]); setCalisanlar([]); setHatalar([]);
    setAtlananlar([]); setGecersizler([]);
    setNiyet(null); setTeshisler([]); setPlanlar([]);
    setDogrudan(null); setEksikBoyut(null); setAnaliz(null); setVarlik(null);
  }, []);

  const isle = useCallback((k: StreamEvent) => {
    switch (k.tur) {
      case "niyet":
        setNiyet(k.niyet);
        setAsama("Hedef ağacı kuruluyor…");
        break;
      case "teshis":
        setTeshisler((o) => [...o, k.teshis]);
        break;
      case "planlar":
        setPlanlar((o) => [...o, ...k.planlar]);
        break;
      case "agac":
        setAgac(k.agac);
        setAsama("Ölçümler ajanlara dağıtılıyor…");
        break;
      case "plan":
        setAsama(`${k.atamalar.length} ölçüm bulundu`);
        break;
      case "basladi":
        setCalisanlar((o) => [...o, k]);
        setAsama(`${k.ajanAd} çalışıyor…`);
        break;
      // "bitti" iki olayda da var: olcum sonucu olan ve akisin sonu.
      // `sonuc` alaninin VARLIGI ikisini ayiriyor.
      case "bitti":
        if ("sonuc" in k) setSonuclar((o) => [...o, k.sonuc]);
        else setAsama("");
        break;
      // "hata" da iki bicimde: olcume ait olan `dugumId` tasiyor.
      case "hata":
        if ("dugumId" in k) setHatalar((o) => [...o, k]);
        else setHata(k.mesaj);
        break;
      case "atlandi":
        setAtlananlar((o) => [...o, { baslik: k.baslik, sebep: k.sebep }]);
        break;
      case "gecersiz":
        setGecersizler((o) => [
          ...o, { baslik: k.baslik, soru: k.soru, sebepler: k.sebepler },
        ]);
        break;
      case "butce":
        // Kendiliginden devam ETMIYORUZ; karar kullanicinin.
        setButce({ durum: k.durum, kalan: k.kalan, devam: k.devam });
        setAsama("");
        break;
      case "dogrudanCevap":
        setDogrudan({
          sonuc: k.sonuc, ozet: k.ozet, kaynak: k.kaynak,
          tablo: k.tablo, zamanAraligi: k.zamanAraligi, adaylar: k.adaylar,
        });
        break;
      case "varlik":
        setVarlik({ icgoru: k.icgoru, zamanAraligi: k.zamanAraligi });
        break;
      case "nedenAnalizi":
        setAnaliz(k.analiz);
        break;
      case "eksikBoyut":
        setEksikBoyut({ segment: k.segment, sebep: k.sebep });
        break;
      case "devam":
        setAsama(`${k.olculen} ölçüm atlandı; kalanlar çalışıyor…`);
        break;
    }
  }, []);

  const sor = useCallback(async (metin: string, devamGovdesi?: unknown) => {
    const s = metin.trim();
    if (!s || calisiyorRef.current) return;
    calisiyorRef.current = true;

    setCalisiyor(true); setSoru(s); setHata(""); setButce(null); setBasladiMi(true);
    // Devam turunda birikmis sonuclar KORUNUR: kullanici zaten harcanmis
    // butceyle elde edilmis olcumleri kaybetmemeli.
    if (!devamGovdesi) sifirla();
    setAsama("Soru analiz ediliyor…");

    try {
      const r = await agIstegi("/api/akis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          devamGovdesi ? { soru: s, devam: devamGovdesi } : { soru: s }
        ),
      });
      // 401 "İstek başarısız" diye gösterilirse kullanıcı ağ hatası sanır;
      // oysa sunucuya ulaşıldı ve belirteç reddedildi. Çözümü de farklı.
      if (!r.ok) { setHata(await hataMesaji(r)); return; }
      if (!r.body) { setHata("Sunucu boş yanıt döndü."); return; }

      // SSE'yi elle ayristiriyoruz: EventSource yalnizca GET destekliyor,
      // soruyu govdede gondermek gerekiyor.
      const okuyucu = r.body.getReader();
      const cozucu = new TextDecoder();
      let tampon = "";

      for (;;) {
        const { done, value } = await okuyucu.read();
        if (done) break;
        tampon += cozucu.decode(value, { stream: true });

        const parcalar = tampon.split("\n\n");
        tampon = parcalar.pop() ?? "";
        for (const p of parcalar) {
          const satir = p.trim();
          if (!satir.startsWith("data:")) continue;
          isle(JSON.parse(satir.slice(5).trim()) as StreamEvent);
        }
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Sunucuya ulaşılamadı.");
    } finally {
      calisiyorRef.current = false;
      setCalisiyor(false); setAsama("");
    }
  }, [isle, sifirla]);

  return {
    soru, calisiyor, asama, hata, niyet, agac, sonuclar, calisanlar, hatalar,
    atlananlar, gecersizler, planlar, teshisler, dogrudan, varlik, eksikBoyut,
    analiz, butce, basladiMi,
    sor,
    butceyiKapat: useCallback(() => setButce(null), []),
    sifirla,
  };
}
