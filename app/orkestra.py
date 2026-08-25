"""Ajan zincirini yuruten orkestratör.

Kullanicinin tek sorusu planlayici tarafindan adimlara ayrilir; her adim
kendi bolum ajaniyla calistirilir. Sonraki adim, oncekinin BULGUSUNU
(cevap metni + sonuc satirlari) baglam olarak alir -- "bu musterilerin
harcamasi" gibi gorevler ancak boyle anlam kazanir.

Token: her veri adimi ~3300 token. Planlayici adim sayisini 2 ile
sinirlar; grafik adimlari istemcide cizildigi icin bedavadir.
"""

from __future__ import annotations

from typing import Any

from .ajanlar import ajanlari_getir
from .llm import ChatCevabi, sohbet_et
from .planlayici import Adim, plan_yap

__all__ = ["akis_calistir"]

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


def _gorev_metni(adim: Adim, devir: str) -> str:
    if not devir:
        return adim.gorev
    return (
        f"{adim.gorev}"
        + chr(10) * 2
        + "--- ONCEKI ADIMIN BULGUSU ---"
        + chr(10)
        + devir
        + chr(10) * 2
        + "Bu bulguyu kullanarak kendi bolumunun sorusunu cevapla."
    )


def akis_calistir(soru: str, gecmis: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Soruyu ajan zinciri olarak calistirir ve adim adim sonuc dondurur."""
    plan = plan_yap(soru)

    adim_sonuclari: list[dict[str, Any]] = []
    toplam = {"input_tokens": 0, "output_tokens": 0}
    devir = ""
    # Konusma surekliligi: gecmis YALNIZCA ilk adima verilir. Sonraki adimlar
    # zaten oncekinin bulgusunu devir metniyle aliyor; gecmisi de eklemek
    # token'i ikiye katlardi.
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

        adim_sonuclari.append(
            {
                "sira": sira,
                **adim.to_dict(),
                "answer": cevap.cevap,
                "steps": cevap.adimlar,
                "result": cevap.son_sonuc.to_dict() if cevap.son_sonuc else None,
                "usage": cevap.kullanim,
            }
        )
        devir = _devir_metni(cevap)

    return {
        "soru": soru,
        "gecmis": son_gecmis,
        "adimlar": adim_sonuclari,
        "ajanlar": [
            {"kod": a.kod, "ad": a.ad, "renk": a.renk, "ornekler": a.ornekler}
            for a in ajanlari_getir()
        ],
        "usage": toplam,
    }
