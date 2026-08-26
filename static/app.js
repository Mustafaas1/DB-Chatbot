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

function anahtarFormuGoster(mesaj) {
  // window.prompt kullanmiyoruz: tarayiciyi kilitliyor ve iptal edilirse
  // sayfa sessizce bos kaliyordu. Bunun yerine sohbet alaninda form.
  if (document.getElementById("anahtarKutusu")) return;

  const kutu = document.createElement("div");
  kutu.className = "hata-kutu";
  kutu.id = "anahtarKutusu";

  const p = document.createElement("p");
  p.style.margin = "0 0 10px";
  p.textContent = mesaj || "Bu sunucu API anahtarı istiyor (.env dosyasındaki API_TOKEN).";
  kutu.appendChild(p);

  const satir = document.createElement("div");
  satir.style.display = "flex";
  satir.style.gap = "8px";

  const girdi = document.createElement("input");
  girdi.type = "password";
  girdi.placeholder = "API anahtarını yapıştırın";
  girdi.style.flex = "1";
  girdi.style.padding = "8px 10px";
  girdi.style.border = "1px solid var(--kenar)";
  girdi.style.borderRadius = "8px";
  girdi.style.font = "inherit";

  const btn = document.createElement("button");
  btn.className = "mini-buton";
  btn.textContent = "Kaydet";

  const kaydet = () => {
    const v = girdi.value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_ANAHTARI, v); } catch (e) {}
    location.reload();
  };
  btn.addEventListener("click", kaydet);
  girdi.addEventListener("keydown", (e) => { if (e.key === "Enter") kaydet(); });

  satir.append(girdi, btn);
  kutu.appendChild(satir);

  karsilamayiKaldir();
  sohbetEl.appendChild(kutu);
  asagiKaydir();
  girdi.focus();
}

/* Model cevaplarinda **kalin** isaretlemesi kullaniyor. Metni oldugu gibi
   basmak yerine yildizlari kaldirip <strong> uretiyoruz. innerHTML KULLANMIYORUZ:
   model ciktisi guvenilmez, DOM'u metin dugumleriyle kuruyoruz. */
function kalinMetin(kap, metin) {
  const parcalar = String(metin == null ? "" : metin).split(/\*\*/);
  parcalar.forEach(function (p, n) {
    if (p === "") return;
    // Tek indisli parcalar iki yildiz ARASINDA kalanlardir.
    if (n % 2 === 1) {
      const s = document.createElement("strong");
      s.textContent = p;
      kap.appendChild(s);
    } else {
      kap.appendChild(document.createTextNode(p));
    }
  });
  return kap;
}

function balon(metin, sinif) {
  const d = document.createElement("div");
  d.className = sinif || "balon";
  return kalinMetin(d, metin);
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
  sarici.appendChild(balon(metin));
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
  // Etiket TUM metin kolonlarindan olusturulur. Tek kolon alininca
  // "Gonderildi" gibi degerler tekrar edip grafigi okunmaz yapiyordu;
  // birlestirince "Gonderildi · TRY" seklinde ayirt edilebilir oluyor.
  const etiketle = function (s) {
    return metinsel
      .map(function (i) { return s[i] === null || s[i] === undefined ? "—" : String(s[i]); })
      .filter(function (v) { return v !== ""; })
      .join(" · ");
  };

  const SINIR = 12;
  const veri = sonuc.rows.slice(0, SINIR).map((s) => ({
    etiket: etiketle(s),
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
/* Her ajan adimi KENDI sayfasinda acilir; tum adimlar tek yukte tasindigi
   icin acilan sayfalarin ustunde diger ajanlara gecis sekmeleri olur.
   Boylece bir soruya birden fazla ajan baktiginda sonuclari karsilastirmak
   (denetlemek) mumkun olur. Veri URL fragmentinde: sunucuya gitmez. */
function adimYuku(adim) {
  const g = adim.result && adim.result.columns && adim.result.columns.length
    ? grafikVerisi(adim.result, true)
    : null;
  return {
    ajan: adim.ajan_adi,
    renk: adim.renk,
    gorev: adim.gorev,
    cevap: adim.answer,
    veri: g ? g.veri : null,
    not: g && g.kirpildi ? g.toplamSatir + " satirin ilk " + g.veri.length + "'i cizildi" : "",
    columns: adim.result ? adim.result.columns : null,
    rows: adim.result ? (adim.result.rows || []).slice(0, 50) : null,
  };
}

function sonucAdresi(soru, yukler, sira, apiKoku) {
  const veri = { soru: soru, adimlar: yukler };
  return (apiKoku || "") + "/sonuc#veri=" + encodeURIComponent(JSON.stringify(veri)) + "&i=" + sira;
}

function sonucBaglantisi(adres, ajan) {
  // Tarayici otomatik acmayi engellese de baglanti ayni gorunur: uyari
  // metni her seferinde ciktigi icin gurultu yapiyordu, tiklayinca zaten
  // aciliyor.
  const a = document.createElement("a");
  a.className = "grafik-baglanti";
  a.href = adres;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = ajan + " sonucunu yeni sekmede aç";
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

  // Sonuc BURADA gosterilmez: tablo, grafik ve cevap metni ayri sekmedeki
  // sayfada. Panelde yalnizca yonlendirme kalir. Baglantinin adresi, sonraki
  // adimlar geldikce guncellenir (bkz. baglantilariTazele).
  const bag = sonucBaglantisi("#", adim.ajan_adi);
  bag.dataset.sira = String(adim.sira - 1);
  panel.appendChild(bag);
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
    const hata = new Error(ayrinti);
    hata.durum = yanit.status;      // 401'de anahtar formu gosterilecek
    throw hata;
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
    sarici.appendChild(balon(veri.answer));
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
  const yukler = [];          // acilan sayfalarin paylastigi tum adimlar

  // Yeni adim geldikce daha once acilan panellerdeki baglantilar da tum
  // adimlari tasisin ki her sayfadan digerlerine gecilebilsin.
  const baglantilariTazele = () => {
    if (!sarici) return;
    for (const a of sarici.querySelectorAll(".grafik-baglanti[data-sira]")) {
      a.href = sonucAdresi(metin, yukler, Number(a.dataset.sira), "");
    }
  };

  // Ikinci ajan dakikalik token limiti yuzunden 40-60 sn surebiliyor.
  // O sure boyunca ekranda hicbir sey degismezse kullanici takildi saniyor;
  // sirada bekleyen ajani gecen sureyle birlikte gosteriyoruz.
  let bekleyenEl2 = null;
  let bekleyenSayac = null;

  const bekleyenAdimiTemizle = () => {
    if (bekleyenSayac) clearInterval(bekleyenSayac);
    bekleyenSayac = null;
    if (bekleyenEl2) bekleyenEl2.remove();
    bekleyenEl2 = null;
  };

  const bekleyenAdimiTazele = () => {
    bekleyenAdimiTemizle();
    if (!ozetEl || !sarici) return;
    const kalan = ozetEl.querySelector(".ajan-rozet.bekliyor");
    if (!kalan) return;

    const basla = Date.now();
    bekleyenEl2 = el("div", "adim-bekliyor");
    const yaz = () => {
      const sn = Math.round((Date.now() - basla) / 1000);
      bekleyenEl2.textContent = kalan.textContent + " çalışıyor… " + sn + " sn";
    };
    yaz();
    bekleyenSayac = setInterval(yaz, 1000);
    sarici.appendChild(bekleyenEl2);
    asagiKaydir();
  };

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
      bekleyenAdimiTazele();
      asagiKaydir();
      return;
    }
    if (kayit.tur === "adim") {
      if (ozetEl) {
        const r = ozetEl.querySelector('[data-ajan="' + kayit.ajan + '"].bekliyor');
        if (r) r.classList.remove("bekliyor");
      }
      bekleyenAdimiTazele();
      yukler.push(adimYuku(kayit));
      sarici.appendChild(adimPaneliOlustur(kayit, kayit.toplam_adim));
      baglantilariTazele();

      // Bu adimin sayfasini kendi sekmesinde ac.
      const adres = sonucAdresi(metin, yukler, yukler.length - 1, "");
      // Engellenirse sessizce gec: panelde zaten tiklanabilir baglanti var.
      window.open(adres, "_blank", "noopener");
      asagiKaydir();
    }
  };

  try {
    await akisiTuket({ message: metin, session_id: oturumId }, kayitIsle);
  } catch (err) {
    if (err && err.durum === 401) {
      (sarici || bekleyenEl).remove();
      anahtarFormuGoster(err.message);
    } else {
      hataEkle(err.message || ("Sunucuya ulaşılamadı: " + err), sarici || bekleyenEl);
    }
  } finally {
    bekleyenAdimiTemizle();
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
    if (yanitDurum.status === 401) { anahtarFormuGoster(); return; }
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
