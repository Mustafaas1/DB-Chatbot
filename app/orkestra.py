"""Ajan zincirini yuruten orkestratör.

Kullanicinin tek sorusu planlayici tarafindan adimlara ayrilir; her adim
kendi bolum ajaniyla calistirilir. Sonraki adim, oncekinin BULGUSUNU
(cevap metni + sonuc satirlari) baglam olarak alir -- "bu musterilerin
harcamasi" gibi gorevler ancak boyle anlam kazanir.

Token: her veri adimi ~3300 token. Planlayici adim sayisini 2 ile
sinirlar; grafik adimlari istemcide cizildigi icin bedavadir.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

from .ajanlar import ajanlari_getir
from .analiz import analiz_yap
from .config import settings
from .llm import ChatCevabi, sohbet_et
from .planlayici import Adim, plan_yap
from .tetikleyici import sonraki_adim

__all__ = ["akis_calistir", "akis_uret"]

#: Zincirdeki bir adimin deneyebilecegi azami sorgu turu.
#: Genel sohbette 6 makul, ama zincirde basarisiz bir adim iki katina cikan
#: bir maliyet demek: olculen bir basarisizlik 6 turda 24.700 token yakti.
#: Planlayici isi zaten bolduğu icin adim basina 3 tur yetiyor.
ZINCIR_TUR_SINIRI = 3

#: Sonraki adima aktarilacak ornek satir sayisi. Buyutmek token yakar.
DEVIR_SATIRI = 5
#: Onceki cevabin aktarilacak kismi.
DEVIR_METNI = 300


#: Modelin bazen ekledigi, her satirda ayni degeri tasiyan sozde etiket kolonu.
#: Talimatla engellenemedi (uc kez denendi), bu yuzden kodda ayikliyoruz.
SOZDE_ETIKET_ADLARI = {"etiket", "label", "grup", "kategori etiketi"}


def _sonucu_temizle(sonuc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Bilgi tasimayan sozde etiket kolonlarini sonuctan cikarir.

    Yalnizca adi 'Etiket' benzeri OLAN ve her satirda ayni degeri tasiyan
    kolonlar atilir. Gercekten sabit cikan anlamli kolonlar (orn. tek para
    birimi donen bir sorguda 'Para Birimi') adlari farkli oldugu icin korunur.
    """
    if not sonuc or not sonuc.get("columns") or not sonuc.get("rows"):
        return sonuc

    kolonlar = sonuc["columns"]
    satirlar = sonuc["rows"]
    if len(satirlar) < 2:
        return sonuc

    atilacak = [
        i for i, ad in enumerate(kolonlar)
        if str(ad).strip().lower() in SOZDE_ETIKET_ADLARI
        and len({s[i] for s in satirlar}) == 1
    ]
    if not atilacak or len(atilacak) == len(kolonlar):
        return sonuc

    tut = [i for i in range(len(kolonlar)) if i not in atilacak]
    return {
        **sonuc,
        "columns": [kolonlar[i] for i in tut],
        "rows": [[s[i] for i in tut] for s in satirlar],
    }


#: Ozet cumlesinin azami uzunlugu. Model talimatla kisaltilamadi (bes kez
#: denendi; ya kisalmadi ya baska bir yeri bozdu), bu yuzden uzunluk KODDA
#: garanti altina aliniyor.
OZET_AZAMI_HARF = 150


def _ilk_cumle(metin: str) -> str:
    """Cevabin yalnizca ilk cumlesini birakir.

    Model iki-uc cumle yazip tablodaki rakamlari tekrarliyordu. Ilk cumle
    genel resmi veriyor; gerisi zaten grafikte ve tabloda.
    """
    if not metin:
        return metin
    duz = " ".join(metin.split())

    # Cumle sonu: . ! ? ve ardindan bosluk ya da metin sonu.
    for i, karakter in enumerate(duz):
        if karakter in ".!?":
            if i + 1 >= len(duz) or duz[i + 1] == " ":
                duz = duz[: i + 1]
                break

    if len(duz) > OZET_AZAMI_HARF:
        kesme = duz.rfind(" ", 0, OZET_AZAMI_HARF)
        duz = duz[: kesme if kesme > 0 else OZET_AZAMI_HARF].rstrip(" ,;:") + "…"
    return duz


SAYI_DESENI = re.compile(r"\d[\d.,\s]*\d|\d")
BIRIM_DESENI = re.compile(r"(para ?birim|birim|currency|kur)", re.I)


def _sayi_adedi(metin: str) -> int:
    return len(SAYI_DESENI.findall(metin))


def _birim_dagilimi(sonuc) -> list[str]:
    """Sonuctaki birim kolonunun degerlerini, olcuye gore buyukten kucuge verir.

    Ornek: ["TRY", "USD"] -- TRY toplami daha buyuk oldugu icin basta.
    """
    if not sonuc or not getattr(sonuc, "rows", None) or len(sonuc.rows) < 2:
        return []
    kolonlar = sonuc.columns

    birim = next(
        (i for i, ad in enumerate(kolonlar)
         if BIRIM_DESENI.search(str(ad)) and len({s[i] for s in sonuc.rows}) > 1),
        None,
    )
    if birim is None:
        return []

    olculer = [
        i for i, ad in enumerate(kolonlar)
        if i != birim
        and all(isinstance(s[i], (int, float)) and not isinstance(s[i], bool) for s in sonuc.rows)
    ]
    if not olculer:
        return []
    olcu = olculer[-1]

    toplamlar: dict[str, float] = {}
    for satir in sonuc.rows:
        toplamlar[str(satir[birim])] = toplamlar.get(str(satir[birim]), 0) + satir[olcu]
    return [k for k, _ in sorted(toplamlar.items(), key=lambda x: -x[1])]


def _kod_cumlesi(sonuc) -> str:
    """Model cumlesi kullanilamadiginda veriden dogrudan cumle kurar."""
    birimler = _birim_dagilimi(sonuc)
    if len(birimler) >= 2:
        return f"{birimler[0]}, {', '.join(birimler[1:])}'ye göre oldukça fazla."

    if not sonuc or not getattr(sonuc, "rows", None):
        return ""
    kolonlar = sonuc.columns
    olculer = [
        i for i, _ in enumerate(kolonlar)
        if all(isinstance(s[i], (int, float)) and not isinstance(s[i], bool) for s in sonuc.rows)
    ]
    if len(olculer) != 1:
        return ""
    toplam = sum(s[olculer[0]] for s in sonuc.rows)
    bicim = f"{toplam:,.2f}".rstrip("0").rstrip(".") if isinstance(toplam, float) else f"{toplam:,}"
    return f"{kolonlar[olculer[0]]} toplamı {bicim} ({len(sonuc.rows)} grup)."


def _rakam_yigilmasini_at(cumle: str, sonuc) -> str:
    """Cumleden rakam dokumunu ayiklar.

    Model "151 teklif var; TRY'de 44.580.647,07 TL, USD'de 7.026,70 USD."
    gibi yaziyordu; tutarlar zaten grafikte ve tabloda. Noktali virgulle
    ayrilmis parcalardan yalnizca EN FAZLA BIR sayi icerenler tutulur,
    karisik para birimi varsa yerine niteliksel karsilastirma eklenir.
    """
    parcalar = [p.strip() for p in cumle.rstrip(".").split(";") if p.strip()]
    if not parcalar:
        return cumle

    tutulan = [p for p in parcalar if _sayi_adedi(p) <= 1]
    atilan = len(tutulan) < len(parcalar)

    if not tutulan:
        # Cumle noktali virgulle bolunemiyor ve rakam dokuyor
        # ("Teklifler 103, 32, 14 ve 2 adet." gibi). Model cumlesini
        # kurtarmaya calismak yerine koddan uretilmis cumleye dusuyoruz.
        return _kod_cumlesi(sonuc) or cumle

    birimler = _birim_dagilimi(sonuc)
    if atilan and len(birimler) >= 2:
        digerleri = ", ".join(birimler[1:])
        tutulan.append(f"{birimler[0]}, {digerleri}'ye göre oldukça fazla")

    return "; ".join(tutulan) + "."


def _devir_metni(cevap: ChatCevabi) -> str:
    """Bir adimin bulgusunu sonraki adima anlatan kompakt metin."""
    parcalar = [cevap.cevap[:DEVIR_METNI].strip()]
    sonuc = cevap.son_sonuc
    if sonuc is not None and sonuc.rows:
        parcalar.append(" | ".join(sonuc.columns))
        for satir in sonuc.rows[:DEVIR_SATIRI]:
            parcalar.append(" | ".join("NULL" if h is None else str(h) for h in satir))
        if sonuc.row_count > DEVIR_SATIRI:
            parcalar.append(f"... (toplam {sonuc.row_count} satir)")
    return chr(10).join(parcalar)


#: Grafik cizilebilmesi icin sonucun bicimi hakkinda ajana verilen yonerge.
#: Bu olmadan ajan "customer_id, toplam, adet" gibi tamami sayisal bir sonuc
#: dondurebiliyor; o zaman cizilecek bir etiket kolonu kalmiyor.
GRAFIK_YONERGESI = (
    "Sonuc grafikle de gosterilebilir; kolonlara Turkce takma ad ver. "
    "Sorulan kirilimin DISINDA ek kirilim (donem, ay, bolge gibi) EKLEME -- "
    "yalnizca sorulan sey gruplansin. Sonuca 'Etiket' adinda sabit degerli "
    "bir kolon EKLEME. Birden fazla sayisal olcu gerekiyorsa hepsini dondur; "
    "grafik sonuncusunu kullanir. Bu bicim tercihi yuzunden sorguyu "
    "calistirmadan birakma veya kullaniciya soru sorma -- once sorguyu calistir."
)


def _gorev_metni(adim: Adim, devir: str) -> str:
    gorev = adim.gorev
    if adim.grafik:
        gorev = gorev + chr(10) * 2 + GRAFIK_YONERGESI
    if not devir:
        return gorev
    parcalar = [
        gorev,
        "--- ONCEKI ADIMIN BULGUSU ---" + chr(10) + devir,
    ]
    # Adimi bir tetik getirdiyse gerekcesini de veriyoruz: ajan neye
    # bakmasi gerektigini bilmeden bulguyu yanlis yorumlayabiliyor.
    if adim.gerekce:
        parcalar.append("BU ADIMIN GEREKCESI: " + adim.gerekce)
    parcalar.append("Bu bulguyu kullanarak kendi bolumunun sorusunu cevapla.")
    return (chr(10) * 2).join(parcalar)


def akis_uret(
    soru: str, gecmis: list[dict[str, Any]] | None = None
) -> Iterator[dict[str, Any]]:
    """Zinciri adim adim uretir.

    Once plani, sonra her adimi tamamlandikca yayinlar. Boylece arayuz ilk
    ajanin sonucunu, ikincisi calisirken gosterebilir -- zincirli sorular
    30 saniyeyi bulabildigi icin bu bekleme hissini belirgin sekilde kisaltir.

    Son olarak "bitti" kaydi gelir; icinde toplam kullanim ve saklanacak
    oturum gecmisi bulunur.
    """
    plan = plan_yap(soru)

    # Dinamik zincir: adimlari bulgular kurar. Planlayici yalnizca GIRIS
    # noktasini verir; sonraki her adimi, biten adimin sonucuna bakan
    # tetikleyici secer. Kapaliyken eski davranis (statik plan) surer.
    dinamik = settings.zincir_dinamik and len(ajanlari_getir()) > 1
    if dinamik:
        plan = plan[:1]
    azami = settings.zincir_azami_adim if dinamik else len(plan)

    yield {
        "tur": "plan",
        "dinamik": dinamik,
        "azami_adim": azami,
        "adimlar": [a.to_dict() for a in plan],
        "ajanlar": [
            {"kod": a.kod, "ad": a.ad, "renk": a.renk, "ornekler": a.ornekler}
            for a in ajanlari_getir()
        ],
    }

    toplam = {"input_tokens": 0, "output_tokens": 0}
    devir = ""
    # Konusma surekliligi: gecmis YALNIZCA ilk adima verilir. Sonraki adimlar
    # zaten oncekinin bulgusunu devir metniyle aliyor.
    son_gecmis = list(gecmis or [])

    kuyruk: list[Adim] = list(plan)
    kullanilmis: list[str] = []
    sira = 0

    onceki_tablolar: set[str] = set()

    while kuyruk and sira < azami:
        adim = kuyruk.pop(0)
        sira += 1
        kullanilmis.append(adim.ajan.kod)

        cevap = sohbet_et(
            _gorev_metni(adim, devir),
            gecmis if sira == 1 else None,
            ajan=adim.ajan,
            azami_tur=ZINCIR_TUR_SINIRI,
            # Tetiklenen adim onceki adimin bulgusunu inceleyecegi icin
            # o adimin tablolarini da gormeli; yoksa "boyle bir tablo
            # yok" deyip bos donuyor.
            ek_tablolar=onceki_tablolar,
        )
        son_gecmis = cevap.gecmis

        toplam["input_tokens"] += cevap.kullanim.get("input_tokens", 0)
        toplam["output_tokens"] += cevap.kullanim.get("output_tokens", 0)

        cevap_metni = (
            _rakam_yigilmasini_at(_ilk_cumle(cevap.cevap), cevap.son_sonuc)
            if cevap.tamamlandi else cevap.cevap
        )
        temiz_sonuc = _sonucu_temizle(
            cevap.son_sonuc.to_dict() if (cevap.son_sonuc and cevap.tamamlandi) else None
        )

        yield {
            "tur": "adim",
            "sira": sira,
            # Dinamik zincirde toplam adim sayisi ONCEDEN BILINMEZ; arayuz
            # "1/2" yerine "Adim 1" gosterir.
            "toplam_adim": 0 if dinamik else len(plan),
            "dinamik": dinamik,
            **adim.to_dict(),
            # Uzunluk ve rakam yigilmasi kodda sinirlanir; talimata
            # birakildiginda tutmuyordu.
            "answer": cevap_metni,
            "steps": cevap.adimlar,
            # Adim yarida kaldiysa elde kalan sonuc basarisiz bir denemeye ait
            # olabilir; arayuze gecerli sonuc gibi gondermiyoruz.
            "tamamlandi": cevap.tamamlandi,
            "result": temiz_sonuc,
            "usage": cevap.kullanim,
        }

        # --- Analiz katmani ---
        # Adim tamamlandiysa veriye dayali coklu analiz uret (yorum/cozum/risk).
        # Analiz tek LLM cagrisinda 3 bolumlu JSON olarak gelir; token maliyeti
        # ~400-600 token.
        if cevap.tamamlandi and temiz_sonuc:
            analiz = analiz_yap(
                soru=soru,
                cevap_metni=cevap_metni,
                sonuc=temiz_sonuc,
                ajan_kodu=adim.ajan.kod,
            )
            if not analiz.bos_mu():
                toplam["input_tokens"] += analiz.kullanim.get("input_tokens", 0)
                toplam["output_tokens"] += analiz.kullanim.get("output_tokens", 0)
                yield {
                    "tur": "analiz",
                    "sira": sira,
                    **analiz.to_dict(),
                }

        # Yarida kalan adimin bulgusu guvenilir degil; sonrakine devretme.
        devir = _devir_metni(cevap) if cevap.tamamlandi else ""
        # Bulguyu devrederken tablolarini da devret: sonraki adim bu
        # bulguyu ancak kaynagini gorebilirse yorumlayabilir.
        onceki_tablolar = set(adim.ajan.tablolar or ())

        # --- Tetik katmani ---
        # Biten adimin bulgusu baska bir bolumun alanini ilgilendiriyor mu?
        # Ilgilendiriyorsa zincire yeni adim eklenir ve GEREKCESI yayinlanir;
        # kullanici zincirin neden boyle kuruldugunu gorur.
        if dinamik and sira < azami and cevap.tamamlandi and temiz_sonuc:
            karar = sonraki_adim(
                soru=soru,
                biten=adim,
                cevap_metni=cevap_metni,
                sonuc=temiz_sonuc,
                kullanilmis=kullanilmis,
            )
            # Tetigin kendi maliyeti de kullaniciya gorunsun.
            toplam["input_tokens"] += karar.kullanim.get("input_tokens", 0)
            toplam["output_tokens"] += karar.kullanim.get("output_tokens", 0)

            if karar.durum in ("kota", "hata"):
                # Zincir teknik bir nedenle durdu. Sessizce durmak yaniltici:
                # kullanici zincirin dogal olarak bittigini saniyordu.
                yield {
                    "tur": "zincir_durdu",
                    "sira": sira,
                    "sebep": karar.durum,
                    "mesaj": (
                        "Zincir burada durdu: yapay zeka kotasi doldu. "
                        "Yukaridaki adimlarin sonuclari gecerlidir."
                        if karar.durum == "kota"
                        else "Zincir burada durdu: sonraki adim belirlenemedi. "
                             "Yukaridaki adimlarin sonuclari gecerlidir."
                    ),
                }

            if karar.devam:
                yield {
                    "tur": "tetik",
                    "sira": sira + 1,
                    "kaynak": adim.ajan.kod,
                    "kaynak_adi": adim.ajan.ad,
                    "kaynak_renk": adim.ajan.renk,
                    "hedef": karar.adim.ajan.kod,
                    "hedef_adi": karar.adim.ajan.ad,
                    "hedef_renk": karar.adim.ajan.renk,
                    "gerekce": karar.gerekce,
                    "gorev": karar.adim.gorev,
                }
                kuyruk.append(karar.adim)

    yield {"tur": "bitti", "usage": toplam, "gecmis": son_gecmis}


def akis_calistir(soru: str, gecmis: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Zinciri bastan sona calistirip tek parca sonuc dondurur.

    Akisi desteklemeyen istemciler icin akis_uret() uzerine ince bir sarmalayici.
    """
    adimlar: list[dict[str, Any]] = []
    ajanlar: list[dict[str, Any]] = []
    toplam: dict[str, int] = {"input_tokens": 0, "output_tokens": 0}
    son_gecmis: list[dict[str, Any]] = []

    for kayit in akis_uret(soru, gecmis):
        if kayit["tur"] == "plan":
            ajanlar = kayit["ajanlar"]
        elif kayit["tur"] == "adim":
            adimlar.append({k: v for k, v in kayit.items() if k != "tur"})
        elif kayit["tur"] == "analiz":
            # Analizi ilgili adıma ekle
            sira = kayit.get("sira", 0)
            for a in adimlar:
                if a.get("sira") == sira:
                    a["analiz"] = {
                        "yorum": kayit.get("yorum", ""),
                        "cozum": kayit.get("cozum", ""),
                        "risk": kayit.get("risk", ""),
                    }
                    break
        elif kayit["tur"] == "bitti":
            toplam = kayit["usage"]
            son_gecmis = kayit["gecmis"]

    return {
        "soru": soru,
        "gecmis": son_gecmis,
        "adimlar": adimlar,
        "ajanlar": ajanlar,
        "usage": toplam,
    }
