import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    db_path: Path = PROJECT_DIR / "solar.db"
    daily_api_limit: int = 50
    request_timeout: float = 20

    @classmethod
    def from_environment(cls):
        path = Path(os.getenv("SOLAR_DB_PATH", str(PROJECT_DIR / "solar.db")))
        if not path.is_absolute():
            path = PROJECT_DIR / path
        limit = int(os.getenv("SOLAR_DAILY_API_LIMIT", "50"))
        if limit < 0:
            raise ValueError("SOLAR_DAILY_API_LIMIT negatif olamaz.")
        return cls(path.resolve(), limit)
