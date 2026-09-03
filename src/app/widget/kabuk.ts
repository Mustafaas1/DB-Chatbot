"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { belirteciYaz } from "../belirtec";

/**
 * Widget kabugunun host sayfayla konusma katmani.
 *
 * Widget bir iframe icinde yasiyor ve kendi boyutunu DEGISTIREMEZ; boyutu
 * host sayfadaki `widget.js` tutuyor. Bu yuzden her durum degisiminde
 * host'a haber vermek gerekiyor.
 *
 * Tek basina acildiginda (gelistirme sirasinda /widget adresi) ust pencere
 * kendisidir; o durumda postMessage yapilmiyor ve panel dogrudan aciliyor.
 * Aksi halde gelistirme sirasinda bos bir yuvarlak butondan baskasi
 * gorunmezdi.
 *
 * EL SIKISMAYI IFRAME BASLATIR. Once host, iframe'in `load` olayinda
 * `hazir` gonderiyordu; ama React dinleyicisi `useEffect` icinde, yani
 * `load`tan SONRA bagleniyor ve mesaj kayboluyordu. Sonuc: panel aciliyor
 * ama host cerceveyi buyutmuyordu. Simdi sira tersine:
 *
 *   iframe -> host : "hazirim"   (sir tasimaz)
 *   host   -> iframe: "hazir" + token
 *
 * Host'un dinleyicisi script yuklenirken bagleniyor, yani iframe mount
 * oldugunda kesinlikle hazir.
 */

const IMZA = "gokkusagi-ajan";

export type Durum = "kapali" | "panel" | "genis";

interface HostMesaji {
  kaynak?: unknown;
  tur?: unknown;
  token?: unknown;
}

export interface Kabuk {
  durum: Durum;
  gomulu: boolean;
  ac: () => void;
  kapat: () => void;
  genisligiDegistir: () => void;
  /** Kesin genise gec; `genisligiDegistir` gibi geri daraltmaz. */
  genislet: () => void;
}

export function useKabuk(): Kabuk {
  // Ust pencere kendisi degilse gomuluyuz. Render sirasinda okumak
  // sunucu/istemci uyusmazligi uretirdi; efektte belirleniyor.
  const [gomulu, setGomulu] = useState(false);
  const [durum, setDurum] = useState<Durum>("kapali");
  /** Host'un origin'i: ILK mesajdan ogreniliyor, tahmin edilmiyor. */
  const hostAdresi = useRef<string | null>(null);

  useEffect(() => {
    const icerde = window.parent !== window;
    setGomulu(icerde);
    // Gomulu degilsek gelistirme modundayiz: panel acik baslasin.
    if (!icerde) setDurum("panel");

    function dinle(olay: MessageEvent) {
      const veri = olay.data as HostMesaji | null;
      if (!veri || veri.kaynak !== IMZA) return;
      // Gonderen ust pencere DEGILSE yok say: sayfadaki baska bir cerceve
      // belirtec gonderiyor olabilirdi.
      if (olay.source !== window.parent) return;

      if (veri.tur === "hazir") {
        hostAdresi.current = olay.origin;
        if (typeof veri.token === "string") belirteciYaz(veri.token);
      }
    }

    window.addEventListener("message", dinle);

    // Dinleyici bagliyken haber ver: host'un yaniti kaybolmasin.
    if (icerde) {
      // Hedef origin `document.referrer`den turetiliyor; "hazirim" hicbir
      // sir tasimadigi icin referrer yoksa "*" kabul edilebilir.
      let hedef = "*";
      try {
        if (document.referrer) hedef = new URL(document.referrer).origin;
      } catch { /* bicimsiz referrer: "*" ile devam */ }
      window.parent.postMessage({ kaynak: IMZA, tur: "hazirim" }, hedef);
    }

    return () => window.removeEventListener("message", dinle);
  }, []);

  const bildir = useCallback((yeni: Durum) => {
    const hedef = hostAdresi.current;
    if (!hedef || window.parent === window) return;
    window.parent.postMessage({ kaynak: IMZA, tur: "boyut", durum: yeni }, hedef);
  }, []);

  const gec = useCallback((yeni: Durum) => {
    setDurum(yeni);
    bildir(yeni);
  }, [bildir]);

  // ESC paneli kapatir. Gomulu widget'ta klavye olayi iframe'in icinde
  // kaliyor; host tarafinda ayrica dinlemeye gerek yok.
  useEffect(() => {
    if (durum === "kapali") return;
    function tus(e: KeyboardEvent) {
      if (e.key === "Escape") gec("kapali");
    }
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [durum, gec]);

  return {
    durum,
    gomulu,
    ac: useCallback(() => gec("panel"), [gec]),
    kapat: useCallback(() => gec("kapali"), [gec]),
    genisligiDegistir: useCallback(
      () => gec(durum === "genis" ? "panel" : "genis"),
      [durum, gec]
    ),
    genislet: useCallback(() => gec("genis"), [gec]),
  };
}
