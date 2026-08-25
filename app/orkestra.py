"""Ajan zincirini yuruten orkestratör.

Kullanicinin tek sorusu planlayici tarafindan adimlara ayrilir; her adim
kendi bolum ajaniyla calistirilir. Sonraki adim, oncekinin BULGUSUNU
(cevap metni + sonuc satirlari) baglam olarak alir -- "bu musterilerin
harcamasi" gibi gorevler ancak boyle anlam kazanir.

Token: her veri adimi ~3300 token. Planlayici adim sayisini 2 ile
sinirlar; grafik adimlari istemcide cizildigi icin bedavadir.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from .ajanlar import ajanlari_getir
from .llm import ChatCevabi, sohbet_et
from .planlayici import Adim, plan_yap

__all__ = ["akis_calistir", "akis_uret"]

#: Sonraki adima aktarilacak ornek satir sayisi. Buyutmek token yakar.
DEVIR_SATIRI = 5
#: Onceki cevabin aktarilacak kismi.
DEVIR_METNI = 300


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
    "Bu adimin sonucu GRAFIKLE gosterilecek. Sonucu buna gore bicimlendir: "
    "bir ETIKET kolonu (isim, kategori, donem gibi metin) ve TEK bir sayisal "
    "olcu kolonu dondur. Kimlik (ID) kolonu EKLEME. Kolonlara Turkce takma ad ver."
)


def _gorev_metni(adim: Adim, devir: str) -> str:
    gorev = adim.gorev
    if adim.grafik:
        gorev = gorev + chr(10) * 2 + GRAFIK_YONERGESI
    if not devir:
        return gorev
    return (
        gorev
        + chr(10) * 2
        + "--- ONCEKI ADIMIN BULGUSU ---"
        + chr(10)
        + devir
        + chr(10) * 2
        + "Bu bulguyu kullanarak kendi bolumunun sorusunu cevapla."
    )


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

    yield {
        "tur": "plan",
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

    for sira, adim in enumerate(plan, start=1):
        cevap = sohbet_et(
            _gorev_metni(adim, devir),
            gecmis if sira == 1 else None,
            ajan=adim.ajan,
        )
        son_gecmis = cevap.gecmis

        toplam["input_tokens"] += cevap.kullanim.get("input_tokens", 0)
        toplam["output_tokens"] += cevap.kullanim.get("output_tokens", 0)

        yield {
            "tur": "adim",
            "sira": sira,
            "toplam_adim": len(plan),
            **adim.to_dict(),
            "answer": cevap.cevap,
            "steps": cevap.adimlar,
            "result": cevap.son_sonuc.to_dict() if cevap.son_sonuc else None,
            "usage": cevap.kullanim,
        }
        devir = _devir_metni(cevap)

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
        else:
            toplam = kayit["usage"]
            son_gecmis = kayit["gecmis"]

    return {
        "soru": soru,
        "gecmis": son_gecmis,
        "adimlar": adimlar,
        "ajanlar": ajanlar,
        "usage": toplam,
    }
