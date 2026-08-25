/*
 * Veritabani Asistani - gomulebilir sohbet widget'i
 *
 * Herhangi bir sayfaya tek satirla eklenir:
 *   <script src="http://sunucu:8000/static/widget.js" data-api="http://sunucu:8000"></script>
 *
 * Tum arayuz Shadow DOM icinde olusturulur; sayfanin CSS'i widget'i,
 * widget da sayfayi etkilemez.
 */
(function () {
  "use strict";

  if (window.__vtAsistanYuklendi) return;
  window.__vtAsistanYuklendi = true;

  const script = document.currentScript;
  const ds = (script && script.dataset) || {};
  const API = (ds.api || "").replace(/\/+$/, "");
  const BASLIK = ds.baslik || "Veri Asistanı";
  const ALTBASLIK = ds.altbaslik || "Verilerinize anında ulaşın, raporlarınızı saniyeler içinde oluşturun";
  const RENK = ds.renk || "#3452d8";
  const ORNEK_ELLE_VERILDI = Boolean(ds.ornekler);
  // data-acik="1" verilirse panel ilk aciliste kendiliginden acik gelir.
  const ACIK_BASLANGIC = ds.acik === "1" || ds.acik === "true";
  // Sunucuda API_TOKEN tanimliysa data-token ile gonderilmelidir.
  // NOT: Tarayiciya inen anahtar gizli degildir; sayfayi goren okuyabilir.
  const TOKEN = (ds.token || "").trim();

  function basliklar(ekJson) {
    const h = ekJson ? { "Content-Type": "application/json" } : {};
    if (TOKEN) h["Authorization"] = "Bearer " + TOKEN;
    return h;
  }
  let ORNEKLER = (ds.ornekler ||
    "1 ay içinde sözleşmeleri bitecek müşteriler|Vadesi geçmiş faturaların toplamı|Şehirlere göre aktif müşteri sayısı"
  ).split("|").filter(Boolean);

  const ANAHTAR_OTURUM = "vtasistan.oturum";
  const ANAHTAR_MESAJ = "vtasistan.mesajlar";
  const ANAHTAR_ACIK = "vtasistan.acik";

  let oturumId = sessionStorage.getItem(ANAHTAR_OTURUM) || null;
  let mesajlar = [];
  try {
    mesajlar = JSON.parse(sessionStorage.getItem(ANAHTAR_MESAJ) || "[]");
  } catch (e) { mesajlar = []; }
  const kayitliAcik = sessionStorage.getItem(ANAHTAR_ACIK);
  // Kullanici paneli kapattiysa o secim oturum boyunca korunur.
  let acik = kayitliAcik === null ? ACIK_BASLANGIC : kayitliAcik === "1";
  let bekliyor = false;

  function mesajlariKaydet() {
    try {
      // Cok buyumesin: son 40 mesaj yeterli.
      sessionStorage.setItem(ANAHTAR_MESAJ, JSON.stringify(mesajlar.slice(-40)));
    } catch (e) { /* kota dolduysa sessizce gec */ }
  }

  const host = document.createElement("div");
  host.id = "vt-asistan-widget";
  const kok = host.attachShadow({ mode: "open" });

  const STIL = `
  :host {
    --renk: ${RENK};
    --renk-koyu: #1b2a6b;
    --metin: #334155;
    --soluk: #64748b;
    --kenar: #e2e5ec;
    --zemin: #f4f6fa;
    --panel: #ffffff;
    --kirmizi: #ec2b7f;
    --sari: #f97316;
    all: initial;
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 2147483000;
    font: 14px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
    color: var(--metin);
  }
  * { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; }

  .fab {
    width: 58px; height: 58px; border-radius: 50%;
    border: none; background: linear-gradient(135deg, var(--renk-koyu), var(--renk)); color: #fff;
    box-shadow: 0 10px 24px rgba(27, 42, 107, .34);
    display: grid; place-items: center;
    transition: transform .25s ease, box-shadow .25s ease;
    position: relative; margin-left: auto;
  }
  .fab:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(27, 42, 107, .4); }
  .fab:active { transform: scale(.95); }
  .fab svg { position: absolute; transition: opacity .18s, transform .18s; }
  .fab .kapat-ikon { opacity: 0; transform: rotate(-90deg) scale(.6); }
  :host(.acik) .fab .sohbet-ikon { opacity: 0; transform: rotate(90deg) scale(.6); }
  :host(.acik) .fab .kapat-ikon { opacity: 1; transform: rotate(0) scale(1); }

  .rozet {
    position: absolute; top: -2px; right: -2px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #4ade80; border: 2.5px solid #fff;
    display: none;
  }
  :host(.hazir) .rozet { display: block; }
  :host(.acik) .rozet { display: none; }

  .panel {
    position: absolute; right: 0; bottom: 72px;
    width: 400px; height: min(620px, calc(100vh - 130px));
    background: var(--panel);
    border: 1px solid var(--kenar);
    border-radius: 20px;
    box-shadow: 0 12px 44px rgba(27, 42, 107, .16);
    display: flex; flex-direction: column; overflow: hidden;
    opacity: 0; transform: translateY(12px) scale(.97);
    pointer-events: none;
    transition: opacity .28s ease, transform .28s ease;
  }
  :host(.acik) .panel { opacity: 1; transform: none; pointer-events: auto; }

  .ust {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: none;
    background: linear-gradient(135deg, var(--renk-koyu), var(--renk));
    flex: none; color: #fff;
  }
  .ust-ikon {
    width: 34px; height: 34px; border-radius: 10px; flex: none;
    background: rgba(255,255,255,.18); color: #fff;
    display: grid; place-items: center; font-weight: 700; font-size: 13px;
  }
  .ust-yazi { flex: 1; min-width: 0; }
  .ust-baslik { font-weight: 650; font-size: 14.5px; color: #fff; }
  .ust-alt { font-size: 11.5px; color: rgba(255,255,255,.8); display: flex; align-items: center; gap: 5px; }
  .nokta { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.5); flex: none; animation: noktaPuls 2s ease infinite; }
  .nokta.acik { background: #4ade80; }
  .nokta.kapali { background: #ff6b6b; }
  @keyframes noktaPuls { 50% { opacity: .4; } }

  .ust-buton {
    border: none; background: transparent; color: rgba(255,255,255,.85);
    width: 30px; height: 30px; border-radius: 9px;
    display: grid; place-items: center; flex: none;
    transition: background .2s, color .2s;
  }
  .ust-buton:hover { background: rgba(255,255,255,.16); color: #fff; }

  .govde { flex: 1; overflow-y: auto; padding: 16px 14px; background: linear-gradient(to bottom, var(--zemin), var(--panel) 40%); }
  .govde::-webkit-scrollbar { width: 6px; }
  .govde::-webkit-scrollbar-thumb { background: #c4cad4; border-radius: 3px; }
  .govde::-webkit-scrollbar-track { background: transparent; }

  .karsilama { padding: 12px 4px 2px; text-align: center; }
  .karsilama-ikon {
    display: inline-grid; place-items: center;
    width: 56px; height: 56px; border-radius: 16px;
    background: linear-gradient(135deg, rgba(52,82,216,.1), rgba(236,43,127,.08));
    margin-bottom: 12px;
  }
  .karsilama-ikon svg { width: 28px; height: 28px; color: var(--renk); }
  .karsilama h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; color: var(--renk-koyu); }
  .karsilama p { margin: 0 0 16px; font-size: 13px; color: var(--soluk); line-height: 1.5; padding: 0 8px; }
  .ornek {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    border: 1px solid var(--kenar); background: var(--panel);
    border-radius: 13px; padding: 10px 13px; margin-bottom: 7px;
    font-size: 13px; color: var(--metin); font-weight: 500;
    transition: border-color .2s, background .2s, transform .2s;
  }
  .ornek:hover { border-color: var(--renk); background: rgba(52,82,216,.04); transform: translateX(3px); }
  .ornek::before { content: '→'; color: var(--soluk); font-weight: 400; flex: none; transition: color .2s; }
  .ornek:hover::before { color: var(--renk); }

  .mesaj { margin-bottom: 14px; animation: msgPop .25s ease-out; }
  @keyframes msgPop { from { opacity: 0; transform: translateY(6px); } }
  .mesaj.kullanici { display: flex; justify-content: flex-end; }
  .kullanici .balon {
    background: linear-gradient(135deg, var(--renk-koyu), var(--renk)); color: #fff;
    padding: 10px 14px; border-radius: 15px 15px 5px 15px;
    max-width: 85%; white-space: pre-wrap; font-size: 13.5px;
    box-shadow: 0 6px 16px rgba(34, 50, 90, .2);
  }
  .asistan .balon {
    background: var(--panel); border: 1px solid var(--kenar);
    padding: 10px 14px; border-radius: 15px 15px 15px 5px;
    white-space: pre-wrap; font-size: 13.5px;
    box-shadow: 0 2px 4px rgba(16,24,40,.04);
  }

  .dusunuyor { display: flex; align-items: center; gap: 8px; color: var(--soluk); font-size: 13px; }
  .puls { width: 7px; height: 7px; border-radius: 50%; background: var(--renk); animation: puls 1.1s infinite; }
  @keyframes puls { 0%,100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }

  .sql-kutu { border: 1px solid var(--kenar); border-radius: 13px; background: var(--panel); margin-bottom: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(16,24,40,.04); }
  .sql-ust {
    display: flex; align-items: center; gap: 7px; width: 100%;
    padding: 9px 12px; border: none; background: transparent;
    font-size: 12px; color: var(--metin); text-align: left; font-weight: 500;
  }
  .sql-ust:hover { background: var(--zemin); }
  .sql-ust .ok { font-size: 9px; transition: transform .15s; flex: none; }
  .sql-kutu.acik .sql-ust .ok { transform: rotate(90deg); }
  .sql-ust .etiket { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rozet-kucuk {
    font-size: 10.5px; padding: 1px 7px; border-radius: 999px; flex: none;
    background: rgba(52,82,216,.08); color: var(--renk); font-weight: 600;
  }
  .rozet-kucuk.hata { background: #fdecec; color: var(--kirmizi); }
  .sql-govde { display: none; border-top: 1px solid var(--kenar); }
  .sql-kutu.acik .sql-govde { display: block; }
  .sql-govde pre {
    margin: 0; padding: 11px 12px; background: #1b2a6b; color: #d7e0ea;
    font: 11.5px/1.6 Consolas, "Cascadia Code", monospace;
    overflow-x: auto; white-space: pre;
  }
  .sql-hata { padding: 9px 12px; background: #fdecec; color: #9b1c1c; font-size: 12px; }

  .sonuc { border: 1px solid var(--kenar); border-radius: 13px; background: var(--panel); overflow: hidden; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(16,24,40,.04); }
  .sonuc-ust {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 12px; border-bottom: 1px solid var(--kenar);
    font-size: 11.5px; color: var(--soluk);
  }
  .csv-buton {
    border: 1px solid var(--kenar); background: var(--panel); color: var(--soluk);
    border-radius: 8px; padding: 3px 9px; font-size: 11px; flex: none;
    transition: border-color .2s, color .2s;
  }
  .csv-buton:hover { border-color: var(--renk); color: var(--renk); }
  .tablo-sarici { overflow: auto; max-height: 260px; }
  .grafik { padding: 10px 12px 4px; display: none; gap: 7px; }
  .sonuc.grafik-modu .grafik { display: grid; }
  .sonuc.grafik-modu .tablo-sarici { display: none; }
  .grafik-satir { display: grid; grid-template-columns: minmax(0,88px) 1fr auto; align-items: center; gap: 8px; }
  .grafik-etiket { font-size: 11.5px; color: var(--soluk); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grafik-yol { background: #eef1f6; border-radius: 4px; height: 15px; overflow: hidden; }
  .grafik-cubuk { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--renk-koyu), var(--renk)); }
  .grafik-deger { font-size: 11.5px; font-variant-numeric: tabular-nums; color: #1b1f24; }
  .grafik-not { font-size: 11px; color: var(--soluk); padding: 2px 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th {
    position: sticky; top: 0; background: var(--zemin); z-index: 1;
    text-align: left; font-weight: 600; white-space: nowrap;
    padding: 7px 11px; border-bottom: 1px solid var(--kenar);
  }
  td { padding: 6px 11px; border-bottom: 1px solid #f0f2f5; white-space: nowrap; }
  tr:hover td { background: #fafbfc; }
  td.bos { color: #b6bcc4; font-style: italic; }
  td.sayi { text-align: right; font-variant-numeric: tabular-nums; }
  .uyari { padding: 6px 11px; background: #fff8ec; color: var(--sari); font-size: 11.5px; border-top: 1px solid #f5e3c3; }
  .hata-kutu { background: #fdecec; border: 1px solid #f3c2c2; color: #9b1c1c; padding: 10px 12px; border-radius: 13px; font-size: 13px; }

  .alt { flex: none; border-top: 1px solid var(--kenar); background: var(--panel); padding: 10px 12px; }
  .giris { display: flex; align-items: flex-end; gap: 8px; }
  textarea {
    flex: 1; resize: none; max-height: 110px;
    border: 1px solid var(--kenar); border-radius: 13px;
    padding: 10px 13px; font: inherit; font-size: 13.5px;
    color: var(--metin); background: var(--zemin); outline: none;
    transition: border-color .2s, background .2s;
  }
  textarea:focus { border-color: var(--renk); background: var(--panel); }
  .gonder {
    width: 40px; height: 40px; flex: none; border: none; border-radius: 12px;
    background: linear-gradient(135deg, var(--renk-koyu), var(--renk)); color: #fff;
    display: grid; place-items: center;
    box-shadow: 0 6px 16px rgba(34, 50, 90, .22);
    transition: transform .2s, opacity .2s;
  }
  .gonder:hover:not(:disabled) { transform: translateY(-2px); }
  .gonder:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }

  @media (max-width: 560px) {
    :host { right: 16px; bottom: 16px; }
    .panel {
      position: fixed; inset: 0; width: 100vw !important; height: 100dvh;
      border-radius: 0; border: none; bottom: 0; right: 0;
    }
  }
  `;

  kok.innerHTML = `
<style>${STIL}</style>

<div class="panel" role="dialog" aria-label="${BASLIK}">
  <div class="ust">
    <div class="ust-ikon">DB</div>
    <div class="ust-yazi">
      <div class="ust-baslik">${BASLIK}</div>
      <div class="ust-alt"><span class="nokta" id="nokta"></span><span id="durum">bağlanıyor…</span></div>
    </div>
    <button class="ust-buton" id="temizle" title="Sohbeti temizle" aria-label="Sohbeti temizle">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>
    </button>
    <button class="ust-buton" id="tamEkran" title="Tam ekranda aç" aria-label="Tam ekranda aç">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M21 3l-8 8M9 21H3v-6M3 21l8-8"/></svg>
    </button>
    <button class="ust-buton" id="kapatBtn" title="Kapat" aria-label="Kapat">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>

  <div class="govde" id="govde"></div>

  <div class="alt">
    <div class="giris">
      <textarea id="mesaj" rows="1" placeholder="Sorunuzu yazın…" aria-label="Mesajınız"></textarea>
      <button class="gonder" id="gonder" title="Gönder" aria-label="Gönder">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z" fill="currentColor"/></svg>
      </button>
    </div>
  </div>
</div>

<button class="fab" id="fab" aria-label="Sohbeti aç">
  <svg class="sohbet-ikon" viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>
  </svg>
  <svg class="kapat-ikon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
    <path d="M6 6l12 12M18 6L6 18"/>
  </svg>
  <span class="rozet"></span>
</button>
`;

  document.body.appendChild(host);

  const bul = (id) => kok.getElementById(id);
  const govdeEl = bul("govde");
  const mesajEl = bul("mesaj");
  const gonderBtn = bul("gonder");
  const noktaEl = bul("nokta");
  const durumEl = bul("durum");

  function el(etiket, sinif, metin) {
    const d = document.createElement(etiket);
    if (sinif) d.className = sinif;
    if (metin !== undefined) d.textContent = metin;
    return d;
  }

  function asagiKaydir() {
    govdeEl.scrollTop = govdeEl.scrollHeight;
  }

  function csvIndir(sonuc) {
    const kacir = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const satirlar = [sonuc.columns.map(kacir).join(";")];
    for (const satir of sonuc.rows) satirlar.push(satir.map(kacir).join(";"));
    // BOM: Excel'in Turkce karakterleri dogru okumasi icin.
    const blob = new Blob(["\ufeff" + satirlar.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sorgu-sonucu-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function karsilamaCiz() {
    const k = el("div", "karsilama");
    const ikon = el("div", "karsilama-ikon");
    ikon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/><circle cx="8.5" cy="11.5" r="1" fill="currentColor"/><circle cx="12" cy="11.5" r="1" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1" fill="currentColor"/></svg>';
    k.appendChild(ikon);
    k.appendChild(el("h3", null, "Merhaba 👋"));
    k.appendChild(el("p", null, ALTBASLIK));
    for (const ornek of ORNEKLER) {
      const b = el("button", "ornek", ornek);
      b.addEventListener("click", () => gonder(ornek));
      k.appendChild(b);
    }
    govdeEl.appendChild(k);
  }

  function sqlKutusuCiz(adim) {
    const kutu = el("div", "sql-kutu");

    const ust = el("button", "sql-ust");
    ust.appendChild(el("span", "ok", "▶"));
    ust.appendChild(el("span", "etiket", adim.description || "Çalıştırılan sorgu"));
    const rozet = el("span", "rozet-kucuk");
    if (adim.ok) {
      rozet.textContent = adim.row_count + " satır";
    } else {
      rozet.textContent = "hata";
      rozet.classList.add("hata");
    }
    ust.appendChild(rozet);
    ust.addEventListener("click", () => kutu.classList.toggle("acik"));
    kutu.appendChild(ust);

    const govde = el("div", "sql-govde");
    const pre = el("pre");
    pre.appendChild(el("code", null, adim.sql));
    govde.appendChild(pre);
    if (!adim.ok && adim.error) govde.appendChild(el("div", "sql-hata", adim.error));
    kutu.appendChild(govde);
    return kutu;
  }


  /* ---------- grafik ----------
     Sonuc iki kolonluysa ve biri sayisal, digeri etiketse cubuk grafik
     cizilebilir. Karar tamamen istemcide verilir; yapay zekaya sorulmaz,
     yani ek token harcamaz. */
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

  function grafikCiz(g) {
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
      kutu.appendChild(el("div", "grafik-not",
        g.toplamSatir + " satırın ilk 12'si gösteriliyor"));
    }
    return kutu;
  }

  function sonucCiz(sonuc) {
    const kutu = el("div", "sonuc");

    const ust = el("div", "sonuc-ust");
    ust.appendChild(el("span", null, sonuc.row_count + " satır · " + sonuc.columns.length + " kolon"));
    const g = grafikVerisi(sonuc);
    if (g) {
      const gBtn = el("button", "csv-buton", "Grafik");
      gBtn.addEventListener("click", () => {
        const grafikte = kutu.classList.toggle("grafik-modu");
        gBtn.textContent = grafikte ? "Tablo" : "Grafik";
      });
      ust.appendChild(gBtn);
    }
    const btn = el("button", "csv-buton", "Excel'e aktar");
    btn.addEventListener("click", () => csvIndir(sonuc));
    ust.appendChild(btn);
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
        } else if (typeof hucre === "number") {
          td.textContent = hucre.toLocaleString("tr-TR");
          td.className = "sayi";
        } else {
          td.textContent = String(hucre);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tablo.appendChild(tbody);
    sarici.appendChild(tablo);
    kutu.appendChild(sarici);

    if (g) kutu.appendChild(grafikCiz(g));

    if (sonuc.truncated) {
      kutu.appendChild(el("div", "uyari", "Sonuç " + sonuc.row_count + " satırda kesildi; sorunuzu daraltın."));
    }
    return kutu;
  }

  function mesajCiz(mesaj) {
    const sarici = el("div", "mesaj " + mesaj.rol);

    if (mesaj.rol === "kullanici") {
      sarici.appendChild(el("div", "balon", mesaj.metin));
      govdeEl.appendChild(sarici);
      return sarici;
    }
    if (mesaj.hata) {
      sarici.appendChild(el("div", "hata-kutu", mesaj.hata));
      govdeEl.appendChild(sarici);
      return sarici;
    }

    for (const adim of mesaj.steps || []) sarici.appendChild(sqlKutusuCiz(adim));
    if (mesaj.result && mesaj.result.columns && mesaj.result.columns.length) {
      sarici.appendChild(sonucCiz(mesaj.result));
    }
    if (mesaj.metin) sarici.appendChild(el("div", "balon", mesaj.metin));

    govdeEl.appendChild(sarici);
    return sarici;
  }

  function hepsiniCiz() {
    govdeEl.innerHTML = "";
    if (!mesajlar.length) {
      karsilamaCiz();
      return;
    }
    for (const mesaj of mesajlar) mesajCiz(mesaj);
    asagiKaydir();
  }

  async function gonder(metin) {
    metin = (metin || "").trim();
    if (bekliyor || !metin) return;

    bekliyor = true;
    gonderBtn.disabled = true;

    if (!mesajlar.length) govdeEl.innerHTML = "";
    const kullaniciMesaji = { rol: "kullanici", metin: metin };
    mesajlar.push(kullaniciMesaji);
    mesajCiz(kullaniciMesaji);
    mesajEl.value = "";
    mesajEl.style.height = "auto";
    asagiKaydir();

    const bekleyen = el("div", "mesaj asistan");
    const gosterge = el("div", "dusunuyor");
    gosterge.appendChild(el("span", "puls"));
    const yaziEl = el("span", null, "Sorgu hazırlanıyor…");
    gosterge.appendChild(yaziEl);
    bekleyen.appendChild(gosterge);
    govdeEl.appendChild(bekleyen);
    asagiKaydir();

    // Yanit 30 saniyeyi bulabiliyor (ozellikle Groq ucretsiz katmaninda).
    // Sayac olmadan arayuz donmus gibi gorunuyor.
    const baslangic = Date.now();
    const sayac = setInterval(() => {
      const saniye = Math.round((Date.now() - baslangic) / 1000);
      let yazi = "Sorgu hazırlanıyor… " + saniye + " sn";
      if (saniye >= 15) yazi += " (yoğunluk olabilir, bekleyin)";
      yaziEl.textContent = yazi;
    }, 1000);

    let cevap;
    try {
      const yanit = await fetch(API + "/api/sohbet", {
        method: "POST",
        headers: basliklar(true),
        body: JSON.stringify({ message: metin, session_id: oturumId }),
      });
      const veri = await yanit.json();
      if (!yanit.ok) {
        cevap = { rol: "asistan", hata: veri.detail || "Beklenmeyen bir hata oluştu." };
      } else {
        oturumId = veri.session_id;
        sessionStorage.setItem(ANAHTAR_OTURUM, oturumId);
        cevap = { rol: "asistan", metin: veri.answer, steps: veri.steps, result: veri.result };
      }
    } catch (err) {
      cevap = { rol: "asistan", hata: "Sunucuya ulaşılamadı: " + err.message };
    }

    clearInterval(sayac);
    bekleyen.remove();
    mesajlar.push(cevap);
    mesajCiz(cevap);
    mesajlariKaydet();
    asagiKaydir();

    bekliyor = false;
    gonderBtn.disabled = false;
    mesajEl.focus();
  }

  function panelDurumu() {
    host.classList.toggle("acik", acik);
    bul("fab").setAttribute("aria-label", acik ? "Sohbeti kapat" : "Sohbeti aç");
    sessionStorage.setItem(ANAHTAR_ACIK, acik ? "1" : "0");
    if (acik) {
      asagiKaydir();
      setTimeout(() => mesajEl.focus(), 220);
    }
  }

  bul("fab").addEventListener("click", () => { acik = !acik; panelDurumu(); });
  bul("kapatBtn").addEventListener("click", () => { acik = false; panelDurumu(); });
  bul("tamEkran").addEventListener("click", () => {
    // Sohbeti tam sayfa arayuze devret. localStorage sekmeler arasi paylasildigi
    // icin yeni sekme konusmayi oldugu yerden devam ettirir.
    try {
      localStorage.setItem("vtasistan.devir", JSON.stringify({
        oturum: oturumId,
        mesajlar: mesajlar.slice(-40),
      }));
    } catch (e) { /* kota dolduysa devirsiz ac */ }
    window.open((API || "") + "/tam", "_blank");
  });

  bul("temizle").addEventListener("click", async () => {
    try {
      await fetch(API + "/api/oturum/sifirla", {
        method: "POST",
        headers: basliklar(true),
        body: JSON.stringify({ session_id: oturumId }),
      });
    } catch (e) { /* sunucuya ulasilamasa da yerel gecmisi temizle */ }
    oturumId = null;
    mesajlar = [];
    sessionStorage.removeItem(ANAHTAR_OTURUM);
    sessionStorage.removeItem(ANAHTAR_MESAJ);
    hepsiniCiz();
  });

  kok.querySelector(".panel").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { acik = false; panelDurumu(); }
  });

  mesajEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      gonder(mesajEl.value);
    }
  });
  mesajEl.addEventListener("input", () => {
    mesajEl.style.height = "auto";
    mesajEl.style.height = Math.min(mesajEl.scrollHeight, 110) + "px";
  });
  gonderBtn.addEventListener("click", () => gonder(mesajEl.value));

  async function durumYukle() {
    try {
      const veri = await (await fetch(API + "/api/durum", { headers: basliklar(false) })).json();
      const ok = veri.database && veri.database.ok;
      noktaEl.className = "nokta " + (ok ? "acik" : "kapali");
      // Sunucu, aktif veritabanina uygun ornek sorulari bildirir.
      if (!ORNEK_ELLE_VERILDI && Array.isArray(veri.ornekler) && veri.ornekler.length) {
        ORNEKLER = veri.ornekler;
        if (!mesajlar.length) hepsiniCiz();   // karsilama ekranini tazele
      }
      if (ok && veri.api_key_var) {
        durumEl.textContent = veri.database.database;
        host.classList.add("hazir");
      } else if (ok) {
        durumEl.textContent = "API anahtarı eksik";
      } else {
        durumEl.textContent = "veritabanına bağlanılamadı";
      }
    } catch (e) {
      noktaEl.className = "nokta kapali";
      durumEl.textContent = "sunucuya ulaşılamıyor";
    }
  }

  hepsiniCiz();
  panelDurumu();
  durumYukle();

  // Sayfanin kendi butonlarindan widget'i kontrol etmek icin kucuk bir API.
  window.vtAsistan = {
    ac: function () { acik = true; panelDurumu(); },
    kapat: function () { acik = false; panelDurumu(); },
    sor: function (metin) { acik = true; panelDurumu(); gonder(metin); },
  };
})();
