"""Claude API entegrasyonu: dogal dil sorusu -> SQL -> sonuc -> Turkce cevap."""

from __future__ import annotations

import datetime
import json
import re
import time
from typing import Any

import anthropic
import openai

from .config import settings
from .db import QueryResult, run_select
from .schema import load_notes, schema_to_prompt, sema_hatasi_mi, otomatik_yenile
from . import sqlcache
from .sqlguard import SqlGuardError

__all__ = ["ChatCevabi", "sohbet_et", "get_client"]


NL2 = chr(10) * 2  # iki satir sonu


# Bu metin her API cagrisinda yeniden gonderilir; her kelimesi tekrar tekrar
# token harciyor. Bu yuzden kurallarin hepsi korunur ama mumkun oldugunca kisa
# yazilir (dolgu cumle yok).
ORTAK_TALIMAT = """Turkce bir veri asistanisin. Kullanicilar SQL bilmez, gunluk Turkce sorar.
Sorulari SQL'e cevir, calistir, sonucu sade Turkce ozetle.

CALISMA
- `sql_calistir` aracini kullan; yalnizca aracin dondurdugu gercek veriye dayan, veri uydurma.
- Once calistir sonra yorumla; tahmin yurutme.
- Her arac cagrisinda YALNIZCA TEK SELECT gonder. Iki sorgu gerekiyorsa araci iki kez cagir;
  noktali virgulle birlestirirsen guvenlik katmani reddeder ve bir tur bosa gider.
- Hata donerse hatayi oku, sorguyu duzelt, tekrar dene.

KURALLAR
- Yalnizca SELECT veya WITH. Veri degistiren ifadeler (INSERT/UPDATE/DELETE/DROP) engellenir.
- Satiri her zaman sinirla; kullanici acikca istemedikce 200'u asma.
- Tablo/kolon adlarini semada yazildigi gibi kullan.
- Kismi metin aramasi LIKE '%...%'. Toplamalarda NULL icin COALESCE.
- Gosterilecek kolonlara Turkce takma ad ver.

CEVAP
- Sonuc satirlarini ASLA tek tek yazma: ne markdown tablosu (| ... |), ne madde/numarali
  liste, ne de alt alta dokum. Sonuc tablosu arayuzde zaten gosteriliyor; tekrar yazarsan
  ekranda iki kez gorunur. Duz paragraf yaz.
- Yerine 2-4 cumle ozet: kac kayit, en dikkat cekici 1-2 deger, varsa sasirtici bulgu.
  Ornek: "10 film listelendi. Basi 34 kiralamayla BUCKET BROTHERHOOD cekiyor."
- Sonuc bossa bunu soyle ve olasi nedenini belirt.
- Soru belirsizse en makul yorumu sec, calistir, varsayimini bir cumleyle belirt.
  Yalnizca farkli yorumlar tamamen farkli sonuc veriyorsa kullaniciya soru sor.
- Sorulan sey semada yoksa hangi verinin bulunmadigini acikca soyle."""


MSSQL_TALIMATI = """
LEHCE: MICROSOFT SQL SERVER (T-SQL)
- Satir sinirlama: `SELECT TOP (200) ...`  (LIMIT KULLANMA)
- Tanimlayici tirnagi koseli parantez: [dbo].[Musteriler]
- Bugunun tarihi: CAST(GETDATE() AS date)
- Tarih aritmetigi: DATEADD(month, 1, ...), DATEDIFF(day, ..., ...)
- Sayfalama: OFFSET ... ROWS FETCH NEXT ... ROWS ONLY
- Metin birlestirme: + veya CONCAT()
- Takma ad ornegi: SELECT m.Unvan AS [Musteri]

TARIH IFADELERI (kullanicilar boyle konusur)
- "1 ay icinde bitecek"  -> BitisTarihi >= CAST(GETDATE() AS date)
                            AND BitisTarihi < DATEADD(month, 1, CAST(GETDATE() AS date))
- "gecen ay", "bu yil", "son 3 ayda" ifadelerini DATEADD/DATEDIFF ile hesapla."""


MYSQL_TALIMATI = """
LEHCE: MYSQL 8
- Satir sinirlama LIMIT 200 (TOP KULLANMA). Tanimlayici tirnagi geri tirnak: `film`.
- Bugun CURDATE(). Tarih: DATE_ADD/DATE_SUB(t, INTERVAL 1 MONTH), DATEDIFF(a,b), TIMESTAMPDIFF(MONTH,a,b).
- Birlestirme CONCAT() (+ degil). Bicim DATE_FORMAT(t,'%d.%m.%Y'). Sayfalama LIMIT 20 OFFSET 40.
- Takma ad: SELECT f.title AS `Film Adi`
- GROUP BY'da SELECT'teki gruplanmamis kolonlara dikkat (ONLY_FULL_GROUP_BY acik olabilir).
- "1 ay icinde bitecek" -> t >= CURDATE() AND t < DATE_ADD(CURDATE(), INTERVAL 1 MONTH).
  "gecen ay", "bu yil", "son 3 ay" ifadelerini DATE_ADD/DATE_SUB ile hesapla.
- DIKKAT: Sakila verisi gecmis tarihlidir. "son ay" gibi bir soruda sonuc bos gelirse
  MAX(tarih) ile veri araligini kontrol et ve bulgunu kullaniciya soyle."""


# Onbellekten gelen sorgu icin uydurulan arac cagrisi kimligi (her iki saglayici).
ONBELLEK_ARAC_ID = "onbellek_0"


OZET_TALIMATI = """Turkce bir veri asistanisin. Sorgu calisti; isin donen tabloyu sade Turkce ozetlemek.

- Sonuc satirlarini ASLA tek tek yazma: ne markdown tablosu (| ... |), ne madde
  listesi, ne alt alta dokum. Tablo arayuzde zaten gosteriliyor; tekrar yazarsan
  ekranda iki kez gorunur. Duz paragraf yaz.
- 2-4 cumle: kac kayit dondu, en dikkat cekici 1-2 deger, varsa sasirtici bulgu.
  Ornek: "10 film listelendi. Basi 34 kiralamayla BUCKET BROTHERHOOD cekiyor."
- Sonuc bossa bunu soyle ve olasi nedenini belirt.
- Yalnizca aracin dondurdugu gercek veriye dayan; veri uydurma.
- Sayilari ve para birimini sozlukte belirtildigi gibi etiketle."""


def _ozet_talimati() -> str:
    """Ozetleme cagrisi icin yalin talimat.

    Tam sistem talimatinin buyuk kismi SQL YAZMA kurallari (lehce, guvenlik,
    takma ad) ve ozetleme cagrisinda islevsiz. Zincirde dort cagri oldugu icin
    bu fark dogrudan dakikalik token limitine yansiyor.
    """
    return OZET_TALIMATI


def _sistem_talimati() -> str:
    """Aktif veritabani lehcesine gore sistem talimatini olusturur."""
    lehce = MYSQL_TALIMATI if settings.is_mysql else MSSQL_TALIMATI
    return ORTAK_TALIMAT + NL2 + lehce


SQL_ARACI = {
    "name": "sql_calistir",
    "description": (
        "Sirket veritabaninda salt-okunur bir SELECT sorgusu calistirir ve "
        "sonuc satirlarini dondurur. Kullanicinin sorusunu cevaplamak icin gereken "
        "veriyi almak amaciyla kullan."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "sql": {
                "type": "string",
                "description": "Calistirilacak SELECT sorgusu (aktif lehceye uygun). Tek ifade olmali.",
            },
            "aciklama": {
                "type": "string",
                "description": "Bu sorgunun ne yaptigini anlatan kisa bir Turkce cumle.",
            },
        },
        "required": ["sql"],
    },
}


_client: anthropic.Anthropic | None = None
_groq_client: openai.OpenAI | None = None

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY tanimli degil. .env dosyasina API anahtarinizi ekleyin."
            )
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


def get_groq_client() -> openai.OpenAI:
    """Groq, OpenAI uyumlu bir API sunar; openai SDK'sini base_url ile kullaniyoruz."""
    global _groq_client
    if _groq_client is None:
        if not settings.groq_api_key:
            raise RuntimeError(
                "GROQ_API_KEY tanimli degil. .env dosyasina API anahtarinizi ekleyin."
            )
        _groq_client = openai.OpenAI(
            api_key=settings.groq_api_key, base_url=GROQ_BASE_URL
        )
    return _groq_client


# Groq/OpenAI bicimindeki arac tanimi (Anthropic'ten farkli sarmalama)
GROQ_ARACI = {
    "type": "function",
    "function": {
        "name": SQL_ARACI["name"],
        "description": SQL_ARACI["description"],
        "parameters": SQL_ARACI["input_schema"],
    },
}


class ChatCevabi:
    def __init__(
        self,
        cevap: str,
        adimlar: list[dict[str, Any]],
        son_sonuc: QueryResult | None,
        gecmis: list[dict[str, Any]],
        kullanim: dict[str, int],
        tamamlandi: bool = True,
    ) -> None:
        self.cevap = cevap
        # Model sorgu turlerini tuketip pes ettiyse False olur. Bu durumda
        # elde kalan son_sonuc yarim kalmis bir denemeye ait olabilir; arayuz
        # bunu basarili sonuc gibi gostermemeli.
        self.tamamlandi = tamamlandi
        self.adimlar = adimlar
        self.son_sonuc = son_sonuc
        # Tam konusma gecmisi (tool_use bloklari dahil). Sunucu tarafinda
        # oturumda saklanir; JSON'a serilestirilmez.
        self.gecmis = gecmis
        self.kullanim = kullanim

    def to_dict(self) -> dict:
        return {
            "answer": self.cevap,
            "steps": self.adimlar,
            "result": self.son_sonuc.to_dict() if self.son_sonuc else None,
            "usage": self.kullanim,
        }


def _sistem_bloklari(ajan=None) -> list[dict[str, Any]]:
    """Sistem mesajini olusturur.

    Sema blogu cache_control ile onbellege alinir: her istekte yeniden
    islenmedigi icin hem hizli hem ucuzdur.
    """
    bugun = datetime.date.today().isoformat()
    sema_metni = schema_to_prompt()
    return [
        {"type": "text", "text": _sistem_talimati()},
        {
            "type": "text",
            "text": f"--- VERITABANI SEMASI ---\n{sema_metni}",
            "cache_control": {"type": "ephemeral"},
        },
        # Degisken icerik onbellek noktasindan SONRA gelmeli.
        {"type": "text", "text": f"Bugunun tarihi: {bugun}"},
    ]


def _arac_sonucu_metni(sonuc: QueryResult) -> str:
    """Sorgu sonucunu modelin okuyacagi kompakt metne cevirir."""
    if not sonuc.columns:
        return "Sorgu calisti ancak sonuc kumesi dondurmedi."
    if not sonuc.rows:
        return f"Sorgu basarili. 0 satir dondu.\nKolonlar: {', '.join(sonuc.columns)}"

    # Modele tum satirlari gondermek gereksiz token harcar; ozet cikarmaya
    # birkac satir yetiyor. Groq'un dakikalik token limiti dusuk oldugu icin
    # bu sayi dogrudan limit asimini etkiler.
    ornek = sonuc.rows[: settings.model_row_sample]
    satirlar = [f"Sorgu basarili. {sonuc.row_count} satir dondu ({sonuc.duration_ms} ms)."]
    if sonuc.truncated:
        satirlar.append(
            f"UYARI: Sonuc {settings.max_rows} satirda kesildi, gercek sayi daha fazla olabilir."
        )
    satirlar.append(" | ".join(sonuc.columns))
    for satir in ornek:
        satirlar.append(" | ".join("NULL" if h is None else str(h) for h in satir))
    if sonuc.row_count > len(ornek):
        satirlar.append(f"... (ilk {len(ornek)} satir gosterildi, toplam {sonuc.row_count})")
    return "\n".join(satirlar)


def _sql_araci_calistir(
    sql: str, aciklama: str, adimlar: list[dict[str, Any]]
) -> tuple[str, bool, QueryResult | None]:
    """SQL'i calistirir, adimi kaydeder ve modele donecek metni uretir.

    Her iki saglayici (Claude / Groq) da bu ayni yolu kullanir.
    Doner: (modele gidecek metin, hata_mi, sonuc)
    """
    try:
        sonuc = run_select(sql)
        adimlar.append(
            {
                "sql": sonuc.sql,
                "description": aciklama,
                "ok": True,
                "row_count": sonuc.row_count,
                "truncated": sonuc.truncated,
                "duration_ms": sonuc.duration_ms,
            }
        )
        return _arac_sonucu_metni(sonuc), False, sonuc
    except SqlGuardError as exc:
        adimlar.append({"sql": sql, "description": aciklama, "ok": False, "error": str(exc)})
        return (
            f"GUVENLIK HATASI: {exc}\nSadece salt-okunur SELECT sorgulari calistirilabilir.",
            True,
            None,
        )
    except Exception as exc:  # noqa: BLE001 - hatayi modele geri besliyoruz
        adimlar.append({"sql": sql, "description": aciklama, "ok": False, "error": str(exc)})
        ek = ""
        # "Unknown column" / "Invalid object name" gibi hatalar semanin
        # degistigine isaret eder. Canli veritabaninda bu normaldir; semayi
        # tazeleyip modele guncel haliyle tekrar denemesini soyluyoruz.
        # (Cagiran taraf hata durumunda semayi zaten yeniden gonderiyor.)
        if sema_hatasi_mi(str(exc)) and otomatik_yenile():
            ek = " Veritabani semasi yenilendi; guncel sema ile tekrar dene."
        return f"SQL HATASI: {exc}" + ek + " Sorguyu duzeltip tekrar dene.", True, None


def _claude_gecmisi_kirp(mesajlar: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Onceki turlarin sonuc satirlarini Claude gecmisinden de cikarir.

    Groq tarafiyla ayni gerekce: canli veritabaninda eski satirlar bayat
    olabilir. Claude'da arac sonuclari {"role": "user", "content": [
    {"type": "tool_result", ...}]} seklinde tasinir, bu yuzden ayri bir
    gezinme gerekir.

    Sinir, icerigi duz metin olan son "user" mesajidir: arac sonuclari da
    "user" rolu tasidigi icin rol tek basina yeterli degil.
    """
    son_soru = -1
    for i, m in enumerate(mesajlar):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            son_soru = i

    kirpilmis: list[dict[str, Any]] = []
    for i, m in enumerate(mesajlar):
        icerik = m.get("content")
        if i < son_soru and m.get("role") == "user" and isinstance(icerik, list):
            yeni_bloklar = []
            for blok in icerik:
                if isinstance(blok, dict) and blok.get("type") == "tool_result":
                    yeni_bloklar.append(
                        {**blok, "content": _arac_ozeti(str(blok.get("content") or ""))}
                    )
                else:
                    yeni_bloklar.append(blok)
            kirpilmis.append({**m, "content": yeni_bloklar})
        else:
            kirpilmis.append(m)
    return kirpilmis


def _claude_sohbet(mesaj: str, gecmis: list[dict[str, Any]] | None = None, ajan=None,
                   azami_tur: int | None = None) -> ChatCevabi:
    """Anthropic Claude ile arac dongusu."""
    client = get_client()
    mesajlar: list[dict[str, Any]] = _claude_gecmisi_kirp(list(gecmis or []))
    mesajlar.append({"role": "user", "content": mesaj})

    adimlar: list[dict[str, Any]] = []
    son_sonuc: QueryResult | None = None
    kullanim = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}

    # --- Onbellek ---
    # Groq yolundaki ile ayni gerekce: ayni soru daha once sorulduysa hangi
    # SQL'in yazilacagini biliyoruz ve "SQL uret" cagrisini atlayabiliriz.
    # Sorgu YINE DE bastan calistirilir; onbellek sonuc degil yalnizca sorgu
    # metni saklar, dolayisiyla veri canli kalir.
    ilk_soru = not (gecmis or [])
    onbellek_kullanildi = False
    if ilk_soru:
        onbellek_sqli = sqlcache.getir(mesaj, ajan.kod if ajan else "")
        if onbellek_sqli:
            icerik, hata, sonuc = _sql_araci_calistir(
                onbellek_sqli, "Daha once ayni soru icin uretilen sorgu", adimlar
            )
            if hata:
                # Sema veya veri degismis olabilir; onbellegi yok sayip
                # normal akisa donuyoruz ki model sorguyu bastan yazsin.
                adimlar.clear()
            else:
                son_sonuc = sonuc
                onbellek_kullanildi = True
                mesajlar.append(
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": ONBELLEK_ARAC_ID,
                                "name": "sql_calistir",
                                "input": {"sql": onbellek_sqli, "aciklama": ""},
                            }
                        ],
                    }
                )
                mesajlar.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": ONBELLEK_ARAC_ID,
                                "content": icerik,
                            }
                        ],
                    }
                )

    for _ in range(azami_tur or settings.max_tool_turns):
        yanit = client.messages.create(
            model=settings.claude_model,
            max_tokens=8000,
            system=_sistem_bloklari(ajan),
            output_config={"effort": settings.claude_effort},
            tools=[SQL_ARACI],
            messages=mesajlar,
        )

        kullanim["input_tokens"] += yanit.usage.input_tokens
        kullanim["output_tokens"] += yanit.usage.output_tokens
        kullanim["cache_read_input_tokens"] += getattr(
            yanit.usage, "cache_read_input_tokens", 0
        ) or 0

        if yanit.stop_reason == "refusal":
            return ChatCevabi(
                "Bu istek guvenlik politikalari nedeniyle yanitlanamadi. "
                "Lutfen sorunuzu farkli bicimde ifade edin.",
                adimlar,
                son_sonuc,
                mesajlar,
                kullanim,
            )

        # Modelin tam cevabini gecmise ekle (tool_use bloklari dahil).
        mesajlar.append({"role": "assistant", "content": yanit.content})

        arac_cagrilari = [b for b in yanit.content if b.type == "tool_use"]
        if not arac_cagrilari:
            metin = "\n".join(b.text for b in yanit.content if b.type == "text").strip()
            # Tek sorguyla cevaplanan ilk sorulari onbellege al. Coklu adimli
            # veya konusma baglamina bagli sorular tek basina tekrarlanamaz.
            # sqlcache.yaz(), sabit tarih iceren sorgulari kendisi reddeder.
            if (
                ilk_soru
                and not onbellek_kullanildi
                and len(adimlar) == 1
                and adimlar[0].get("ok")
            ):
                sqlcache.yaz(mesaj, adimlar[0]["sql"], ajan.kod if ajan else "")
            return ChatCevabi(
                metin or "Cevap uretilemedi.", adimlar, son_sonuc, mesajlar, kullanim
            )

        arac_sonuclari: list[dict[str, Any]] = []
        for cagri in arac_cagrilari:
            girdi = cagri.input or {}
            icerik, hata, sonuc = _sql_araci_calistir(
                girdi.get("sql", ""), girdi.get("aciklama", ""), adimlar
            )
            if sonuc is not None:
                son_sonuc = sonuc

            arac_sonuclari.append(
                {
                    "type": "tool_result",
                    "tool_use_id": cagri.id,
                    "content": icerik,
                    **({"is_error": True} if hata else {}),
                }
            )

        mesajlar.append({"role": "user", "content": arac_sonuclari})

    return ChatCevabi(
        "Sorguyu tamamlayamadim; izin verilen sorgu adimi sayisi asildi. "
        "Lutfen sorunuzu daha dar kapsamli sorun.",
        adimlar,
        son_sonuc,
        mesajlar,
        kullanim,
        tamamlandi=False,
    )


# Dakikalik limitte (TPM) otomatik beklenecek en uzun sure (saniye).
# TPM penceresi 1 dakika oldugu icin bekleme hicbir zaman 60 sn'yi asmaz;
# bu sinirla dakikalik limit kullaniciya neredeyse hic hata olarak yansimaz.
# Gunluk limit (TPD) bunun disinda: orada beklemek cozmez, yedek modele gecilir.
TPM_BEKLEME_SINIRI = 60


def _bekleme_suresi(mesaj: str) -> float | None:
    """Groq'un "try again in 1m2.5s" mesajindan saniye cikarir."""
    eslesme = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", mesaj)
    if not eslesme:
        return None
    return int(eslesme.group(1) or 0) * 60 + float(eslesme.group(2))


# Ozetleme cagrisinda cikti butcesi. max_tokens kullanilmasa bile dakikalik
# limitten tam dusuldugu icin, sadece 2-4 cumle yazacak cagriya dar butce
# vermek beklemeyi azaltir. Yetmezse kod otomatik olarak genisletip yineler.
OZET_BUTCESI = 400

# Groq'un dakikalik token limiti dusuk oldugu icin gecmisi sinirli tutuyoruz.
GROQ_GECMIS_SINIRI = 10      # sistem mesaji haric tutulacak mesaj sayisi


def _arac_ozeti(icerik: str) -> str:
    """Onceki turun arac ciktisindan VERI SATIRLARINI atar.

    Geriye yalnizca "kac satir dondu" bilgisi kalir. Boylece model, verisi
    degismis olabilecek eski sonuclari tekrarlayamaz; guncel bir deger
    gerekiyorsa sorguyu yeniden calistirmak zorunda kalir. Canli
    veritabaninda bu, bayat sayi bildirmesini engeller.

    Hata mesajlari veri icermez ve sorguyu duzeltmek icin gereklidir;
    onlara dokunulmaz.
    """
    if not icerik:
        return icerik
    bas = icerik.split("\n", 1)[0]
    if not bas.startswith("Sorgu basarili."):
        return icerik
    return (
        bas
        + " (Onceki turun sonuc satirlari baglamdan cikarildi. Guncel deger"
        + " gerekiyorsa sorguyu yeniden calistir.)"
    )


def _groq_gecmisi_kirp(
    mesajlar: list[dict[str, Any]], sinir: int = GROQ_GECMIS_SINIRI
) -> list[dict[str, Any]]:
    """Konusma gecmisini token limitine sigacak sekilde kirpar.

    Iki kademe:
      1. Onceki turlarin arac ciktilari kisaltilir (en cok yer kaplayan kisim).
      2. Cok uzarsa bastan mesaj atilir.

    Kesme noktasi mutlaka bir "user" mesajina hizalanir: aksi halde bir "tool"
    mesaji, onu doguran assistant tool_calls mesaji olmadan kalir ve API reddeder.
    """
    if not mesajlar:
        return mesajlar

    sistem = mesajlar[:1] if mesajlar[0].get("role") == "system" else []
    kalan = mesajlar[len(sistem):]

    # 1) Onceki turlarin sonuc SATIRLARINI tamamen cikar.
    # Sinir, son "user" mesajidir: ondan sonrasi icinde bulundugumuz turdur ve
    # modelin cevabi uretmek icin o satirlara ihtiyaci vardir. Oncesi ise
    # gecmis turlara aittir; verisi bu arada degismis olabilir, bu yuzden
    # yalnizca "kac satir dondu" bilgisi birakilir.
    son_user = max(
        (i for i, m in enumerate(kalan) if m.get("role") == "user"), default=-1
    )
    for i, m in enumerate(kalan):
        if i < son_user and m.get("role") == "tool":
            kalan[i] = {**m, "content": _arac_ozeti(m.get("content") or "")}

    # 2) Hala uzunsa bastan at, kesme noktasini user mesajina hizala
    if len(kalan) > sinir:
        kes = len(kalan) - sinir
        while kes < len(kalan) and kalan[kes].get("role") != "user":
            kes += 1
        if kes < len(kalan):
            kalan = kalan[kes:]

    return sistem + kalan


def _groq_istek(client, mesajlar: list[dict[str, Any]], butce: int | None = None):
    """Groq'a istek atar; token limiti asilirsa gecmisi kisaltip bir kez daha dener.

    Groq'un ucretsiz katmani dakikada 8000 token verir ve max_tokens da bu
    hesaba katilir. Uzun bir sohbette limit asilabilir; bu durumda cuvallamak
    yerine gecmisi agresif kirpip tekrar deniyoruz.
    Doner: yanit nesnesi, ya da kullaniciya gosterilecek hata metni (str).
    """
    varsayilan_butce = butce or settings.groq_max_tokens

    def cagir(msj, model: str | None = None, max_tokens: int | None = None):
        return client.chat.completions.create(
            model=model or settings.groq_model,
            messages=msj,
            tools=[GROQ_ARACI],
            tool_choice="auto",
            max_tokens=max_tokens or varsayilan_butce,
            temperature=0,
            # gpt-oss modellerinde "reasoning" ciktisi da completion tokenina
            # sayilir. low seviyesi bu ek yuku belirgin sekilde dusurur ve bu
            # is (tek SELECT uretmek) icin yeterlidir.
            **(
                {"reasoning_effort": settings.groq_reasoning_effort}
                if settings.groq_reasoning_effort
                and settings.groq_model.startswith("openai/gpt-oss")
                else {}
            ),
        )

    def dene(msj, model: str | None = None):
        yanit = cagir(msj, model)
        # max_tokens dar tutuldugu icin uzun bir cevap yarida kesilebilir.
        # Bu durumda soruyu cevapsiz birakmak yerine bir kez genis butceyle
        # tekrar deniyoruz. Nadir oldugu icin ortalama maliyeti neredeyse
        # hic artirmaz.
        if yanit.choices[0].finish_reason == "length":
            yanit = cagir(msj, model, max_tokens=varsayilan_butce * 3)
        return yanit

    try:
        return dene(mesajlar)
    except openai.RateLimitError as ilk:
        # Groq'ta hem dakikalik (TPM) hem gunluk (TPD) kota HER MODEL ICIN
        # AYRI tutulur. Bu yuzden limite carpinca beklemek yerine once yedek
        # modeli deniyoruz: kotasi genelde bostur ve cevap aninda gelir.
        # Beklemek son care.
        yedek = settings.groq_fallback_model
        if yedek and yedek != settings.groq_model:
            try:
                return dene(mesajlar, yedek)
            except openai.RateLimitError:
                pass  # iki modelin de kotasi dolu; asagida beklemeyi deneriz
        sure = _bekleme_suresi(str(ilk))
        if sure is None or sure > TPM_BEKLEME_SINIRI:
            raise
        time.sleep(sure + 0.5)
        return dene(mesajlar)
    except openai.APIStatusError as exc:
        if exc.status_code != 413:
            raise
        # Ikinci deneme: sadece sistem mesaji + son kullanici sorusu
        sistem = [m for m in mesajlar[:1] if m.get("role") == "system"]
        son_soru = next(
            (m for m in reversed(mesajlar) if m.get("role") == "user"), None
        )
        if not son_soru:
            raise
        try:
            return cagir(sistem + [son_soru])
        except openai.APIStatusError as exc2:
            if exc2.status_code != 413:
                raise
            return (
                "Bu soru Groq'un dakikalik token limitine sigmadi. "
                "Sohbeti temizleyip daha dar bir soru sorun, ya da .env dosyasindaki "
                "MODEL_ROW_SAMPLE / GROQ_MAX_TOKENS degerlerini dusurun."
            )


def _groq_sohbet(mesaj: str, gecmis: list[dict[str, Any]] | None = None, ajan=None,
                 azami_tur: int | None = None) -> ChatCevabi:
    """Groq (OpenAI uyumlu API) ile arac dongusu.

    Anthropic'ten farklari:
      - sistem mesaji, messages listesinin ilk ogesi olarak gonderilir
      - arac cagrilari message.tool_calls icinde gelir, argumanlar JSON metnidir
      - arac sonucu {"role": "tool", "tool_call_id": ...} mesaji olarak doner
    """
    client = get_groq_client()

    # Sistem mesaji HER ISTEKTE yeniden uretilir; gecmisten gelen eski kopya
    # kullanilmaz. Aksi halde oturum basladiktan sonra sema degistiginde o
    # konusma sonsuza dek eski semayi tasirdi.
    onceki = [m for m in (gecmis or []) if m.get("role") != "system"]
    sistem = (
        _sistem_talimati()
        + "\n\n--- VERITABANI SEMASI ---\n"
        + schema_to_prompt(ek_sozluk=ajan.sozluk() if ajan else "")
        + "\n\nBugunun tarihi: "
        + datetime.date.today().isoformat()
    )
    mesajlar: list[dict[str, Any]] = [{"role": "system", "content": sistem}, *onceki]
    mesajlar.append({"role": "user", "content": mesaj})

    adimlar: list[dict[str, Any]] = []
    son_sonuc: QueryResult | None = None
    kullanim = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}

    # Tablo/kolon listesi sistem mesajinin en buyuk parcasi (Sakila'da ~650
    # token) ve her API cagrisinda yeniden gonderiliyor. Oysa sorgu calistiktan
    # sonraki cagrinin isi sadece donen satirlari ozetlemek; tablo listesine
    # ihtiyaci yok. O cagrilarda listeyi cikariyoruz; bu, dakikalik token
    # limitine carpip beklemeyi azaltiyor.
    # Terim sozlugu ise CIKARILMAZ: sonucu dogru yorumlamak icin gerekli
    # (orn. tutarlarin TL degil USD oldugu bilgisi oradan geliyor).
    # Guvenlik agi: bir sorgu hata verirse model sorguyu duzeltmek icin tablo
    # listesine ihtiyac duyar, o turdan itibaren tam surume geri donuyoruz.
    notlar = load_notes()
    # Ozetleme cagrisinda da bolum sozlugu kalir: sonucu dogru yorumlamak
    # icin gerekli (finans ajaninin tutari USD etiketlemesi gibi).
    bolum = ajan.sozluk() if ajan else ""
    kisa_sistem = {
        "role": "system",
        "content": _ozet_talimati()
        + (f"\n\n--- IS KURALLARI VE TERIM SOZLUGU ---\n{notlar}" if notlar else "")
        + (f"\n\n--- BOLUM SOZLUGU ---\n{bolum}" if bolum else "")
        + "\n\nBugunun tarihi: "
        + datetime.date.today().isoformat(),
    }
    sema_gerekli = True

    # --- Onbellek ---
    # Ayni soru daha once sorulduysa hangi SQL'in yazilacagini biliyoruz.
    # Sorguyu YINE DE bastan calistiriyoruz: onbellek sonuc degil, yalnizca
    # sorgu metni saklar. Boylece veri canli kalir ama "SQL uret" cagrisi
    # tamamen atlanir (soru basina ~1900 token).
    # Yalnizca konusmanin ilk sorusunda denenir; devam sorulari onceki
    # baglama bagli oldugu icin tek basina tekrarlanamaz.
    ilk_soru = not (gecmis or [])
    onbellek_kullanildi = False
    if ilk_soru:
        onbellek_sqli = sqlcache.getir(mesaj, ajan.kod if ajan else "")
        if onbellek_sqli:
            icerik, hata, sonuc = _sql_araci_calistir(
                onbellek_sqli, "Daha once ayni soru icin uretilen sorgu", adimlar
            )
            if hata:
                # Sema veya veri degismis olabilir; onbellegi yok sayip
                # normal akisa donuyoruz ki model sorguyu bastan yazsin.
                adimlar.clear()
            else:
                son_sonuc = sonuc
                onbellek_kullanildi = True
                sema_gerekli = False
                mesajlar.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": ONBELLEK_ARAC_ID,
                                "type": "function",
                                "function": {
                                    "name": "sql_calistir",
                                    "arguments": json.dumps(
                                        {"sql": onbellek_sqli, "aciklama": ""},
                                        ensure_ascii=False,
                                    ),
                                },
                            }
                        ],
                    }
                )
                mesajlar.append(
                    {
                        "role": "tool",
                        "tool_call_id": ONBELLEK_ARAC_ID,
                        "name": "sql_calistir",
                        "content": icerik,
                    }
                )

    for _ in range(azami_tur or settings.max_tool_turns):
        mesajlar = _groq_gecmisi_kirp(mesajlar)
        if sema_gerekli or mesajlar[0].get("role") != "system":
            istek_mesajlari = mesajlar
            butce = None
        else:
            istek_mesajlari = [kisa_sistem, *mesajlar[1:]]
            butce = OZET_BUTCESI

        yanit = _groq_istek(client, istek_mesajlari, butce)
        if isinstance(yanit, str):          # limit asimi, toparlanamadi
            return ChatCevabi(yanit, adimlar, son_sonuc, mesajlar, kullanim)

        if yanit.usage:
            kullanim["input_tokens"] += yanit.usage.prompt_tokens or 0
            kullanim["output_tokens"] += yanit.usage.completion_tokens or 0

        secim = yanit.choices[0].message
        mesajlar.append(
            {
                "role": "assistant",
                "content": secim.content or "",
                **(
                    {
                        "tool_calls": [
                            {
                                "id": c.id,
                                "type": "function",
                                "function": {
                                    "name": c.function.name,
                                    "arguments": c.function.arguments,
                                },
                            }
                            for c in secim.tool_calls
                        ]
                    }
                    if secim.tool_calls
                    else {}
                ),
            }
        )

        if not secim.tool_calls:
            metin = (secim.content or "").strip()
            # Tek sorguyla cevaplanan ilk sorulari onbellege al. Coklu adimli
            # veya konusma baglamina bagli sorular tek basina tekrarlanamaz.
            # sqlcache.yaz(), sabit tarih iceren sorgulari kendisi reddeder.
            if ilk_soru and not onbellek_kullanildi and len(adimlar) == 1 and adimlar[0].get("ok"):
                sqlcache.yaz(mesaj, adimlar[0]["sql"], ajan.kod if ajan else "")
            return ChatCevabi(
                metin or "Cevap uretilemedi.", adimlar, son_sonuc, mesajlar, kullanim
            )

        # Sorgu(lar) sorunsuz calistiysa sonraki cagri sadece ozetleme yapacak;
        # semayi gondermeye gerek yok. Hata varsa model sorguyu duzeltecek,
        # o zaman semaya ihtiyaci var.
        sema_gerekli = False

        for cagri in secim.tool_calls:
            try:
                girdi = json.loads(cagri.function.arguments or "{}")
            except json.JSONDecodeError:
                girdi = {}

            icerik, hata, sonuc = _sql_araci_calistir(
                girdi.get("sql", ""), girdi.get("aciklama", ""), adimlar
            )
            if hata:
                sema_gerekli = True
            if sonuc is not None:
                son_sonuc = sonuc

            mesajlar.append(
                {
                    "role": "tool",
                    "tool_call_id": cagri.id,
                    "name": cagri.function.name,
                    "content": icerik,
                }
            )

    return ChatCevabi(
        "Sorguyu tamamlayamadim; izin verilen sorgu adimi sayisi asildi. "
        "Lutfen sorunuzu daha dar kapsamli sorun.",
        adimlar,
        son_sonuc,
        mesajlar,
        kullanim,
        tamamlandi=False,
    )


def sohbet_et(mesaj: str, gecmis: list[dict[str, Any]] | None = None, ajan=None,
              azami_tur: int | None = None) -> ChatCevabi:
    """Aktif saglayiciya gore sohbeti yurutur (LLM_PROVIDER ayari)."""
    if settings.is_groq:
        return _groq_sohbet(mesaj, gecmis, ajan, azami_tur)
    return _claude_sohbet(mesaj, gecmis, ajan, azami_tur)
