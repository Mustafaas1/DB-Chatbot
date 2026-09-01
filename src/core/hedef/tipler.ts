import type { Agac, GoalNodeGenis } from "../../schemas/index";
import { derinlikSirasi, kokDugum, olcumDugumleri } from "../../schemas/index";

/**
 * Hedef agaci tipleri.
 *
 * Agac artik DUZ: kanonik GoalNode semasi (spec bolum 5) children'i id
 * listesi olarak tutuyor. Ic ice nesne yapisi birakildi cunku ayni dugume
 * iki yerden atif yapilamiyor ve kismi guncelleme butun agaci dolasmayi
 * gerektiriyordu.
 */

export type { Agac, GoalNodeGenis };
export { derinlikSirasi, kokDugum, olcumDugumleri };

export interface Bulgu {
  ozet: string;
  kolonlar?: string[];
  satirlar?: unknown[][];
  sql?: string;
}

export interface AgacKullanimi {
  girdiTokeni: number;
  ciktiTokeni: number;
  cagriSayisi: number;
}

export interface AgacSonucu {
  /** Duz dugum listesi. Kok parentId === null olan. */
  dugumler: Agac;
  kullanim: AgacKullanimi;
  /** Butce ya da derinlik yuzunden genisletilemeyen dugum sayisi. */
  genisletilmeyen: number;
}
