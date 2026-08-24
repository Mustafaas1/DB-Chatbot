"""Ortam degiskenlerinden yapilandirma okuma."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "evet", "y"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _liste(name: str, default: list[str]) -> list[str]:
    """Virgulle ayrilmis ortam degiskenini listeye cevirir."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return [p.strip() for p in raw.split(",") if p.strip()]


@dataclass(frozen=True)
class Settings:
    db_type: str            # 'mssql' | 'mysql'
    llm_provider: str       # 'claude' | 'groq'

    anthropic_api_key: str
    claude_model: str
    claude_effort: str

    groq_api_key: str
    groq_model: str
    groq_fallback_model: str
    groq_reasoning_effort: str
    groq_max_tokens: int

    mssql_driver: str
    mssql_server: str
    mssql_database: str
    mssql_trusted: bool
    mssql_user: str
    mssql_password: str
    mssql_encrypt: bool
    mssql_trust_cert: bool

    mysql_host: str
    mysql_port: int
    mysql_user: str
    mysql_password: str
    mysql_database: str

    max_rows: int
    model_row_sample: int
    schema_style: str
    schema_exclude: list[str]
    query_timeout: int
    max_tool_turns: int
    # Soru -> SQL onbellegi. SONUC saklanmaz, yalnizca sorgunun kendisi;
    # sorgu her seferinde yeniden calisir, veri canli kalir.
    sql_cache: bool
    sql_cache_ttl: int
    # Sema onbelleginin omru. Veritabani canliysa kolon/tablo degisebilir;
    # bu sure dolunca sema yeniden taranir. 0 = hic eskime (statik sema).
    schema_ttl: int
    cors_origins: list[str]

    base_dir: Path = BASE_DIR

    @property
    def connection_string(self) -> str:
        parts = [
            f"DRIVER={{{self.mssql_driver}}}",
            f"SERVER={self.mssql_server}",
            f"DATABASE={self.mssql_database}",
        ]
        if self.mssql_trusted:
            parts.append("Trusted_Connection=yes")
        else:
            parts.append(f"UID={self.mssql_user}")
            parts.append(f"PWD={self.mssql_password}")
        parts.append(f"Encrypt={'yes' if self.mssql_encrypt else 'no'}")
        if self.mssql_trust_cert:
            parts.append("TrustServerCertificate=yes")
        # Sunucuya bu baglantinin salt-okunur amacli oldugunu bildirir.
        parts.append("ApplicationIntent=ReadOnly")
        return ";".join(parts)

    @property
    def is_groq(self) -> bool:
        return self.llm_provider == "groq"

    @property
    def llm_model(self) -> str:
        """Aktif saglayicinin modeli."""
        return self.groq_model if self.is_groq else self.claude_model

    @property
    def llm_key_var(self) -> bool:
        """Aktif saglayicinin API anahtari tanimli mi."""
        return bool(self.groq_api_key if self.is_groq else self.anthropic_api_key)

    @property
    def is_mysql(self) -> bool:
        return self.db_type == "mysql"

    @property
    def database_name(self) -> str:
        """Aktif veritabaninin adi (lehceden bagimsiz)."""
        return self.mysql_database if self.is_mysql else self.mssql_database

    @property
    def safe_connection_info(self) -> dict:
        """Sifre icermeyen, arayuzde gosterilebilir baglanti ozeti."""
        if self.is_mysql:
            return {
                "server": f"{self.mysql_host}:{self.mysql_port}",
                "database": self.mysql_database,
                "driver": "MySQL (PyMySQL)",
                "auth": f"MySQL ({self.mysql_user})",
                "db_type": "mysql",
            }
        return {
            "server": self.mssql_server,
            "database": self.mssql_database,
            "driver": self.mssql_driver,
            "auth": "Windows" if self.mssql_trusted else f"SQL ({self.mssql_user})",
            "db_type": "mssql",
        }


def _anahtar(name: str, onekler: tuple[str, ...]) -> str:
    """API anahtarini okur; .env.example'daki yer tutucuyu bos sayar.

    Boylece anahtar girilmeden calistirildiginda kullanici ham 401 yerine
    anlasilir bir uyari gorur.
    """
    anahtar = os.getenv(name, "").strip()
    if len(anahtar) < 20:
        return ""
    # "sk-ant-..." / "gsk_..." gibi yer tutucular
    if anahtar.rstrip(".") in {o.rstrip("-_") for o in onekler}:
        return ""
    if set(anahtar[-3:]) == {"."}:
        return ""
    return anahtar


def _api_anahtari() -> str:
    return _anahtar("ANTHROPIC_API_KEY", ("sk-ant-",))


def load_settings() -> Settings:
    return Settings(
        db_type=os.getenv("DB_TYPE", "mssql").strip().lower(),
        llm_provider=os.getenv("LLM_PROVIDER", "claude").strip().lower(),
        anthropic_api_key=_api_anahtari(),
        claude_model=os.getenv("CLAUDE_MODEL", "claude-opus-5").strip(),
        claude_effort=os.getenv("CLAUDE_EFFORT", "medium").strip(),
        groq_api_key=_anahtar("GROQ_API_KEY", ("gsk_",)),
        groq_model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip(),
        groq_fallback_model=os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b").strip(),
        groq_reasoning_effort=os.getenv("GROQ_REASONING_EFFORT", "").strip(),
        groq_max_tokens=_int("GROQ_MAX_TOKENS", 1200),
        mssql_driver=os.getenv("MSSQL_DRIVER", "ODBC Driver 18 for SQL Server").strip(),
        mssql_server=os.getenv("MSSQL_SERVER", "localhost\\SQLEXPRESS").strip(),
        mssql_database=os.getenv("MSSQL_DATABASE", "SirketDemo").strip(),
        mssql_trusted=_bool("MSSQL_TRUSTED_CONNECTION", True),
        mssql_user=os.getenv("MSSQL_USER", "").strip(),
        mssql_password=os.getenv("MSSQL_PASSWORD", ""),
        mssql_encrypt=_bool("MSSQL_ENCRYPT", True),
        mssql_trust_cert=_bool("MSSQL_TRUST_SERVER_CERTIFICATE", True),
        mysql_host=os.getenv("MYSQL_HOST", "localhost").strip(),
        mysql_port=_int("MYSQL_PORT", 3306),
        mysql_user=os.getenv("MYSQL_USER", "root").strip(),
        mysql_password=os.getenv("MYSQL_PASSWORD", ""),
        mysql_database=os.getenv("MYSQL_DATABASE", "sakila").strip(),
        max_rows=_int("MAX_ROWS", 500),
        model_row_sample=_int("MODEL_ROW_SAMPLE", 15),
        schema_style=os.getenv("SCHEMA_STYLE", "compact").strip().lower(),
        schema_exclude=_liste("SCHEMA_EXCLUDE_TABLES", []),
        query_timeout=_int("QUERY_TIMEOUT", 30),
        max_tool_turns=_int("MAX_TOOL_TURNS", 6),
        sql_cache=os.getenv("SQL_CACHE", "on").strip().lower() not in {"off", "0", "false", "hayir"},
        sql_cache_ttl=_int("SQL_CACHE_TTL", 604800),
        schema_ttl=_int("SCHEMA_TTL", 3600),
        cors_origins=_liste("CORS_ORIGINS", ["*"]),
    )


settings = load_settings()
