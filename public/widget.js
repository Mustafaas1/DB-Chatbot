(function () {
  "use strict";

  /**
   * GOMME SCRIPTI -- host sayfada calisan tek parca.
   *
   * Portalin kendi CSS'i var ve bizimkiyle carpisir. Shadow DOM sizintiyi
   * tek yonde durdurur; IFRAME iki yonde de keser. Bu yuzden butun arayuz
   * (yuvarlak butonu dahil) iframe'in icinde yasiyor ve host tarafina
   * yalnizca "iframe'i su boyuta getir" isi kaliyor.
   *
   * Protokol iki yonlu ve DAR:
   *   iframe -> host : { kaynak, tur: "hazirim" }
   *   host -> iframe : { kaynak, tur: "hazir", token }
   *   iframe -> host : { kaynak, tur: "boyut", durum: "kapali|panel|genis" }
   *
   * EL SIKISMAYI IFRAME BASLATIR: host'un `load` aninda gonderdigi mesaj,
   * iframe'deki React dinleyicisi henuz baglanmadigi icin kayboluyordu.
   *
   * Baska mesaj kabul edilmiyor; gonderen de origin ve pencere kimligiyle
   * dogrulaniyor. Aksi halde sayfadaki herhangi bir script widget'a mesaj
   * atabilirdi.
   */

  var IMZA = "gokkusagi-ajan";

  // Ayni sayfaya iki kez eklenirse ikinci cagri sessizce cikar.
  if (window.__gokkusagiAjanYuklendi) return;
  window.__gokkusagiAjanYuklendi = true;

  var script =
    document.currentScript ||
    document.querySelector("script[data-gokkusagi-ajan]");
  if (!script) {
    console.error("[gokkusagi-ajan] Script etiketi bulunamadi.");
    return;
  }

  var token = script.getAttribute("data-token") || "";
  // Widget'in adresi script'in KENDI src'sinden turetiliyor; ayrica
  // yapilandirma istemek gereksiz bir hata kaynagi olurdu.
  var kok = new URL(script.src, window.location.href);
  var kaynakAdres = kok.origin;
  var cerceveAdresi = kaynakAdres + "/widget";

  /** Her durumun host tarafindaki olculeri (px). */
  var OLCULER = {
    kapali: { g: 88, y: 88 },
    panel: { g: 452, y: 680 },
    genis: { g: 912, y: 720 },
  };

  /** Kenar boslugu; FAB'in golgesi de bu alanin icinde kaliyor. */
  var KENAR = 16;

  var cerceve = document.createElement("iframe");
  // Belirtec ADRESE KONMUYOR, yalnizca postMessage ile gidiyor. Onceden
  // "#token=..." olarak da veriliyordu; iki yol birden olunca widget onu
  // sessionStorage'a yaziyor ve host `data-token`'i kaldirsa bile sekme
  // kapanana kadar eski belirtec gecerli kaliyordu.
  cerceve.src = cerceveAdresi;
  cerceve.title = "İş Zekâsı Ajanı";
  cerceve.setAttribute("aria-label", "İş Zekâsı Ajanı");
  // allow-same-origin YOK denemesi yapilmadi: widget kendi kaynagindan
  // fetch yapiyor ve sessionStorage kullaniyor.
  cerceve.setAttribute("allow", "clipboard-write");
  cerceve.style.cssText = [
    "position:fixed",
    "bottom:" + KENAR + "px",
    "right:" + KENAR + "px",
    "width:" + OLCULER.kapali.g + "px",
    "height:" + OLCULER.kapali.y + "px",
    "border:0",
    "border-radius:16px",
    "background:transparent",
    "color-scheme:normal",
    // Portalin kendi katmanlarinin uzerinde ama tarayici arayuzunun altinda.
    "z-index:2147483000",
    "box-shadow:none",
    "transition:width .22s cubic-bezier(.4,0,.2,1),height .22s cubic-bezier(.4,0,.2,1)",
  ].join(";");

  /**
   * Ekrana sigdir.
   *
   * Sabit 452x680 dar bir tarayici penceresinde ekranin disina tasiyordu;
   * kenar boslugunu iki kez dusup kalani veriyoruz.
   */
  function sigdir(olcu) {
    var enGenis = Math.max(280, window.innerWidth - KENAR * 2);
    var enYuksek = Math.max(320, window.innerHeight - KENAR * 2);
    return {
      g: Math.min(olcu.g, enGenis),
      y: Math.min(olcu.y, enYuksek),
    };
  }

  var suanki = "kapali";

  function boyutla(durum) {
    var olcu = OLCULER[durum];
    if (!olcu) return;
    suanki = durum;
    var s = sigdir(olcu);
    cerceve.style.width = s.g + "px";
    cerceve.style.height = s.y + "px";
  }

  window.addEventListener("resize", function () {
    boyutla(suanki);
  });

  function gonder(mesaj) {
    if (!cerceve.contentWindow) return;
    mesaj.kaynak = IMZA;
    // Hedef origin ACIKCA veriliyor; "*" mesaji sayfadaki her cerceveye
    // gorunur kilardi ve token da o mesajin icinde.
    cerceve.contentWindow.postMessage(mesaj, kaynakAdres);
  }

  window.addEventListener("message", function (olay) {
    // Uc kontrol: dogru kaynak, dogru pencere, dogru imza. Biri eksikse
    // sayfadaki baska bir script widget'i yonetebilirdi.
    if (olay.origin !== kaynakAdres) return;
    if (olay.source !== cerceve.contentWindow) return;
    var veri = olay.data;
    if (!veri || veri.kaynak !== IMZA) return;

    // iframe "hazirim" dedi: dinleyicisi bagli, belirteci simdi gonderebiliriz.
    if (veri.tur === "hazirim") {
      gonder({ tur: "hazir", token: token });
      return;
    }

    if (veri.tur === "boyut" && OLCULER[veri.durum]) boyutla(veri.durum);
  });

  function ekle() {
    document.body.appendChild(cerceve);
  }
  if (document.body) ekle();
  else document.addEventListener("DOMContentLoaded", ekle);
})();
