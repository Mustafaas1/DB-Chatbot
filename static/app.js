/* Veritabanı Asistanı - arayüz mantığı */

const sohbetEl = document.getElementById("sohbet");
const formEl = document.getElementById("form");
const mesajEl = document.getElementById("mesaj");
const gonderBtn = document.getElementById("gonderBtn");
const tabloListesiEl = document.getElementById("tabloListesi");
const durumNokta = document.getElementById("durumNokta");
const durumMetin = document.getElementById("durumMetin");
const durumDetay = document.getElementById("durumDetay");

let oturumId = null;
let bekliyor = false;

/* ---------- yardımcılar ---------- */

// Sunucuda API_TOKEN tanimliysa anahtar buradan okunur. Tarayiciya inen
// anahtar gizli degildir; gercek kullanici bazli yetki icin istekler
// portalin kendi sunucusu uzerinden vekillenmelidir.
const TOKEN_ANAHTARI = "vtasistan.token";

function tokenAl() {
  try { return localStorage.getItem(TOKEN_ANAHTARI) || ""; } catch (e) { return ""; }
}

function basliklar(ekJson) {
  const h = ekJson ? { "Content-Type": "application/json" } : {};
  const t = tokenAl();
  if (t) h["Authorization"] = "Bearer " + t;
  return h;
}

async function tokenIste() {
  const girilen = window.prompt(
    "Bu sunucu API anahtari istiyor." + String.fromCharCode(10) +
    "Anahtari girin (.env dosyasindaki API_TOKEN):"
  );
  if (girilen && girilen.trim()) {
    try { localStorage.setItem(TOKEN_ANAHTARI, girilen.trim()); } catch (e) {}
    location.reload();
  }
}

function el(etiket, sinif, metin) {
  const d = document.createElement(etiket);
  if (sinif) d.className = sinif;
  if (metin !== undefined) d.textContent = metin;
  return d;
}

function karsilamayiKaldir() {
  const k = sohbetEl.querySelector(".karsilama");
  if (k) k.remove();
}

function asagiKaydir() {
  sohbetEl.scrollTop = sohbetEl.scrollHeight;
}

function sayiMi(deger) {
  return typeof deger === "number";
}

/* ---------- mesaj balonları ---------- */

function kullaniciMesajiEkle(metin) {
  karsilamayiKaldir();
  const sarici = el("div", "mesaj kullanici");
  sarici.appendChild(el("div", "balon", metin));
  sohbetEl.appendChild(sarici);
  asagiKaydir();
}

function bekleyenEkle() {
  const sarici = el("div", "mesaj asistan bekleyen");
  const kutu = el("div", "dusunuyor");
  kutu.appendChild(el("span", "puls"));
  const yaziEl = el("span", null, "Sorgu hazırlanıyor…");
  kutu.appendChild(yaziEl);
  sarici.appendChild(kutu);
  sohbetEl.appendChild(sarici);
  asagiKaydir();

  // Yanıt 30 saniyeyi bulabiliyor; sayaç olmadan arayüz donmuş gibi görünüyor.
  const baslangic = Date.now();
  sarici.sayac = setInterval(() => {
    const saniye = Math.round((Date.now() - baslangic) / 1000);
    let yazi = "Sorgu hazırlanıyor… " + saniye + " sn";
    if (saniye >= 15) yazi += " (yoğunluk olabilir, bekleyin)";
    yaziEl.textContent = yazi;
  }, 1000);
  return sarici;
}

/* ---------- SQL kutusu ---------- */

function sqlKutusuOlustur(adim, acikBasla) {
  const kutu = el("div", "sql-kutu");
  if (acikBasla) kutu.classList.add("acik");

  const baslik = el("div", "sql-baslik");
  baslik.appendChild(el("span", "ok", "▶"));
  baslik.appendChild(el("span", null, adim.description || "Çalıştırılan SQL sorgusu"));

  const rozet = el("span", "sql-rozet");
  if (adim.ok) {
    rozet.textContent = `${adim.row_count} satır · ${adim.duration_ms} ms`;
  } else {
    rozet.textContent = "hata";
    rozet.classList.add("hata");
  }
  baslik.appendChild(rozet);
  baslik.addEventListener("click", () => kutu.classList.toggle("acik"));
  kutu.appendChild(baslik);

  const govde = el("div", "sql-govde");
  const pre = el("pre");
  pre.appendChild(el("code", null, adim.sql));
  govde.appendChild(pre);
  if (!adim.ok && adim.error) {
    govde.appendChild(el("div", "sql-hata", adim.error));
  }
  kutu.appendChild(govde);
  return kutu;
}

/* ---------- sonuç tablosu ---------- */

function csvOlustur(sonuc) {
  const kacir = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const satirlar = [sonuc.columns.map(kacir).join(";")];
  for (const satir of sonuc.rows) satirlar.push(satir.map(kacir).join(";"));
  // Excel'in Türkçe karakterleri doğru okuması için BOM ekliyoruz.
  return "﻿" + satirlar.join("\r\n");
}

function csvIndir(sonuc) {
  const blob = new Blob([csvOlustur(sonuc)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const damga = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `sorgu-sonucu-${damga}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- grafik ----------
   Sonuc iki kolonluysa ve biri sayisal, digeri etiketse cubuk grafik
   cizilebilir. Karar istemcide verilir; yapay zekaya sorulmaz, token harcamaz. */
function grafikVerisi(sonuc, esnek) {
  if (!sonuc || !sonuc.columns || sonuc.columns.length < 2) return null;
  if (!sonuc.rows || sonuc.rows.length < 2) return null;

  const gecerli = (v) => typeof v === "number" && isFinite(v);
  // "ID", "No", "Kod" gibi kolonlar sayisaldir ama olculecek bir deger degildir.
  const kimlikMi = (ad) => /(^|[ _])(id|no|kod|numara)([ _]|$)/i.test(String(ad || ""));

  const sayisal = [];
  const metinsel = [];
  sonuc.columns.forEach((ad, i) => {
    if (sonuc.rows.every((s) => gecerli(s[i]))) {
      if (!kimlikMi(ad)) sayisal.push(i);
    } else {
      metinsel.push(i);
    }
  });

  // Normalde tam olarak bir olcu kolonu isteriz; birden fazlaysa hangisinin
  // cizilecegi belirsizdir. Planlayici bu adimi grafige uygun isaretlediyse
  // (esnek) son olcu kolonunu aliyoruz: toplam/tutar genelde sonda gelir.
  if (!metinsel.length) return null;
  if (sayisal.length !== 1 && !(esnek && sayisal.length > 1)) return null;
  const degerIdx = sayisal[sayisal.length - 1];
  const etiketIdx = metinsel[0];

  const SINIR = 12;
  const veri = sonuc.rows.slice(0, SINIR).map((s) => ({
    etiket: s[etiketIdx] === null || s[etiketIdx] === undefined ? "—" : String(s[etiketIdx]),
    deger: s[degerIdx],
  }));

  // Negatif degerlerde tek yonlu cubuk yaniltici olur.
  if (veri.some((d) => d.deger < 0)) return null;
  const enBuyuk = Math.max.apply(null, veri.map((d) => d.deger));
  if (!(enBuyuk > 0)) return null;

  return { veri, enBuyuk, kirpildi: sonuc.rows.length > SINIR, toplamSatir: sonuc.rows.length };
}

function grafikOlustur(g) {
  const kutu = el("div", "grafik");
  for (const d of g.veri) {
    const satir = el("div", "grafik-satir");
    satir.appendChild(el("span", "grafik-etiket", d.etiket));
    const yol = el("div", "grafik-yol");
    const cubuk = el("div", "grafik-cubuk");
    // En kucuk deger de gorunur kalsin diye taban genislik veriyoruz.
    cubuk.style.width = Math.max(2, (d.deger / g.enBuyuk) * 100) + "%";
    yol.appendChild(cubuk);
    satir.appendChild(yol);
    satir.appendChild(el("span", "grafik-deger", d.deger.toLocaleString("tr-TR")));
    kutu.appendChild(satir);
  }
  if (g.kirpildi) {
    kutu.appendChild(el("div", "grafik-not", `${g.toplamSatir} satırın ilk 12'si gösteriliyor`));
  }
  return kutu;
}

function sonucTablosuOlustur(sonuc, esnek, dugmesiz) {
  const kutu = el("div", "sonuc-kutu");

  const ust = el("div", "sonuc-ust");
  ust.appendChild(el("span", null, `${sonuc.row_count} satır · ${sonuc.columns.length} kolon`));
  const g = dugmesiz ? null : grafikVerisi(sonuc, esnek);
  if (g) {
    const gBtn = el("button", "mini-buton", "Grafik");
    gBtn.addEventListener("click", () => {
      const grafikte = kutu.classList.toggle("grafik-modu");
      gBtn.textContent = grafikte ? "Tablo" : "Grafik";
    });
    ust.appendChild(gBtn);
  }
  const indirBtn = el("button", "mini-buton", "Excel'e aktar (CSV)");
  indirBtn.addEventListener("click", () => csvIndir(sonuc));
  ust.appendChild(indirBtn);
  kutu.appendChild(ust);

  const sarici = el("div", "tablo-sarici");
  const tablo = el("table");

  const thead = el("thead");
  const trBaslik = el("tr");
  for (const kolon of sonuc.columns) trBaslik.appendChild(el("th", null, kolon));
  thead.appendChild(trBaslik);
  tablo.appendChild(thead);

  const tbody = el("tbody");
  for (const satir of sonuc.rows) {
    const tr = el("tr");
    for (const hucre of satir) {
      const td = el("td");
      if (hucre === null || hucre === undefined) {
        td.textContent = "—";
        td.className = "bos";
      } else {
        td.textContent = sayiMi(hucre) ? hucre.toLocaleString("tr-TR") : String(hucre);
        if (sayiMi(hucre)) td.className = "sayi";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tablo.appendChild(tbody);
  sarici.appendChild(tablo);
  kutu.appendChild(sarici);

  if (g) kutu.appendChild(grafikOlustur(g));

  if (sonuc.truncated) {
    kutu.appendChild(
      el("div", "uyari-serit",
        `Sonuç ${sonuc.row_count} satırda kesildi. Tamamı için sorgunuzu daraltın veya .env dosyasındaki MAX_ROWS değerini artırın.`)
    );
  }
  return kutu;
}

/* ---------- asistan cevabı ---------- */

/* ---------- ajan zinciri ----------
   Her adim kendi panelinde gosterilir: hangi ajanin ne yaptigi gorunur olsun.
   grafik=true olan adimlarda tablo yerine grafik acik baslar (ek token yok). */
/* Grafik ayri bir tarayici sekmesinde acilir. Veri URL fragmentinde tasinir:
   sunucuya gitmez ve widget baska bir alan adinda gomulu olsa bile calisir.
   NOT: Yanit asenkron geldigi icin acilis aninda kullanici tiklamasi yoktur;
   tarayicilar bu durumda window.open'i engelleyebilir. Engellenirse panelde
   duran baglanti devreye girer. */
function grafikAdresi(adim, g, apiKoku) {
  const yuk = {
    baslik: adim.ajan_adi,
    ajan: adim.ajan_adi,
    renk: adim.renk,
    gorev: adim.gorev,
    cevap: adim.answer,
    veri: g.veri,
    columns: adim.result.columns,
    rows: (adim.result.rows || []).slice(0, 50),
    not: g.kirpildi ? g.toplamSatir + " satirin ilk " + g.veri.length + "'i cizildi" : "",
  };
  return (apiKoku || "") + "/grafik#veri=" + encodeURIComponent(JSON.stringify(yuk));
}

function grafikBaglantisi(adres, engellendi) {
  const a = document.createElement("a");
  a.className = "grafik-baglanti" + (engellendi ? " uyari" : "");
  a.href = adres;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = engellendi
    ? "Grafiği yeni sekmede aç (tarayıcı otomatik açmayı engelledi)"
    : "Grafiği yeni sekmede aç";
  return a;
}

function ajanRozeti(adim) {
  const r = el("span", "ajan-rozet", adim.ajan_adi);
  r.style.background = adim.renk;
  return r;
}

function adimPaneliOlustur(adim, toplamAdim) {
  const panel = el("div", "adim-panel");
  panel.style.borderLeftColor = adim.renk;

  const ust = el("div", "adim-ust");
  if (toplamAdim > 1) ust.appendChild(el("span", "adim-sira", adim.sira + "/" + toplamAdim));
  ust.appendChild(ajanRozeti(adim));
  ust.appendChild(el("span", "adim-gorev", adim.gorev));
  panel.appendChild(ust);

  const adimlar = adim.steps || [];
  const sonBasarili = [...adimlar].reverse().find((a) => a.ok);
  for (const s of adimlar) panel.appendChild(sqlKutusuOlustur(s, false));

  const g =
    adim.grafik && adim.result && adim.result.columns && adim.result.columns.length
      ? grafikVerisi(adim.result, true)
      : null;

  if (g) {
    // Grafik adiminda sonuc BURADA gosterilmez: tablo, grafik ve cevap metni
    // ayri sekmedeki sayfada. Panelde yalnizca yonlendirme kalir.
    const adres = grafikAdresi(adim, g, "");
    const pencere = window.open(adres, "_blank", "noopener");
    panel.appendChild(grafikBaglantisi(adres, !pencere));
  } else {
    if (adim.result && adim.result.columns && adim.result.columns.length) {
      panel.appendChild(sonucTablosuOlustur(adim.result));
    }
    if (adim.answer) panel.appendChild(el("div", "balon", adim.answer));
  }
  // Adim sorgu turlerini tuketip yarida kaldiysa acikca soyle.
  if (adim.tamamlandi === false) {
    panel.appendChild(el("div", "uyari-serit", "Bu adım tamamlanamadı; sonuç güvenilir değil."));
  }
  return panel;
}

/* Sunucu adimlari tamamlandikca yayinliyor (SSE). Tek parca beklemek yerine
   her adimi geldigi anda cizeriz; zincirli sorular 30 sn surebiliyor. */
const SATIR_SONU = String.fromCharCode(10);
const AYIRAC = SATIR_SONU + SATIR_SONU;

async function akisiTuket(govde, kayitIsle) {
  const yanit = await fetch("/api/akis/canli", {
    method: "POST",
    headers: basliklar(true),
    body: JSON.stringify(govde),
  });
  if (!yanit.ok) {
    let ayrinti = "Beklenmeyen bir hata oluştu.";
    try { ayrinti = (await yanit.json()).detail || ayrinti; } catch (e) {}
    throw new Error(ayrinti);
  }

  const okuyucu = yanit.body.getReader();
  const cozucu = new TextDecoder();
  let tampon = "";
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    tampon += cozucu.decode(value, { stream: true });
    const kareler = tampon.split(AYIRAC);
    tampon = kareler.pop();          // yarim kalan kare tamponda bekler
    for (const kare of kareler) {
      const satir = kare.split(SATIR_SONU).find((l) => l.startsWith("data: "));
      if (satir) kayitIsle(JSON.parse(satir.slice(6)));
    }
  }
}

function zincirOzetiOlustur(adimlar) {
  const ozet = el("div", "zincir-ozet");
  ozet.appendChild(el("span", "zincir-etiket", "Ajan zinciri"));
  adimlar.forEach((a, i) => {
    if (i) ozet.appendChild(el("span", "zincir-ok", "→"));
    const r = ajanRozeti(a);
    r.classList.add("bekliyor");     // adim gelince parlaklastirilir
    r.dataset.ajan = a.ajan;
    ozet.appendChild(r);
  });
  return ozet;
}

function zinciriEkle(veri, hedefEl) {
  const sarici = hedefEl || el("div", "mesaj asistan");
  sarici.className = "mesaj asistan";
  sarici.innerHTML = "";

  const adimlar = veri.adimlar || [];
  if (adimlar.length > 1) {
    const ozet = el("div", "zincir-ozet");
    ozet.appendChild(el("span", "zincir-etiket", "Ajan zinciri"));
    adimlar.forEach((a, i) => {
      if (i) ozet.appendChild(el("span", "zincir-ok", "→"));
      ozet.appendChild(ajanRozeti(a));
    });
    sarici.appendChild(ozet);
  }

  for (const adim of adimlar) sarici.appendChild(adimPaneliOlustur(adim, adimlar.length));

  if (!hedefEl) sohbetEl.appendChild(sarici);
  asagiKaydir();
}

function asistanCevabiEkle(veri, hedefEl) {
  const sarici = hedefEl || el("div", "mesaj asistan");
  sarici.className = "mesaj asistan";
  sarici.innerHTML = "";

  const adimlar = veri.steps || [];
  const sonBasarili = [...adimlar].reverse().find((a) => a.ok);

  for (const adim of adimlar) {
    // Ana sorguyu açık, keşif/hata adımlarını kapalı göster.
    sarici.appendChild(sqlKutusuOlustur(adim, adim === sonBasarili));
  }

  if (veri.result && veri.result.columns && veri.result.columns.length) {
    sarici.appendChild(sonucTablosuOlustur(veri.result));
  }

  if (veri.answer) {
    sarici.appendChild(el("div", "balon", veri.answer));
  }

  if (!hedefEl) sohbetEl.appendChild(sarici);
  asagiKaydir();
}

function hataEkle(mesaj, hedefEl) {
  const sarici = hedefEl || el("div", "mesaj asistan");
  sarici.className = "mesaj asistan";
  sarici.innerHTML = "";
  sarici.appendChild(el("div", "hata-kutu", mesaj));
  if (!hedefEl) sohbetEl.appendChild(sarici);
  asagiKaydir();
}

/* ---------- gönderim ---------- */

async function gonder(metin) {
  if (bekliyor || !metin.trim()) return;
  bekliyor = true;
  gonderBtn.disabled = true;

  kullaniciMesajiEkle(metin);
  mesajEl.value = "";
  mesajEl.style.height = "auto";
  const bekleyenEl = bekleyenEkle();

  let sarici = null;
  let ozetEl = null;

  const kayitIsle = (kayit) => {
    if (kayit.tur === "oturum") {
      oturumId = kayit.session_id;
      return;
    }
    if (kayit.tur === "hata") {
      hataEkle(kayit.mesaj, sarici || bekleyenEl);
      return;
    }
    if (kayit.tur === "plan") {
      // Ilk kayit geldi: bekleme gostergesini kalici sariciya cevir.
      clearInterval(bekleyenEl.sayac);
      sarici = bekleyenEl;
      sarici.className = "mesaj asistan";
      sarici.innerHTML = "";
      if ((kayit.adimlar || []).length > 1) {
        ozetEl = zincirOzetiOlustur(kayit.adimlar);
        sarici.appendChild(ozetEl);
      }
      asagiKaydir();
      return;
    }
    if (kayit.tur === "adim") {
      if (ozetEl) {
        const r = ozetEl.querySelector('[data-ajan="' + kayit.ajan + '"].bekliyor');
        if (r) r.classList.remove("bekliyor");
      }
      sarici.appendChild(adimPaneliOlustur(kayit, kayit.toplam_adim));
      asagiKaydir();
    }
  };

  try {
    await akisiTuket({ message: metin, session_id: oturumId }, kayitIsle);
  } catch (err) {
    hataEkle(err.message || ("Sunucuya ulaşılamadı: " + err), sarici || bekleyenEl);
  } finally {
    clearInterval(bekleyenEl.sayac);
    bekliyor = false;
    gonderBtn.disabled = false;
    mesajEl.focus();
  }
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  gonder(mesajEl.value);
});

mesajEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    gonder(mesajEl.value);
  }
});

mesajEl.addEventListener("input", () => {
  mesajEl.style.height = "auto";
  mesajEl.style.height = Math.min(mesajEl.scrollHeight, 180) + "px";
});

document.getElementById("ornekler").addEventListener("click", (e) => {
  if (e.target.classList.contains("ornek")) gonder(e.target.textContent);
});

document.getElementById("sifirlaBtn").addEventListener("click", async () => {
  await fetch("/api/oturum/sifirla", {
    method: "POST",
    headers: basliklar(true),
    body: JSON.stringify({ session_id: oturumId }),
  });
  oturumId = null;
  location.reload();
});

/* ---------- durum ve şema ---------- */

async function durumYukle() {
  try {
    const yanitDurum = await fetch("/api/durum", { headers: basliklar(false) });
    if (yanitDurum.status === 401) { await tokenIste(); return; }
    const veri = await yanitDurum.json();
    const db = veri.database;
    durumNokta.className = "nokta " + (db.ok ? "acik" : "kapali");
    durumMetin.textContent = db.ok ? "Veritabanına bağlı" : "Bağlantı kurulamadı";

    durumDetay.innerHTML = "";
    const satirEkle = (baslik, deger) => {
      durumDetay.appendChild(el("dt", null, baslik));
      durumDetay.appendChild(el("dd", null, deger));
    };
    // Aktif veritabanina uygun ornek sorulari yerlestir
    const orneklerEl = document.getElementById("ornekler");
    if (orneklerEl && Array.isArray(veri.ornekler) && veri.ornekler.length) {
      orneklerEl.innerHTML = "";
      for (const soru of veri.ornekler) {
        orneklerEl.appendChild(el("button", "ornek", soru));
      }
    }

    satirEkle("Sunucu", db.server);
    satirEkle("Veritabanı", db.database);
    satirEkle("Kimlik", db.auth);
    satirEkle("Model", veri.model);
    if (!veri.api_key_var) satirEkle("Uyarı", "API anahtarı yok");
    if (!db.ok) satirEkle("Hata", db.error);
  } catch {
    durumNokta.className = "nokta kapali";
    durumMetin.textContent = "Sunucuya ulaşılamadı";
  }
}

async function semaYukle(yenile = false) {
  tabloListesiEl.innerHTML = "";
  tabloListesiEl.appendChild(el("div", "bos-not", yenile ? "Şema taranıyor…" : "Yükleniyor…"));
  try {
    const veri = await (await fetch("/api/sema" + (yenile ? "?yenile=true" : ""),
                                    { headers: basliklar(false) })).json();
    tabloListesiEl.innerHTML = "";

    if (!veri.tables || !veri.tables.length) {
      tabloListesiEl.appendChild(el("div", "bos-not", "Veritabanında tablo bulunamadı."));
      return;
    }

    for (const tablo of veri.tables) {
      const oge = el("div", "tablo-ogesi");
      oge.appendChild(el("div", "tablo-ad", `${tablo.schema}.${tablo.name}`));
      oge.appendChild(
        el("div", "tablo-bilgi",
          `${tablo.columns.length} kolon · ~${tablo.row_count.toLocaleString("tr-TR")} satır`)
      );

      const kolonlar = el("div", "kolon-listesi");
      for (const kolon of tablo.columns) {
        const satir = el("div", "kolon-satir");
        const ad = el("b", null, kolon.name);
        satir.appendChild(ad);
        satir.appendChild(document.createTextNode(" · " + kolon.type));
        kolonlar.appendChild(satir);
      }
      oge.appendChild(kolonlar);
      oge.addEventListener("click", () => oge.classList.toggle("acik"));
      tabloListesiEl.appendChild(oge);
    }
  } catch (err) {
    tabloListesiEl.innerHTML = "";
    tabloListesiEl.appendChild(el("div", "bos-not", "Şema okunamadı: " + err.message));
  }
}

document.getElementById("semaYenileBtn").addEventListener("click", () => semaYukle(true));

/* ---------- widget'ten devir alma ---------- */

function devirAl() {
  // Widget'taki "Tam ekranda aç" butonu konuşmayı localStorage'a bırakır.
  let devir;
  try {
    const ham = localStorage.getItem("vtasistan.devir");
    if (!ham) return;
    devir = JSON.parse(ham);
  } catch {
    return;
  } finally {
    localStorage.removeItem("vtasistan.devir");
  }

  if (!devir || !Array.isArray(devir.mesajlar) || !devir.mesajlar.length) return;

  oturumId = devir.oturum || null;
  karsilamayiKaldir();

  for (const mesaj of devir.mesajlar) {
    if (mesaj.rol === "kullanici") {
      kullaniciMesajiEkle(mesaj.metin);
    } else if (mesaj.hata) {
      hataEkle(mesaj.hata);
    } else if (mesaj.adimlar) {
      zinciriEkle({ adimlar: mesaj.adimlar });
    } else {
      // Widget'in eski (tek ajanli) mesaj bicimi.
      asistanCevabiEkle({ answer: mesaj.metin, steps: mesaj.steps, result: mesaj.result });
    }
  }

  const not = el("div", "devir-notu", "Sohbet widget'ten devralındı — buradan devam edebilirsiniz.");
  sohbetEl.appendChild(not);
  asagiKaydir();
}

devirAl();
durumYukle();
semaYukle();
mesajEl.focus();
