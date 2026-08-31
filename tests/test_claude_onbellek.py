"""Claude yolunun soru -> SQL onbellegine baglanmasi.

Onbellek once yalnizca Groq akisina baglanmisti. Bu testler ayni davranisin
Claude'da da gecerli oldugunu ve uretilen mesaj yapisinin Anthropic API'sinin
bekledigi bicimde oldugunu (tool_use <-> tool_result eslesmesi) dogrular.

Gercek API cagrisi yapilmaz; istemci taklit edilir.
"""

from __future__ import annotations

import pytest

from pybot import llm, sqlcache


class SahteBlok:
    def __init__(self, tur, metin=""):
        self.type = tur
        self.text = metin


class SahteKullanim:
    input_tokens = 100
    output_tokens = 20
    cache_read_input_tokens = 0


class SahteYanit:
    stop_reason = "end_turn"

    def __init__(self):
        self.content = [SahteBlok("text", "16 kategori bulundu.")]
        self.usage = SahteKullanim()


class SahteIstemci:
    """messages.create cagrilarini kaydeder, sabit bir cevap doner."""

    def __init__(self):
        self.cagrilar = []
        self.messages = self

    def create(self, **kwargs):
        # _claude_sohbet ayni listeyi mutasyona ugratmaya devam ettigi icin
        # cagri anindaki halini kopyalayarak sakliyoruz.
        anlik = {**kwargs, "messages": list(kwargs.get("messages", []))}
        self.cagrilar.append(anlik)
        return SahteYanit()


@pytest.fixture
def ortam(tmp_path, monkeypatch):
    monkeypatch.setattr(sqlcache, "DOSYA", tmp_path / "sql_cache.json")
    monkeypatch.setattr(sqlcache, "_parmak_izi", lambda: "SEMA1")

    istemci = SahteIstemci()
    monkeypatch.setattr(llm, "get_client", lambda: istemci)

    # Sorgu calistirmayi taklit et: gercek veritabanina gitme
    calistirilan = []

    def sahte_arac(sql, aciklama, adimlar):
        calistirilan.append(sql)
        adimlar.append({"sql": sql, "description": aciklama, "ok": True,
                        "row_count": 16, "truncated": False, "duration_ms": 42})
        return "Sorgu basarili. 16 satir dondu (42 ms)." + chr(10) + "Kategori | Adet", False, None

    monkeypatch.setattr(llm, "_sql_araci_calistir", sahte_arac)
    return istemci, calistirilan


SQL = "SELECT c.name, COUNT(*) FROM category c GROUP BY c.name"


def test_onbellek_isabetinde_model_cagrisi_atlanir(ortam):
    """Onbellek doluyken 'SQL uret' cagrisi yapilmamali."""
    istemci, calistirilan = ortam
    sqlcache.yaz("kategori sayilari", SQL)

    llm._claude_sohbet("kategori sayilari")

    # Tek cagri kalir: ozetleme. SQL uretme cagrisi atlandi.
    assert len(istemci.cagrilar) == 1
    # Sorgu yine de CALISTI -> veri canli
    assert calistirilan == [SQL]


def test_onbellekten_gelen_mesaj_yapisi_gecerli(ortam):
    """tool_use ve tool_result eslesmezse Anthropic istegi reddeder."""
    istemci, _ = ortam
    sqlcache.yaz("kategori sayilari", SQL)

    llm._claude_sohbet("kategori sayilari")
    mesajlar = istemci.cagrilar[0]["messages"]

    assert mesajlar[0] == {"role": "user", "content": "kategori sayilari"}

    arac_cagrisi = mesajlar[1]
    assert arac_cagrisi["role"] == "assistant"
    blok = arac_cagrisi["content"][0]
    assert blok["type"] == "tool_use"
    assert blok["name"] == "sql_calistir"
    assert blok["input"]["sql"] == SQL

    sonuc = mesajlar[2]
    assert sonuc["role"] == "user"
    sonuc_blok = sonuc["content"][0]
    assert sonuc_blok["type"] == "tool_result"
    assert sonuc_blok["tool_use_id"] == blok["id"], "tool_use ve tool_result kimligi tutmuyor"


def test_onbellek_bosken_normal_akis(ortam):
    """Onbellek yoksa mesajlarda uydurma arac cagrisi olmamali."""
    istemci, calistirilan = ortam

    llm._claude_sohbet("hic sorulmamis soru")

    mesajlar = istemci.cagrilar[0]["messages"]
    assert len(mesajlar) == 1
    assert mesajlar[0]["content"] == "hic sorulmamis soru"
    assert calistirilan == []


def test_devam_sorusunda_onbellek_denenmez(ortam):
    """Devam sorulari onceki baglama bagli; tek basina tekrarlanamaz."""
    istemci, calistirilan = ortam
    sqlcache.yaz("kategori sayilari", SQL)

    llm._claude_sohbet("kategori sayilari",
                       gecmis=[{"role": "user", "content": "onceki soru"}])

    assert calistirilan == []


def test_onbellekteki_sorgu_hata_verirse_normal_akisa_donulur(ortam, monkeypatch):
    """Sema degismis olabilir; model sorguyu bastan yazabilmeli."""
    istemci, _ = ortam
    sqlcache.yaz("kategori sayilari", SQL)

    def patlayan(sql, aciklama, adimlar):
        adimlar.append({"sql": sql, "description": aciklama, "ok": False,
                        "error": "Unknown column"})
        return "SQL HATASI: Unknown column", True, None

    monkeypatch.setattr(llm, "_sql_araci_calistir", patlayan)
    llm._claude_sohbet("kategori sayilari")

    mesajlar = istemci.cagrilar[0]["messages"]
    assert len(mesajlar) == 1, "hatali onbellek sorgusu mesajlara eklenmemeli"


def test_basarili_ilk_soru_onbellege_yazilir(ortam, monkeypatch):
    """Model bir sorgu calistirip cevap verdiyse esleme saklanmali."""
    istemci, _ = ortam

    # Once tool_use donen, sonra metin donen bir model taklidi
    class AracBloku:
        type = "tool_use"
        id = "t1"
        name = "sql_calistir"
        input = {"sql": SQL, "aciklama": "kategori sayilari"}

    class IlkYanit(SahteYanit):
        def __init__(self):
            super().__init__()
            self.content = [AracBloku()]

    yanitlar = [IlkYanit(), SahteYanit()]
    def sirali_create(**k):
        istemci.cagrilar.append({**k, "messages": list(k.get("messages", []))})
        return yanitlar.pop(0)

    monkeypatch.setattr(istemci, "create", sirali_create)

    assert sqlcache.getir("yeni soru") is None
    llm._claude_sohbet("yeni soru")
    assert sqlcache.getir("yeni soru") == SQL
