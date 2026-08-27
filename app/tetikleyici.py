"""Ajanlar arası tetikleme: zinciri sonuçlara bakarak büyüten katman.

Planlayıcı zinciri en baştan, yalnızca soruya bakarak kurar. Bu katman ise
bir adım BİTTİKTEN sonra devreye girer: elde edilen bulguya bakıp
"bu sonuç başka hangi bölümün alanını ilgilendiriyor?" sorusunu cevaplar ve
gerekiyorsa zincire yeni bir adım ekler.

Amaç, tek bir sorudan neden-sonuç zinciri kurmak:

    "Destek yükümüzü nasıl azaltırız?"
      → Destek: bekleyen biletleri aşamalara göre say          (bulgu: %80 beklemede)
      → Proje: bu biletlerin bağlı olduğu tamamlanmamış görevler (tetik: yığılmanın kaynağı)
      → İK:    yükün kişi başına dağılımı                       (tetik: kapasite sorunu mu?)

Her tetik bir GEREKÇE taşır; arayüz bunu adımlar arasında gösterir, böylece
kullanıcı zincirin neden böyle kurulduğunu görür.

TOKEN NOTU: Tetik kararı tek ve küçük bir LLM çağrısıdır (~400-600 token);
şemayı görmez. Asıl maliyet, tetiğin başlattığı veri adımıdır (~3300 token).
Bu yüzden zincir uzunluğu ZINCIR_AZAMI_ADIM ile sınırlıdır.
"""

from __future__ import annotations

import json
from typing import Any

import openai

from .ajanlar import Ajan, ajan_bul, ajanlari_getir
from .config import settings
from .planlayici import Adim, _json_ayikla

__all__ = ["TetikKarari", "sonraki_adim"]

#: Tetik kararının çıktı bütçesi. gpt-oss modellerinde "reasoning" çıktısı da
#: bu bütçeden yendiği için geniş tutuluyor; dar bırakınca JSON yarıda kesilip
#: zincir sessizce duruyordu.
TETIK_BUTCESI = 700

#: Bulgudan tetiğe taşınan örnek satır sayısı.
BULGU_SATIRI = 6


class TetikKarari:
    """Bir adım bittikten sonra verilen 'devam et / dur' kararı.

    ``durum`` zincirin NEDEN durduğunu ayırır:
      - "devam" : zincir uzuyor
      - "dur"   : model "yeni adım katkı yapmaz" dedi (normal bitiş)
      - "kota"  : API kotası doldu (teknik durma; kullanıcıya bildirilir)
      - "hata"  : model cevap veremedi / çıktı bozuk (teknik durma)
    """

    def __init__(
        self,
        adim: Adim | None,
        gerekce: str = "",
        durum: str = "dur",
        kullanim: dict[str, int] | None = None,
    ):
        self.adim = adim
        self.gerekce = gerekce
        self.durum = "devam" if adim is not None else durum
        #: Tetik kararının kendi token maliyeti. Toplama eklenmezse kullanıcı
        #: harcadığı tokenin bir kısmını hiç göremiyordu.
        self.kullanim = kullanim or {"input_tokens": 0, "output_tokens": 0}

    @property
    def devam(self) -> bool:
        return self.adim is not None


def _talimat(adaylar: list[Ajan]) -> str:
    satirlar = [
        "Bir bolum ajani isini bitirdi. Sen zincir yonlendiricisisin.",
        "Elde edilen BULGUYA bakarak, kullanicinin ASIL sorusunu daha iyi",
        "cevaplamak icin baska bir bolum ajaninin devreye girmesi gerekip",
        "gerekmedigine karar vereceksin.",
        "",
        "Devreye alabilecegin ajanlar:",
    ]
    for a in adaylar:
        satirlar.append(f"- {a.kod}: {a.aciklama}")
        if a.tablolar:
            satirlar.append("  tablolari: " + ", ".join(sorted(a.tablolar)))
    satirlar += [
        "",
        "Kurallar:",
        "- Zinciri NEDEN-SONUC iliskisiyle kur. Yeni adim, bulgunun ortaya",
        "  cikardigi bir soruyu cevaplamali; alakasiz bir konuya atlama.",
        "- Yeni adim asil soruyu cevaplamaya GERCEKTEN katki yapmiyorsa dur.",
        "  Zinciri uzatmak icin uzatma; emin degilsen devam=false.",
        "- 'gorev' o ajana sorulacak TAM bir Turkce soru olmali.",
        "- ONEMLI: Bulgu yeni adima BAGLAM verir, JOIN ANAHTARI DEGILDIR.",
        "  Gorev, secilen ajanin YUKARIDA LISTELENEN kendi tablolariyla",
        "  tek basina cevaplanabilmeli. Iki bolumun tablolari arasinda",
        "  iliski oldugunu VARSAYMA; cogunda yoktur.",
        "  YANLIS: 'acik biletlere neden olan proje gorevlerini say'",
        "          (bilet ile gorev tablosu birbirine baglanmaz)",
        "  DOGRU : 'tamamlanmamis proje gorevlerini durumlarina gore say'",
        "          (yalnizca proje tablolari yeter)",
        "- Gorev TEK amacli olsun: ya SAYMA/TOPLAMA (gruplu ozet) ya da LISTELEME.",
        "- Yalnizca LISTELEME gorevlerine sinir koy (ornegin 'ilk 10').",
        "- 'gerekce' TEK cumle olsun ve bulguyla yeni adim arasindaki bagi",
        "  kursun: 'X cikti, bu yuzden Y'ye bakiyoruz' gibi.",
        "- Kirilimli/kategorili sonuc bekleniyorsa grafik=true.",
        "- Yalnizca yukarida listelenen ajan kodlarindan birini sec.",
        "",
        'Yalnizca JSON dondur:',
        '{"devam": true, "ajan": "kod", "gorev": "...", "gerekce": "...", "grafik": true}',
        'veya {"devam": false}',
    ]
    return chr(10).join(satirlar)


# Zincir kurmayi duzyazi kuralla ogretmek yetmedi; model ya her seferinde
# duruyor ya da alakasiz ajana atliyordu. Ornekler neden-sonuc bagini gosteriyor.
ORNEKLER = [
    (
        "ASIL SORU: Destek yukumuzu nasil azaltiriz?\n"
        "BITEN ADIM: destek -- Acik biletleri asamalarina gore say\n"
        "BULGU: Acik 59 biletin 47'si Beklemede, 12'si Islemde.\n"
        "Asama | Adet\nBeklemede | 47\nIslemde | 12\n"
        "DAHA ONCE CALISAN AJANLAR: destek",
        {
            "devam": True,
            "ajan": "proje",
            "gorev": "Tamamlanmamis proje gorevlerini durumlarina gore say",
            "gerekce": "Biletlerin %80'i beklemede takildi; yiginin arkasinda bitmemis proje gorevleri olabilir.",
            "grafik": True,
        },
    ),
    (
        "ASIL SORU: Bu ceyrek cironuzu nasil artirirsiniz?\n"
        "BITEN ADIM: satis -- Teklifleri durumlarina gore say\n"
        "BULGU: 151 teklifin 103'u Gonderildi, 32'si Kazanildi.\n"
        "Durum | Adet\nGonderildi | 103\nKazanildi | 32\n"
        "DAHA ONCE CALISAN AJANLAR: satis",
        {
            "devam": True,
            "ajan": "finans",
            "gorev": "Gonderildi durumundaki tekliflerin toplam tutarini para birimine gore getir",
            "gerekce": "Bekleyen 103 teklif ciro potansiyeli; once bu potansiyelin parasal buyuklugunu olcuyoruz.",
            "grafik": True,
        },
    ),
    (
        # Ayni bulgu, ama 'asil soru' duz bir veri sorusu. Model burada
        # 'biletlere BAGLI proje gorevleri' gibi join gerektiren bir gorev
        # yaziyordu; iki tablo birbirine baglanmadigi icin adim bos donuyordu.
        # Duzyazi kural bu girdide tutmadi, ornek gerekti.
        "ASIL SORU: Asamalarina gore acik destek biletleri\n"
        "BITEN ADIM: destek -- Acik destek biletlerini asamalarina gore say\n"
        "BULGU: Su anda 59 acik destek bileti var.\n"
        "Asama | Bilet Sayisi\nBeklemede | 47\nIslemde | 12\n"
        "DAHA ONCE CALISAN AJANLAR: destek",
        {
            "devam": True,
            "ajan": "proje",
            "gorev": "Tamamlanmamis proje gorevlerini durumlarina gore say",
            "gerekce": "Biletlerin cogu beklemede; ayni donemde bitmemis proje gorevlerinin dagilimi yuku aciklayabilir.",
            "grafik": True,
        },
    ),
    (
        "ASIL SORU: Izin turlerine gore talep sayisi\n"
        "BITEN ADIM: ik -- Izin taleplerini turlerine gore say\n"
        "BULGU: Yillik 120, Mazeret 34, Ucretsiz 8.\n"
        "Tur | Adet\nYillik | 120\nMazeret | 34\nUcretsiz | 8\n"
        "DAHA ONCE CALISAN AJANLAR: ik",
        {"devam": False},
    ),
]


def _ornek_mesajlari() -> list[dict[str, str]]:
    mesajlar: list[dict[str, str]] = []
    for girdi, karar in ORNEKLER:
        mesajlar.append({"role": "user", "content": girdi})
        mesajlar.append({"role": "assistant", "content": json.dumps(karar, ensure_ascii=False)})
    return mesajlar


def _bulgu_metni(cevap_metni: str, sonuc: dict[str, Any] | None) -> str:
    """Biten adımın bulgusunu tetiğe kompakt biçimde anlatır."""
    parcalar = [(cevap_metni or "").strip()[:300]]
    if sonuc and sonuc.get("columns") and sonuc.get("rows"):
        kolonlar = sonuc["columns"]
        satirlar = sonuc["rows"]
        parcalar.append(" | ".join(str(k) for k in kolonlar))
        for satir in satirlar[:BULGU_SATIRI]:
            parcalar.append(" | ".join("NULL" if h is None else str(h) for h in satir))
        if len(satirlar) > BULGU_SATIRI:
            parcalar.append(f"... (toplam {len(satirlar)} satir)")
    return chr(10).join(p for p in parcalar if p)


def _girdi_metni(
    soru: str,
    biten: Adim,
    cevap_metni: str,
    sonuc: dict[str, Any] | None,
    kullanilmis: list[str],
) -> str:
    return chr(10).join(
        [
            f"ASIL SORU: {soru}",
            f"BITEN ADIM: {biten.ajan.kod} -- {biten.gorev}",
            "BULGU: " + _bulgu_metni(cevap_metni, sonuc),
            "DAHA ONCE CALISAN AJANLAR: " + ", ".join(kullanilmis),
        ]
    )


def sonraki_adim(
    soru: str,
    biten: Adim,
    cevap_metni: str,
    sonuc: dict[str, Any] | None,
    kullanilmis: list[str],
    client=None,
) -> TetikKarari:
    """Biten adımın bulgusuna bakıp zincire yeni bir adım ekler (ya da eklemez).

    Karar verilemezse (model cevap veremedi, JSON bozuk, ajan tanınmadı,
    kota doldu) zincir SESSİZCE durur: elde edilen cevap yine de kullanıcıya
    gider. Tetik bir iyileştirmedir, cevabın ön koşulu değildir.
    """
    if not settings.zincir_dinamik:
        return TetikKarari(None)

    # Veri getirmemiş bir adımın bulgusu yok; zincire dayanak olamaz.
    if not sonuc or not sonuc.get("rows"):
        return TetikKarari(None)

    kullanilmis_kume = {k.strip().lower() for k in kullanilmis if k}
    adaylar = [a for a in ajanlari_getir() if a.kod not in kullanilmis_kume]
    if not adaylar:
        return TetikKarari(None)

    if client is None:
        from .llm import get_groq_client

        client = get_groq_client()

    try:
        yanit = client.chat.completions.create(
            model=settings.groq_model,
            max_tokens=TETIK_BUTCESI,
            temperature=0,
            **(
                {"reasoning_effort": "low"}
                if settings.groq_model.startswith("openai/gpt-oss")
                else {}
            ),
            messages=[
                {"role": "system", "content": _talimat(adaylar)},
                *_ornek_mesajlari(),
                {
                    "role": "user",
                    "content": _girdi_metni(soru, biten, cevap_metni, sonuc, kullanilmis),
                },
            ],
        )
    except openai.RateLimitError:
        # Kota dolduysa zinciri uzatmıyoruz. Eldeki cevap geçerli; hata
        # fırlatmak tamamlanmış adımları da çöpe atardı. Ama SESSİZCE durmak
        # da yanıltıcı: kullanıcı zincirin bittiğini sanıyor.
        return TetikKarari(None, durum="kota")
    except (openai.APIConnectionError, openai.AuthenticationError):
        return TetikKarari(None, durum="hata")
    except Exception:  # noqa: BLE001 - tetik başarısızlığı cevabı engellemez
        return TetikKarari(None, durum="hata")

    olcum = getattr(yanit, "usage", None)
    kullanim = {
        "input_tokens": (getattr(olcum, "prompt_tokens", 0) or 0) if olcum else 0,
        "output_tokens": (getattr(olcum, "completion_tokens", 0) or 0) if olcum else 0,
    }

    veri = _json_ayikla(yanit.choices[0].message.content or "")
    if not isinstance(veri, dict):
        return TetikKarari(None, durum="hata", kullanim=kullanim)
    if not veri.get("devam"):
        return TetikKarari(None, durum="dur", kullanim=kullanim)

    kod = str(veri.get("ajan", "")).strip().lower()
    gorev = str(veri.get("gorev", "")).strip()
    gerekce = str(veri.get("gerekce", "")).strip()

    gecerli_kodlar = {a.kod for a in adaylar}
    if kod not in gecerli_kodlar or not gorev:
        # Model tanınmayan ya da zaten çalışmış bir ajan önerdiyse zinciri
        # uzatmıyoruz; yanlış ajana gitmek boş sonuç üretiyor.
        return TetikKarari(None, durum="dur", kullanim=kullanim)

    return TetikKarari(
        Adim(ajan_bul(kod), gorev, bool(veri.get("grafik")), gerekce=gerekce),
        gerekce,
        kullanim=kullanim,
    )
