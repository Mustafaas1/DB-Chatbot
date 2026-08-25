"""Soruyu bolum ajanlarina dagitan planlayici.

Kullanicinin tek sorusu birden fazla bolumu ilgilendirebilir:
"son bir ayda en cok alim yapan musteriler ve onlarin cirosu" gibi.
Planlayici soruyu adimlara ayirir ve her adimi bir ajana atar.

TOKEN NOTU: Planlayici cagrisina SEMA GONDERILMEZ; yalnizca ajan
aciklamalari ve soru gider (~250 token). Sema, adimlari calistiran
ajanlara gider.

Veri ceken adim sayisi bilincli olarak 2 ile sinirlidir: Groq ucretsiz
katmani dakikada 8000 token verir ve her veri adimi ~3300 token yer.
Ucuncu bir adim limiti asip kullaniciyi bekletirdi. Gorsellestirme
adimlari istemcide yapildigi icin bu sinira dahil degildir (0 token).
"""

from __future__ import annotations

import json
from typing import Any

from .ajanlar import Ajan, ajan_bul, ajanlari_getir

__all__ = ["Adim", "plan_yap", "AZAMI_VERI_ADIMI"]

AZAMI_VERI_ADIMI = 2
PLAN_BUTCESI = 300


class Adim:
    """Plandaki tek bir is adimi."""

    def __init__(self, ajan: Ajan, gorev: str, grafik: bool = False):
        self.ajan = ajan
        self.gorev = gorev
        self.grafik = grafik

    def to_dict(self) -> dict[str, Any]:
        return {
            "ajan": self.ajan.kod,
            "ajan_adi": self.ajan.ad,
            "renk": self.ajan.renk,
            "gorev": self.gorev,
            "grafik": self.grafik,
        }

    def __repr__(self) -> str:  # hata ayiklama kolayligi
        return f"Adim({self.ajan.kod}, {self.gorev!r}, grafik={self.grafik})"


def _talimat(ajanlar: list[Ajan]) -> str:
    satirlar = [
        "Kullanicinin sorusunu bolum ajanlarina dagitan bir planlayicisin.",
        "",
        "Ajanlar:",
    ]
    for a in ajanlar:
        satirlar.append(f"- {a.kod}: {a.aciklama}")
    satirlar += [
        "",
        "Kurallar:",
        f"- En fazla {AZAMI_VERI_ADIMI} adim uret. Soru tek bolumu ilgilendiriyorsa TEK adim yeter.",
        "- Soru iki farkli bolumun konusunu iceriyorsa IKI adima BOL.",
        "- Tek bolumun konusuysa TEK adim birak; bosuna bolme.",
        "- Her adimin 'gorev' alani, o ajana sorulacak tam bir Turkce soru olmalidir.",
        "- Listeleme gorevlerine ACIK bir sinir koy (ornegin 'ilk 10'); sinirsiz",
        "  listeler gereksiz token yakar.",
        "- Ikinci adim birinciye dayaniyorsa gorevinde bunu belirt.",
        "- Sonucu grafikle gosterilmesi anlamli olan adimda grafik=true yaz",
        "  (kategori/donem kirilimi gibi). Tek satirlik sonuclarda grafik=false.",
        "",
        'Yalnizca JSON dondur: {"adimlar":[{"ajan":"kod","gorev":"...","grafik":false}]}',
    ]
    return chr(10).join(satirlar)


# Bolme davranisini duzyazi kural yerine ornekle ogretiyoruz; model
# yalnizca metin talimatiyla soruyu tek adima sikistirma egilimindeydi.
ORNEKLER = [
    (
        "En cok kiralama yapan musterileri getir ve ne kadar harcadiklarini goster",
        {
            "adimlar": [
                {"ajan": "satis", "gorev": "En cok kiralama yapan ILK 10 musteriyi listele", "grafik": False},
                {"ajan": "finans", "gorev": "Bu 10 musterinin toplam harcamasini getir", "grafik": True},
            ]
        },
    ),
    (
        "En cok kiralanan 10 film hangileri?",
        {"adimlar": [{"ajan": "satis", "gorev": "En cok kiralanan 10 filmi listele", "grafik": True}]},
    ),
    (
        "Kategorilere gore film sayisi ve toplam ciro",
        {
            "adimlar": [
                {"ajan": "envanter", "gorev": "Kategorilere gore film sayisini getir (16 kategori)", "grafik": True},
                {"ajan": "finans", "gorev": "Kategorilere gore toplam ciroyu getir", "grafik": True},
            ]
        },
    ),
]


def _ornek_mesajlari() -> list[dict[str, str]]:
    mesajlar: list[dict[str, str]] = []
    for soru, plan in ORNEKLER:
        mesajlar.append({"role": "user", "content": soru})
        mesajlar.append(
            {"role": "assistant", "content": json.dumps(plan, ensure_ascii=False)}
        )
    return mesajlar


def _json_ayikla(metin: str) -> dict[str, Any] | None:
    """Model bazen JSON'u aciklama veya ``` blogu icinde dondurur."""
    if not metin:
        return None
    ham = metin.strip()
    if ham.startswith("```"):
        ham = ham.split("```")[1] if "```" in ham[3:] else ham[3:]
        if ham.lstrip().lower().startswith("json"):
            ham = ham.lstrip()[4:]
    bas, son = ham.find("{"), ham.rfind("}")
    if bas == -1 or son <= bas:
        return None
    try:
        return json.loads(ham[bas : son + 1])
    except json.JSONDecodeError:
        return None


def _tek_adim(soru: str, kod: str | None = None) -> list[Adim]:
    """Planlama yapilamadiginda guvenli varsayilan: tek ajan, sorunun kendisi."""
    return [Adim(ajan_bul(kod), soru)]


#: Plan onbellegi, SQL onbellegiyle ayni dosyayi bu ozel anahtar altinda kullanir.
PLAN_ANAHTARI = "__plan__"


def _plani_coz(ham: str, kodlar: set[str]) -> list[Adim]:
    """Saklanmis plan JSON'unu Adim listesine cevirir."""
    veri = _json_ayikla(ham) or {}
    adimlar: list[Adim] = []
    for h in (veri.get("adimlar") or [])[:AZAMI_VERI_ADIMI]:
        kod = str(h.get("ajan", "")).strip().lower()
        gorev = str(h.get("gorev", "")).strip()
        if kod in kodlar and gorev:
            adimlar.append(Adim(ajan_bul(kod), gorev, bool(h.get("grafik"))))
    return adimlar


def _plani_sakla(soru: str, adimlar: list[Adim]) -> None:
    from . import sqlcache

    ham = json.dumps(
        {"adimlar": [{"ajan": a.ajan.kod, "gorev": a.gorev, "grafik": a.grafik} for a in adimlar]},
        ensure_ascii=False,
    )
    sqlcache.yaz(soru, ham, PLAN_ANAHTARI)


def plan_yap(soru: str, client=None) -> list[Adim]:
    """Soruyu adimlara ayirir.

    Planlama basarisiz olursa (model cevap veremedi, JSON bozuk, ajan kodu
    taninmadi) tek adimli guvenli plana duser -- kullanici cevapsiz kalmaz.
    """
    ajanlar = ajanlari_getir()
    if len(ajanlar) < 2:
        return _tek_adim(soru, ajanlar[0].kod)

    kodlar = {a.kod for a in ajanlar}

    # Ayni soru daha once planlandiysa planlayici cagrisini atla (~450 token).
    from . import sqlcache

    saklanan = sqlcache.getir(soru, PLAN_ANAHTARI)
    if saklanan:
        onbellekten = _plani_coz(saklanan, kodlar)
        if onbellekten:
            return onbellekten

    if client is None:
        from .llm import get_groq_client

        client = get_groq_client()

    from .config import settings

    try:
        yanit = client.chat.completions.create(
            model=settings.groq_model,
            max_tokens=PLAN_BUTCESI,
            temperature=0,
            messages=[
                {"role": "system", "content": _talimat(ajanlar)},
                *_ornek_mesajlari(),
                {"role": "user", "content": soru},
            ],
        )
    except Exception:  # noqa: BLE001 - planlama basarisizsa akis surmeli
        return _tek_adim(soru)

    veri = _json_ayikla(yanit.choices[0].message.content or "")
    if not veri or not isinstance(veri.get("adimlar"), list):
        return _tek_adim(soru)

    adimlar: list[Adim] = []
    for ham in veri["adimlar"][:AZAMI_VERI_ADIMI]:
        if not isinstance(ham, dict):
            continue
        kod = str(ham.get("ajan", "")).strip().lower()
        gorev = str(ham.get("gorev", "")).strip()
        if kod not in kodlar or not gorev:
            continue
        adimlar.append(Adim(ajan_bul(kod), gorev, bool(ham.get("grafik"))))

    if adimlar:
        _plani_sakla(soru, adimlar)
    return adimlar or _tek_adim(soru)
