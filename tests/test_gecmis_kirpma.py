"""Konusma gecmisinin kirpilmasi.

Canli veritabaninda onceki turlarin sonuc satirlari bayat olabilir. Bunlar
baglamda kalirsa model guncel sayiyi sorgulamak yerine eskisini tekrarlayabilir.
Bu testler, gecmis turlarin VERI SATIRLARININ baglamdan cikarildigini ve
icinde bulunulan turun satirlarinin KORUNDUGUNU guvence altina alir.
"""

from __future__ import annotations

from pybot.llm import _arac_ozeti, _claude_gecmisi_kirp, _groq_gecmisi_kirp

SONUC = (
    "Sorgu basarili. 16 satir dondu (51 ms)." + chr(10) +
    "Kategori | Film Sayisi" + chr(10) +
    "Sports | 74" + chr(10) +
    "Foreign | 73"
)


# ------------------------------------------------- _arac_ozeti

def test_veri_satirlari_atilir():
    ozet = _arac_ozeti(SONUC)
    assert "Sports" not in ozet
    assert "74" not in ozet
    assert "Kategori | Film Sayisi" not in ozet


def test_satir_sayisi_korunur():
    """Model kac satir donduğunu bilmeli; yalnizca degerler gitmeli."""
    ozet = _arac_ozeti(SONUC)
    assert "16 satir dondu" in ozet


def test_yeniden_sorgulamasi_soylenir():
    assert "yeniden calistir" in _arac_ozeti(SONUC)


def test_hata_mesajlari_korunur():
    """Hatalar veri icermez ve sorguyu duzeltmek icin gereklidir."""
    hata = "SQL HATASI: (1054, \"Unknown column 'x'\") Sorguyu duzeltip tekrar dene."
    assert _arac_ozeti(hata) == hata

    guvenlik = "GUVENLIK HATASI: Yasakli SQL ifadesi tespit edildi: DROP"
    assert _arac_ozeti(guvenlik) == guvenlik


def test_bos_icerik():
    assert _arac_ozeti("") == ""


# ------------------------------------------------- sinir dogru mu

def _gecmis():
    return [
        {"role": "system", "content": "SISTEM"},
        {"role": "user", "content": "birinci soru"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "a"}]},
        {"role": "tool", "tool_call_id": "a", "content": SONUC},
        {"role": "assistant", "content": "16 kategori var."},
        {"role": "user", "content": "ikinci soru"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "b"}]},
        {"role": "tool", "tool_call_id": "b", "content": SONUC},
    ]


def test_onceki_turun_satirlari_cikarilir():
    k = _groq_gecmisi_kirp(_gecmis())
    ilk_arac = next(m for m in k if m.get("tool_call_id") == "a")
    assert "Sports" not in ilk_arac["content"]


def test_icinde_bulunulan_turun_satirlari_korunur():
    """Model cevabi uretmek icin GUNCEL sonuca ihtiyac duyar."""
    k = _groq_gecmisi_kirp(_gecmis())
    son_arac = next(m for m in k if m.get("tool_call_id") == "b")
    assert "Sports | 74" in son_arac["content"]


def test_sistem_mesaji_basta_kalir():
    k = _groq_gecmisi_kirp(_gecmis())
    assert k[0]["role"] == "system"


def test_arac_mesaji_esini_kaybetmez():
    """Bir 'tool' mesaji, onu doguran assistant tool_calls mesaji olmadan
    kalirsa API istegi reddeder."""
    uzun = [{"role": "system", "content": "S"}]
    for i in range(8):
        uzun += [
            {"role": "user", "content": f"soru {i}"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": str(i)}]},
            {"role": "tool", "tool_call_id": str(i), "content": SONUC},
            {"role": "assistant", "content": f"cevap {i}"},
        ]
    k = _groq_gecmisi_kirp(uzun)

    acik = set()
    for m in k:
        if m.get("role") == "assistant" and m.get("tool_calls"):
            acik.update(c["id"] for c in m["tool_calls"])
        if m.get("role") == "tool":
            assert m["tool_call_id"] in acik, "esi olmayan tool mesaji"


def test_bos_gecmis():
    assert _groq_gecmisi_kirp([]) == []


# ------------------------------------------------- claude yolu

def _claude_gecmis():
    return [
        {"role": "user", "content": "birinci soru"},
        {"role": "assistant",
         "content": [{"type": "tool_use", "id": "a", "name": "sql_calistir", "input": {}}]},
        {"role": "user",
         "content": [{"type": "tool_result", "tool_use_id": "a", "content": SONUC}]},
        {"role": "assistant", "content": [{"type": "text", "text": "16 kategori var"}]},
        {"role": "user", "content": "ikinci soru"},
        {"role": "assistant",
         "content": [{"type": "tool_use", "id": "b", "name": "sql_calistir", "input": {}}]},
        {"role": "user",
         "content": [{"type": "tool_result", "tool_use_id": "b", "content": SONUC}]},
    ]


def test_claude_onceki_turun_satirlari_cikarilir():
    k = _claude_gecmisi_kirp(_claude_gecmis())
    assert "Sports" not in k[2]["content"][0]["content"]


def test_claude_icinde_bulunulan_turun_satirlari_korunur():
    k = _claude_gecmisi_kirp(_claude_gecmis())
    assert "Sports | 74" in k[6]["content"][0]["content"]


def test_claude_tool_use_bloklari_bozulmaz():
    """Arac cagrisi bloklari degistirilirse API istegi tutarsiz kalir."""
    k = _claude_gecmisi_kirp(_claude_gecmis())
    assert k[1]["content"][0]["type"] == "tool_use"
    assert k[1]["content"][0]["id"] == "a"
    assert k[3]["content"][0]["text"] == "16 kategori var"


def test_claude_bos_gecmis():
    assert _claude_gecmisi_kirp([]) == []
