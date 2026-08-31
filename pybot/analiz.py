"""Çoklu analiz ajanı katmanı.

Bölüm ajanının veri sonucunu alıp üç farklı perspektiften analiz üretir:
  - Yorum  : Verinin ne anlama geldiğini özetler
  - Çözüm  : Veriye dayalı aksiyon önerileri sunar
  - Risk   : Potansiyel risk ve uyarıları tespit eder

Üç ayrı LLM çağrısı yerine TEK çağrıda 3 bölümlü JSON çıktı istenir.
Groq ücretsiz katmanının dakikada 8000 token limiti olduğu için bu
yaklaşım ~400-600 ek token ile çalışır.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

import openai

from .config import settings

__all__ = ["AnalizSonucu", "analiz_yap"]


@dataclass
class AnalizSonucu:
    """Üç analiz ajanının birleşik çıktısı."""
    yorum: str = ""
    cozum: str = ""
    risk: str = ""
    kullanim: dict[str, int] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})

    def bos_mu(self) -> bool:
        return not (self.yorum or self.cozum or self.risk)

    def to_dict(self) -> dict[str, Any]:
        return {
            "yorum": self.yorum,
            "cozum": self.cozum,
            "risk": self.risk,
            "kullanim": self.kullanim,
        }


# Analiz yapmaya değmeyecek kadar basit sonuçlar için eşikler.
MINIMUM_SATIR = 1          # En az 1 satır (tek satır bile analiz edilir)
MINIMUM_KOLON = 1          # En az 1 kolon


ANALIZ_TALIMATI = """Sen üç farklı analiz ajanının birleşimisin. Kullanıcının veritabanı sorusuna dönen SORGU SONUCUNU analiz edeceksin.

Her zaman Türkçe yaz. Aşağıdaki üç bölümü JSON formatında dön:

1. **yorum**: Verinin ne anlama geldiğini, dikkat çekici noktaları ve genel tabloyu özetler.
   - 2-4 cümle ile veriyi yorumla
   - Sayıları ve oranları kullan
   - "Dikkat çekici olan..." veya "Öne çıkan..." gibi ifadelerle başla

2. **cozum**: Veriye dayalı somut aksiyon önerileri sun.
   - 2-4 madde halinde kısa ve net öneriler
   - Her öneri uygulanabilir olmalı
   - Maddeleri "1. ", "2. " şeklinde numaralandır

3. **risk**: Potansiyel riskleri ve uyarıları tespit et.
   - Veri geçmişe kıyasla bozulma gösteriyorsa belirt
   - Eşik aşımı veya anormal durumları işaretle
   - Veri yetersizse veya eksik olabilecek yönler varsa belirt
   - Risk yoksa "Mevcut veriye göre belirgin bir risk görünmüyor." yaz

KURALLAR:
- Yalnızca verilen sorgu sonucuna dayan; tahmin yürütme.
- Kısa ve öz yaz; her bölüm en fazla 3-4 cümle.
- Yanıt YALNIZCA JSON olsun: {"yorum": "...", "cozum": "...", "risk": "..."}
- JSON dışında hiçbir şey yazma (açıklama, başlık, markdown yok)."""


def _veri_metni(soru: str, cevap: str, sonuc: dict[str, Any] | None) -> str:
    """Analiz modeline gönderilecek bağlam metnini oluşturur."""
    parcalar = [f"KULLANICI SORUSU: {soru}", f"AJAN CEVABI: {cevap}"]

    if sonuc and sonuc.get("columns") and sonuc.get("rows"):
        kolonlar = sonuc["columns"]
        satirlar = sonuc["rows"]
        parcalar.append(f"SORGU SONUCU ({len(satirlar)} satır):")
        parcalar.append(" | ".join(str(k) for k in kolonlar))
        # Token tasarrufu: en fazla 15 satır gönder
        for satir in satirlar[:15]:
            parcalar.append(" | ".join(
                "NULL" if h is None else str(h) for h in satir
            ))
        if len(satirlar) > 15:
            parcalar.append(f"... (toplam {len(satirlar)} satır)")

    return "\n".join(parcalar)


def _json_ayikla(metin: str) -> dict[str, str] | None:
    """Model çıktısından JSON'u çıkarır."""
    if not metin:
        return None
    ham = metin.strip()
    # ```json ... ``` bloğu varsa içini al
    if ham.startswith("```"):
        ham = ham.split("```")[1] if "```" in ham[3:] else ham[3:]
        if ham.lstrip().lower().startswith("json"):
            ham = ham.lstrip()[4:]
    bas, son = ham.find("{"), ham.rfind("}")
    if bas == -1 or son <= bas:
        return None
    try:
        veri = json.loads(ham[bas:son + 1])
        if isinstance(veri, dict):
            return {
                "yorum": str(veri.get("yorum", "")),
                "cozum": str(veri.get("cozum", "")),
                "risk": str(veri.get("risk", "")),
            }
    except json.JSONDecodeError:
        pass
    return None


def _alan_kurtar(ham: str, ad: str) -> str:
    """Yarıda kesilmiş JSON metninden tek bir alanı kurtarır.

    Model çıktısı max_tokens sınırına takılıp JSON kapanmadan bittiğinde
    json.loads patlıyor; o durumda alanları tek tek çekiyoruz. Son alan
    kapanmamış olabileceği için kapanış tırnağı zorunlu değil.
    """
    ters = chr(92)
    anahtar = '"' + ad + '"'
    bas = ham.find(anahtar)
    if bas == -1:
        return ""
    tirnak = ham.find('"', bas + len(anahtar))
    if tirnak == -1:
        return ""
    parcalar: list[str] = []
    i = tirnak + 1
    while i < len(ham):
        harf = ham[i]
        if harf == ters and i + 1 < len(ham):
            parcalar.append(ham[i:i + 2])
            i += 2
            continue
        if harf == '"':
            break
        parcalar.append(harf)
        i += 1
    govde = "".join(parcalar)
    try:
        return json.loads('"' + govde + '"').strip()
    except json.JSONDecodeError:
        return govde.strip()


def _kismi_json_ayikla(metin: str) -> dict[str, str] | None:
    """JSON bozuksa alanları tek tek kurtarmayı dener."""
    if not metin or '"yorum"' not in metin:
        return None
    veri = {ad: _alan_kurtar(metin, ad) for ad in ("yorum", "cozum", "risk")}
    return veri if any(veri.values()) else None


def _analiz_gerekli_mi(sonuc: dict[str, Any] | None, cevap: str) -> bool:
    """Sonuç analiz yapmaya değecek kadar zengin mi kontrol eder.

    Tek hücreli 'kaç X var?' tarzı sorularda analiz gereksiz; boş sonuçta
    da analiz edilecek veri yok.
    """
    if not sonuc:
        return False
    kolonlar = sonuc.get("columns") or []
    satirlar = sonuc.get("rows") or []
    if len(kolonlar) < MINIMUM_KOLON or len(satirlar) < MINIMUM_SATIR:
        return False
    # Tek satır + tek kolon = basit sayım sorusu, analiz gereksiz
    if len(satirlar) == 1 and len(kolonlar) == 1:
        return False
    return True


def analiz_yap(
    soru: str,
    cevap_metni: str,
    sonuc: dict[str, Any] | None,
    ajan_kodu: str = "",
) -> AnalizSonucu:
    """Sorgu sonucunu 3 farklı perspektiften analiz eder.

    Tek LLM çağrısıyla yorum + çözüm + risk üretir.
    Analiz gereksizse veya başarısız olursa boş AnalizSonucu döner.
    """
    if not _analiz_gerekli_mi(sonuc, cevap_metni):
        return AnalizSonucu()

    metin = _veri_metni(soru, cevap_metni, sonuc)

    try:
        if settings.is_groq:
            from .llm import get_groq_client
            client = get_groq_client()

            yanit = client.chat.completions.create(
                model=settings.groq_model,
                # 600 token 3 bölümlü JSON'a yetmiyor, çıktı yarıda kesilip
                # JSON bozuluyordu.
                max_tokens=1000,
                temperature=0,
                messages=[
                    {"role": "system", "content": ANALIZ_TALIMATI},
                    {"role": "user", "content": metin},
                ],
            )
            icerik = yanit.choices[0].message.content or ""
            kullanim = {
                "input_tokens": yanit.usage.prompt_tokens or 0 if yanit.usage else 0,
                "output_tokens": yanit.usage.completion_tokens or 0 if yanit.usage else 0,
            }
        else:
            from .llm import get_client
            client = get_client()

            yanit = client.messages.create(
                model=settings.claude_model,
                max_tokens=800,
                system=[{"type": "text", "text": ANALIZ_TALIMATI}],
                messages=[{"role": "user", "content": metin}],
            )
            icerik = "\n".join(
                b.text for b in yanit.content if b.type == "text"
            ).strip()
            kullanim = {
                "input_tokens": yanit.usage.input_tokens,
                "output_tokens": yanit.usage.output_tokens,
            }

        veri = _json_ayikla(icerik)
        if veri:
            return AnalizSonucu(
                yorum=veri["yorum"],
                cozum=veri["cozum"],
                risk=veri["risk"],
                kullanim=kullanim,
            )
        # JSON parse başarısız. Çıktı kesilmiş JSON ise alanları kurtar;
        # aksi halde düz metin gelmiştir, onu yorum olarak kullan.
        # Ham JSON'u olduğu gibi yoruma basmak arayüzde küme parantezli
        # çöp metin gösteriyordu.
        kismi = _kismi_json_ayikla(icerik)
        if kismi:
            return AnalizSonucu(
                yorum=kismi["yorum"],
                cozum=kismi["cozum"],
                risk=kismi["risk"],
                kullanim=kullanim,
            )
        if icerik.lstrip().startswith("{"):
            return AnalizSonucu(kullanim=kullanim)
        return AnalizSonucu(yorum=icerik[:500], kullanim=kullanim)

    except (openai.RateLimitError, openai.APIConnectionError):
        # Kota aşıldıysa analizi sessizce atla; veri sonucu zaten gösterildi.
        return AnalizSonucu()
    except Exception:  # noqa: BLE001 - analiz başarısızlığı veri sonucunu engellemez
        return AnalizSonucu()
