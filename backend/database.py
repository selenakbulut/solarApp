import sqlite3
from contextlib import contextmanager
from pathlib import Path


def connect_database(db_path):
    connection = sqlite3.connect(str(db_path), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


@contextmanager
def transaction(db_path):
    connection = connect_database(db_path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(db_path):
    from .legacy_schema import initialize_legacy_schema

    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    initialize_legacy_schema(db_path)
    with transaction(db_path) as connection:
        connection.executescript((Path(__file__).with_name("schema.sql")).read_text())
        connection.execute("""
            INSERT OR IGNORE INTO weather_cache_hours (
                kind, latitude, longitude, timezone, tilt, azimuth, weather_time,
                temperature, wind_speed, cloud_cover, shortwave_radiation,
                tilted_radiation, fetched_at
            )
            SELECT 'forecast', s.latitude, s.longitude,
                   COALESCE(s.timezone, 'Europe/Istanbul'), w.tilt, w.azimuth,
                   w.forecast_time, w.temperature, w.wind_speed, w.cloud_cover,
                   w.shortwave_radiation, w.tilted_radiation, w.fetched_at
            FROM weather_data w JOIN sites s ON s.id = w.site_id
            WHERE w.temperature IS NOT NULL AND w.tilted_radiation IS NOT NULL
        """)
        connection.execute("""
            INSERT OR IGNORE INTO weather_cache_hours (
                kind, latitude, longitude, timezone, tilt, azimuth, weather_time,
                temperature, wind_speed, cloud_cover, shortwave_radiation,
                tilted_radiation, fetched_at
            )
            SELECT 'historical', w.latitude, w.longitude,
                   COALESCE(s.timezone, 'Europe/Istanbul'), w.tilt, w.azimuth,
                   w.weather_time, w.temperature, w.wind_speed, w.cloud_cover,
                   w.shortwave_radiation, w.tilted_radiation, w.fetched_at
            FROM historical_weather_data w JOIN sites s ON s.id = w.site_id
        """)
