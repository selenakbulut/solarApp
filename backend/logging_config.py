import logging
from .settings import PROJECT_DIR

logger = logging.getLogger("ges")
logger.setLevel(logging.INFO)
if not logger.handlers:
    folder = PROJECT_DIR / "logs"
    folder.mkdir(exist_ok=True)
    handler = logging.FileHandler(folder / "solar.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
    logger.addHandler(handler)
