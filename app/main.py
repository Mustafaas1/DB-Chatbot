"""FastAPI uygulamasi: web arayuzu ve chat API'si."""

from __future__ import annotations

import re
import uuid
from typing import Any

import anthropic
import openai
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import json
import time
from contextlib import asynccontextmanager, contextmanager

from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import settings
from .db import run_select, test_connection
from .llm import sohbet_et
from . import sqlcache
from .ozet import ozet_getir
from .orkestra import akis_calistir, akis_uret
from .guvenlik import dogrula, koruma_durumu
from . import oturum as oturum_deposu
from . import detay as detay_deposu
from .detay import DetayHatasi
from .schema import get_schema, refresh_schema, schema_to_prompt

@asynccontextmanager
async def yasam_dongusu(_: FastAPI):
    """Acilista suresi dolmus oturumlari temizle."""
    oturum_deposu.bakim()
    yield


app = FastAPI(title="Veritabani Chatbot", version="1.0.0", lifespan=yasam_dongusu)

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
    allow_headers=["Content-Type", "Authorization", "X-API-Token"],
)

# Oturum gecmisi SQLite'ta tutulur (app/oturum.py). Bellekte tutuldugunda
# sunucu her yeniden baslatildiginda konusmalar siliniyordu ve birden fazla
# worker calistirildiginda her worker'in kendi kopyasi oluyordu.




def _hata_kodu_ve_metni(exc: Exception) -> tuple[int, str]:
    """Saglayici hatasini (HTTP kodu, kullaniciya gosterilecek metin) ciftine cevirir.

    Tek kaynak: hem HTTP yaniti ureten yol hem de akis (SSE) yolu bunu kullanir.
    """
    if isinstance(exc, (anthropic.AuthenticationError, openai.AuthenticationError)):
        anahtar_adi = "GROQ_API_KEY" if settings.is_groq else "ANTHROPIC_API_KEY"
        return 401, f"API anahtari gecersiz. .env dosyasindaki {anahtar_adi} degerini kontrol edin."

    if isinstance(exc, (anthropic.RateLimitError, openai.RateLimitError)):
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
        return 429, ayrinti

    if isinstance(exc, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return 503, "Yapay zeka servisine baglanilamadi. Internet baglantinizi kontrol edin."

    if isinstance(exc, openai.NotFoundError):
        return 400, (
            f"Model bulunamadi: {settings.groq_model}. "
            ".env dosyasindaki GROQ_MODEL degerini kontrol edin."
        )

    return 500, str(exc)


def _hata_metni(exc: Exception) -> str:
    return _hata_kodu_ve_metni(exc)[1]


@contextmanager
def _llm_hatalarini_cevir():
    """Saglayici hatalarini HTTP yanitina cevirir."""
    try:
        yield
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        kod, metin = _hata_kodu_ve_metni(exc)
        raise HTTPException(status_code=kod, detail=metin) from exc


class ChatIstegi(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: str | None = None


class AkisIstegi(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: str | None = None


class SqlIstegi(BaseModel):
    sql: str = Field(..., min_length=1)


class DetayIstegi(BaseModel):
    """Grafikteki bir gruba tiklandiginda o gruba ait ham satirlar.

    SQL istemciden GELMEZ; sunucu, adim sirasina karsilik saklanan ozet
    sorgudan detay sorgusunu kendisi turetir.
    """

    session_id: str = Field(..., min_length=1, max_length=64)
    sira: int = Field(..., ge=1, le=50)
    deger: Any = None
    limit: int | None = Field(default=None, ge=1)


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


@app.get("/sonuc")
def sonuc_sayfasi() -> FileResponse:
    """Bir ajan adiminin sonucunu ayri sekmede gosteren sayfa.

    Tum adimlar tek yukte tasinir; ustteki sekmelerle ajanlar arasi gecis
    yapilir. Veri URL fragmentinde oldugu icin sunucuya gitmez.
    """
    return FileResponse(STATIC_DIR / "sonuc.html")


@app.get("/grafik")
def grafik_sayfasi() -> FileResponse:
    """Ajan sonucunun grafigini ayri bir sekmede gosteren sayfa.

    Veri URL fragmentinde tasinir; sunucuya gitmez ve widget baska bir alan
    adinda gomulu olsa bile calisir.
    """
    return FileResponse(STATIC_DIR / "grafik.html")


@app.get("/tam")
def tam_ekran() -> FileResponse:
    """Widget'teki 'tam ekranda ac' butonunun hedefi: tum sayfayi kaplayan arayuz."""
    return FileResponse(STATIC_DIR / "index.html")


# Aktif veritabanina gore arayuzde gosterilecek ornek sorular.
ORNEK_SORULAR = {
    "gokkusagi_passwordvault": [
        "Aşamalarına göre açık destek biletleri",
        "Durumlarına göre teklif sayısı ve toplam tutarı",
        "Bu yıl bitecek sözleşmeler hangileri?",
        "En çok bilet atanan 10 kişi",
        "Para birimine göre faturalanacak tutar",
        "İzin türlerine göre talep sayısı",
    ],
    "varsayilan": [
        "1 ay içinde sözleşmeleri bitecek müşteriler",
        "Vadesi geçmiş ödenmemiş faturaların toplamı ne kadar?",
        "Şehirlere göre aktif müşteri sayısı",
        "En yüksek cirolu 10 müşteri hangileri?",
        "Açık destek talepleri hangi müşterilerde birikmiş?",
    ],
}


@app.get("/api/durum", dependencies=[Depends(dogrula)])
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
        "analiz_aktif": True,
        **koruma_durumu(),
        "oturum": oturum_deposu.istatistik(),
    }


@app.get("/api/ozet", dependencies=[Depends(dogrula)])
def ozet() -> dict:
    """Portal panosundaki ozet kartlari.

    Rakamlar veritabanindan canli okunur, sayfada sabit deger yoktur.
    Yapay zekaya gidilmez; token harcamaz.
    """
    try:
        return ozet_getir()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Ozet alinamadi: {exc}") from exc


@app.get("/api/onbellek", dependencies=[Depends(dogrula)])
def onbellek_durumu() -> dict:
    """Soru -> SQL onbelleginin durumu.

    Onbellek sonuc saklamaz; yalnizca hangi sorunun hangi SQL'e karsilik
    geldigini tutar. Sorgular her seferinde yeniden calisir.
    """
    return sqlcache.istatistik()


@app.post("/api/onbellek/temizle", dependencies=[Depends(dogrula)])
def onbellek_temizle() -> dict:
    """Onbellegi bosaltir.

    Sema degisikligi zaten kayitlari kendiliginden dusurur; bu uc, is
    kurallari degistiginde elle mudahale icindir.
    """
    sqlcache.temizle()
    return {"ok": True, "mesaj": "Onbellek temizlendi."}


@app.get("/api/sema", dependencies=[Depends(dogrula)])
def sema(yenile: bool = False) -> dict:
    """Veritabani semasini dondurur."""
    try:
        veri = refresh_schema() if yenile else get_schema()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Sema okunamadi: {exc}") from exc
    alindi = veri.get("alindi")
    return {
        "database": veri["database"],
        "table_count": len(veri["tables"]),
        "alindi": alindi,
        "yas_saniye": round(time.time() - alindi) if alindi else None,
        "ttl_saniye": settings.schema_ttl,
        "tables": veri["tables"],
        "views": veri.get("views", []),
    }


@app.get("/api/sema/onizleme", dependencies=[Depends(dogrula)])
def sema_onizleme() -> dict:
    """Yapay zekaya gonderilen sema metninin birebir kopyasi (hata ayiklama icin)."""
    return {"prompt": schema_to_prompt()}


@app.post("/api/sohbet", dependencies=[Depends(dogrula)])
def sohbet(istek: ChatIstegi) -> dict:
    if not settings.llm_key_var:
        anahtar_adi = "GROQ_API_KEY" if settings.is_groq else "ANTHROPIC_API_KEY"
        raise HTTPException(
            status_code=400,
            detail=f"{anahtar_adi} tanimli degil. .env dosyasina API anahtarinizi ekleyin.",
        )

    oturum_id = istek.session_id or uuid.uuid4().hex
    gecmis = oturum_deposu.getir(oturum_id)

    with _llm_hatalarini_cevir():
        cevap = sohbet_et(istek.message, gecmis)

    oturum_deposu.kaydet(oturum_id, cevap.gecmis)

    return {"session_id": oturum_id, **cevap.to_dict()}


@app.post("/api/akis", dependencies=[Depends(dogrula)])
def akis(istek: AkisIstegi) -> dict:
    """Soruyu bolum ajanlarindan olusan bir zincire dagitir.

    Tek bolumu ilgilendiren sorularda tek adim doner; iki bolumu
    ilgilendirenlerde ikinci ajan birincinin bulgusu uzerine calisir.
    Konusma sureklidir: gecmis ilk adima verilir, son adimin gecmisi saklanir.
    """
    if not settings.llm_key_var:
        anahtar_adi = "GROQ_API_KEY" if settings.is_groq else "ANTHROPIC_API_KEY"
        raise HTTPException(
            status_code=400,
            detail=f"{anahtar_adi} tanimli degil. .env dosyasina API anahtarinizi ekleyin.",
        )

    oturum_id = istek.session_id or uuid.uuid4().hex
    with _llm_hatalarini_cevir():
        sonuc = akis_calistir(istek.message, oturum_deposu.getir(oturum_id))

    for kayit in sonuc.get("adimlar", []):
        _adim_sqlini_sakla(oturum_id, kayit)

    oturum_deposu.kaydet(oturum_id, sonuc.pop("gecmis", []))
    return {"session_id": oturum_id, **sonuc}


@app.post("/api/akis/canli", dependencies=[Depends(dogrula)])
def akis_canli(istek: AkisIstegi):
    """Zinciri adim adim yayinlar (Server-Sent Events).

    Zincirli sorular 30 saniyeyi bulabiliyor. Bu uc, ilk ajanin sonucunu
    ikincisi calisirken gonderir; kullanici bos ekrana bakmaz.
    """
    if not settings.llm_key_var:
        anahtar_adi = "GROQ_API_KEY" if settings.is_groq else "ANTHROPIC_API_KEY"
        raise HTTPException(
            status_code=400,
            detail=f"{anahtar_adi} tanimli degil. .env dosyasina API anahtarinizi ekleyin.",
        )

    oturum_id = istek.session_id or uuid.uuid4().hex

    def uret():
        def kare(veri: dict) -> str:
            return "data: " + json.dumps(veri, ensure_ascii=False, default=str) + chr(10) * 2

        yield kare({"tur": "oturum", "session_id": oturum_id})
        try:
            for kayit in akis_uret(istek.message, oturum_deposu.getir(oturum_id)):
                if kayit["tur"] == "bitti":
                    oturum_deposu.kaydet(oturum_id, kayit.pop("gecmis", []))
                elif kayit["tur"] == "adim":
                    # Detay (drill-down) icin ozet SQL'i sunucuda sakla.
                    # Istemci sonradan yalnizca oturum + sira gonderir.
                    _adim_sqlini_sakla(oturum_id, kayit)
                yield kare(kayit)
        except Exception as exc:  # noqa: BLE001 - akis basladi, HTTP kodu degistiremeyiz
            # Baglanti acildiktan sonra hata olursa istemciye kayit olarak bildiriyoruz.
            yield kare({"tur": "hata", "mesaj": _hata_metni(exc)})

    return StreamingResponse(
        uret(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _adim_sqlini_sakla(oturum_id: str, kayit: dict) -> None:
    """Adimin ozet SQL'ini detay listesi icin saklar; hata akisi bozmaz."""
    sonuc = kayit.get("result") or {}
    try:
        detay_deposu.sql_kaydet(oturum_id, kayit.get("sira", 0), sonuc.get("sql"))
    except Exception:  # noqa: BLE001 - saklama basarisizligi cevabi engellemez
        pass


@app.post("/api/detay", dependencies=[Depends(dogrula)])
def detay(istek: DetayIstegi) -> dict:
    """Grafikteki bir gruba ait ham satirlari dondurur (drill-down).

    Ornek: "Asamalarina gore acik biletler" sonucunda "Beklemede" cubuguna
    tiklandiginda, o asamadaki biletlerin kendisi listelenir.
    """
    try:
        sonuc = detay_deposu.detay_getir(
            istek.session_id, istek.sira, istek.deger, istek.limit
        )
    except DetayHatasi as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deger": istek.deger, **sonuc.to_dict()}


@app.post("/api/oturum/sifirla", dependencies=[Depends(dogrula)])
def oturum_sifirla(istek: OturumIstegi | None = None) -> dict:
    """Sohbet gecmisini temizler."""
    if istek and istek.session_id:
        oturum_deposu.sil(istek.session_id)
    return {"ok": True}


@app.post("/api/sql", dependencies=[Depends(dogrula)])
def sql_calistir(istek: SqlIstegi) -> dict:
    """Uretilen SQL'i elle duzenleyip yeniden calistirmak icin."""
    if not settings.allow_raw_sql:
        raise HTTPException(
            status_code=403,
            detail=(
                "Ham SQL ucu kapali. Acmak icin .env dosyasina ALLOW_RAW_SQL=on ekleyin. "
                "Bu uc dogal dil akisini atlar; yalnizca guvendiginiz ortamda acin."
            ),
        )
    try:
        sonuc = run_select(istek.sql)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return sonuc.to_dict()


class UygulamaIstegi(BaseModel):
    cozum: str


@app.post("/api/uygula", dependencies=[Depends(dogrula)])
def cozum_uygula_api(istek: UygulamaIstegi) -> dict:
    """Kullanıcının seçtiği çözümü LLM üzerinden simüle ederek uygular."""
    from .llm import cozum_uygula
    try:
        yanit = cozum_uygula(istek.cozum)
        # Bu uc HICBIR SEY YAPMIYOR: yapilmis gibi bir rapor uretiyor.
        # Istemciler bunu goruntude acikca isaretlesin diye bayrak
        # doniyoruz; etiketsiz birakilirsa uydurma rakamlar ("120 bilet
        # atandi" gibi) gercek islem sanilabiliyor.
        return {"ok": True, "mesaj": yanit, "simulasyon": True}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

