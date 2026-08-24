"""FastAPI uygulamasi: web arayuzu ve chat API'si."""

from __future__ import annotations

import re
import uuid
from typing import Any

import anthropic
import openai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import settings
from .db import run_select, test_connection
from .llm import sohbet_et
from .schema import get_schema, refresh_schema, schema_to_prompt

app = FastAPI(title="Veritabani Chatbot", version="1.0.0")

STATIC_DIR = settings.base_dir / "static"


class DogrulamaliStatik(StaticFiles):
    """Tarayiciya "kullanmadan once bana sor" der (Cache-Control: no-cache).

    Dosya degismediyse sunucu 304 doner, yeniden indirilmez; degistiyse taze
    surum gelir. widget.js musteri portallarina gomulu oldugu icin, guncelleme
    yaptigimizda eski surumun onbellekte takili kalmamasi kritik.
    """

    async def get_response(self, path: str, scope):
        yanit = await super().get_response(path, scope)
        yanit.headers["Cache-Control"] = "no-cache"
        return yanit


app.mount("/static", DogrulamaliStatik(directory=STATIC_DIR), name="static")

# Widget baska bir sunucudaki sayfaya gomuldugunde tarayici cagrilarina izin verir.
# Uretimde CORS_ORIGINS'i kendi alan adlarinizla sinirlayin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Oturum -> tam konusma gecmisi. Tek islemli calisma icin bellekte tutulur.
# Cok islemli/olcekli dagitimda Redis gibi bir depoya tasinmalidir.
OTURUMLAR: dict[str, list[dict[str, Any]]] = {}
MAKS_OTURUM = 200


class ChatIstegi(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: str | None = None


class SqlIstegi(BaseModel):
    sql: str = Field(..., min_length=1)


class OturumIstegi(BaseModel):
    session_id: str | None = None


@app.get("/")
def anasayfa() -> FileResponse:
    """Varsayilan giris: widget'in gomulu oldugu sayfa (sag altta sohbet paneli)."""
    return FileResponse(STATIC_DIR / "demo.html")


@app.get("/demo")
def demo() -> FileResponse:
    """Ayni sayfanin eski adresi; eski baglantilar bozulmasin diye korunuyor."""
    return FileResponse(STATIC_DIR / "demo.html")


@app.get("/tam")
def tam_ekran() -> FileResponse:
    """Widget'teki 'tam ekranda ac' butonunun hedefi: tum sayfayi kaplayan arayuz."""
    return FileResponse(STATIC_DIR / "index.html")


# Aktif veritabanina gore arayuzde gosterilecek ornek sorular.
ORNEK_SORULAR = {
    "sakila": [
        "En çok kiralanan 10 film hangileri?",
        "Kategorilere göre film sayısı ve toplam ciro",
        "En çok harcama yapan 10 müşteri",
        "Hiç kiralanmamış film var mı?",
        "İade edilmemiş kiralamalar hangileri?",
        "Mağazalara göre aylık kiralama sayısı",
    ],
    "varsayilan": [
        "1 ay içinde sözleşmeleri bitecek müşteriler",
        "Vadesi geçmiş ödenmemiş faturaların toplamı ne kadar?",
        "Şehirlere göre aktif müşteri sayısı",
        "En yüksek cirolu 10 müşteri hangileri?",
        "Açık destek talepleri hangi müşterilerde birikmiş?",
    ],
}


@app.get("/api/durum")
def durum() -> dict:
    """Baglanti ve yapilandirma durumu (arayuzdeki gosterge icin)."""
    baglanti = test_connection()
    ornekler = ORNEK_SORULAR.get(settings.database_name.lower(), ORNEK_SORULAR["varsayilan"])
    return {
        "database": baglanti,
        "db_type": settings.db_type,
        "ornekler": ornekler,
        "provider": settings.llm_provider,
        "model": settings.llm_model,
        "effort": settings.claude_effort,
        "api_key_var": settings.llm_key_var,
        "max_rows": settings.max_rows,
    }


@app.get("/api/sema")
def sema(yenile: bool = False) -> dict:
    """Veritabani semasini dondurur."""
    try:
        veri = refresh_schema() if yenile else get_schema()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Sema okunamadi: {exc}") from exc
    return {
        "database": veri["database"],
        "table_count": len(veri["tables"]),
        "tables": veri["tables"],
        "views": veri.get("views", []),
    }


@app.get("/api/sema/onizleme")
def sema_onizleme() -> dict:
    """Yapay zekaya gonderilen sema metninin birebir kopyasi (hata ayiklama icin)."""
    return {"prompt": schema_to_prompt()}


@app.post("/api/sohbet")
def sohbet(istek: ChatIstegi) -> dict:
    if not settings.llm_key_var:
        anahtar_adi = "GROQ_API_KEY" if settings.is_groq else "ANTHROPIC_API_KEY"
        raise HTTPException(
            status_code=400,
            detail=f"{anahtar_adi} tanimli degil. .env dosyasina API anahtarinizi ekleyin.",
        )

    oturum_id = istek.session_id or uuid.uuid4().hex
    gecmis = OTURUMLAR.get(oturum_id, [])

    try:
        cevap = sohbet_et(istek.message, gecmis)
    except (anthropic.AuthenticationError, openai.AuthenticationError) as exc:
        anahtar_adi = "GROQ_API_KEY" if settings.is_groq else "ANTHROPIC_API_KEY"
        raise HTTPException(
            status_code=401,
            detail=f"API anahtari gecersiz. .env dosyasindaki {anahtar_adi} degerini kontrol edin.",
        ) from exc
    except (anthropic.RateLimitError, openai.RateLimitError) as exc:
        # Saglayicinin kendi mesaji ne zaman tekrar denenebilecegini ve hangi
        # limitin (dakikalik mi gunluk mu) doldugunu soyluyor; bunu gizlemeyelim.
        ayrinti = "API kullanim limiti asildi."
        try:
            ham = exc.response.json()["error"]["message"]
        except Exception:  # noqa: BLE001
            ham = str(exc)
        if "per day" in ham or "TPD" in ham:
            ayrinti = (
                "Gunluk token kotasi doldu. "
                "Groq ucretsiz katmani gunde 200.000 token verir (~30-45 soru). "
            )
        elif "per minute" in ham or "TPM" in ham:
            ayrinti = "Dakikalik token limiti doldu. "
        sure = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", ham)
        if sure:
            dakika = int(sure.group(1) or 0)
            saniye = round(float(sure.group(2)))
            if saniye >= 60:
                dakika, saniye = dakika + saniye // 60, saniye % 60
            okunur = f"{dakika} dk {saniye} sn" if dakika else f"{saniye} sn"
            ayrinti = ayrinti.rstrip() + f" Yaklasik {okunur} sonra tekrar deneyebilirsiniz."
        raise HTTPException(status_code=429, detail=ayrinti) from exc
    except (anthropic.APIConnectionError, openai.APIConnectionError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Yapay zeka servisine baglanilamadi. Internet baglantinizi kontrol edin.",
        ) from exc
    except openai.NotFoundError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model bulunamadi: {settings.groq_model}. "
                ".env dosyasindaki GROQ_MODEL degerini kontrol edin."
            ),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if len(OTURUMLAR) >= MAKS_OTURUM and oturum_id not in OTURUMLAR:
        OTURUMLAR.pop(next(iter(OTURUMLAR)))  # en eski oturumu dusur
    OTURUMLAR[oturum_id] = cevap.gecmis

    return {"session_id": oturum_id, **cevap.to_dict()}


@app.post("/api/oturum/sifirla")
def oturum_sifirla(istek: OturumIstegi | None = None) -> dict:
    """Sohbet gecmisini temizler."""
    if istek and istek.session_id:
        OTURUMLAR.pop(istek.session_id, None)
    return {"ok": True}


@app.post("/api/sql")
def sql_calistir(istek: SqlIstegi) -> dict:
    """Uretilen SQL'i elle duzenleyip yeniden calistirmak icin."""
    try:
        sonuc = run_select(istek.sql)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return sonuc.to_dict()
