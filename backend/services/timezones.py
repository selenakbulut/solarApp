from functools import lru_cache
from zoneinfo import ZoneInfo


@lru_cache(maxsize=1)
def _finder():
    from timezonefinder import TimezoneFinder
    return TimezoneFinder()


def site_timezone(site):
    timezone = site.get("timezone")
    if not timezone:
        timezone = _finder().timezone_at(lat=site["latitude"], lng=site["longitude"])
    if not timezone:
        raise ValueError("Konum için saat dilimi belirlenemedi.")
    ZoneInfo(timezone)
    return timezone
