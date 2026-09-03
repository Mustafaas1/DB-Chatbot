import type { OlcumOlayi, OlcumSonucu } from "../ajan/olcum";
import type { TreeResult } from "../hedef/tipler";
import type { GoalNodeGenis } from "../../schemas/index";
import type { Intent } from "./intent";
import type { Diagnosis } from "./teshis";
import type { PlanView } from "./plan";
import type { ListSummary } from "./ozet";
import type { CauseAnalysis } from "./nedenAnaliziCalistir";
import type { EntityInsight } from "./varlikCalistir";
import type { BudgetState } from "../butce/butce";

/**
 * SSE akisinin olay sozlesmesi.
 *
 * Tek kaynak: sunucu `yolla()` ile bunu gonderiyor, istemci ayni tiple
 * okuyor. Onceden iki taraf da `any` kullaniyordu; bir olay adi degisse
 * ya da alan eklense derleyici sessiz kaliyordu.
 *
 * Olcum olaylari (basladi/bitti/hata/atlandi/gecersiz) oldugu gibi
 * dahil: onlar zaten olcum.ts'te tipli.
 */

/** Butce dolunca istemciye verilen, devam etmeye yeten bilgi. */
export interface ResumeInfo {
  hedef: string;
  dugumler: GoalNodeGenis[];
  olculenler: string[];
}

export type StreamEvent =
  | OlcumOlayi
  | { tur: "niyet"; niyet: Intent; fellBack: boolean }
  | { tur: "agac"; agac: TreeResult }
  | { tur: "listeleyici"; dugum: GoalNodeGenis }
  | {
      tur: "dogrudanCevap";
      sonuc: OlcumSonucu;
      ozet: ListSummary;
      /** Sorguyu kim yazdi: kod mu, ajan mi. Arayuzde gosteriliyor. */
      kaynak: "kod" | "ajan";
      /** Hangi tablodan hesaplandi; ajan yolunda bilinmiyor. */
      tablo: string | null;
      /** Yeniden hesaplama icin gerekli. */
      zamanAraligi: string;
      /** Kullanicinin gecebilecegi diger tablolar, puana gore sirali. */
      adaylar: string[];
    }
  | { tur: "nedenAnalizi"; analiz: CauseAnalysis }
  /**
   * Soruda adi gecen TEK varlik hakkinda gercek karti + tavsiye.
   *
   * `profile` null olabilir: ad hic eslesmedi ya da birden fazla kayda
   * uydu. Ikisinde de kart gosterilir ama sayi gosterilmez.
   */
  | { tur: "varlik"; icgoru: EntityInsight; zamanAraligi: string }
  | { tur: "eksikBoyut"; segment: string; sebep: string }
  | { tur: "devam"; olculen: number }
  | {
      tur: "plan";
      atamalar: {
        dugumId: string; baslik: string; ajanKod: string;
        ajanAd: string; renk: string; belirsiz: boolean;
      }[];
    }
  | { tur: "teshis"; teshis: Diagnosis }
  | { tur: "planlar"; planlar: PlanView[] }
  | {
      tur: "butce";
      durum: BudgetState;
      kalan: number;
      devam: ResumeInfo | null;
    }
  /** Akisin sonu. Olcum "bitti" olayindan `sonuc` alaninin YOKLUGU ile ayrilir. */
  | { tur: "bitti"; butce: BudgetState }
  /** Genel hata; olcum hatasindan `dugumId` YOKLUGU ile ayrilir. */
  | { tur: "hata"; mesaj: string };
