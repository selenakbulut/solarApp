import json
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

from ..database import transaction
from ..errors import QuotaError


class WeatherRepository:
    def __init__(self, db_path):
        self.db_path = db_path

    def daily_usage(self, now, connection=None):
        local = now.astimezone(ZoneInfo("Europe/Istanbul"))
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        bounds = (start.astimezone(timezone.utc).isoformat(),
                  (start + timedelta(days=1)).astimezone(timezone.utc).isoformat())
        sql = """SELECT COUNT(*) FROM api_requests
                 WHERE datetime(requested_at) >= datetime(?)
                   AND datetime(requested_at) < datetime(?)"""
        if connection is not None:
            return connection.execute(sql, bounds).fetchone()[0]
        with transaction(self.db_path) as db:
            return db.execute(sql, bounds).fetchone()[0]

    def reserve_request(self, endpoint, now, limit):
        with transaction(self.db_path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            used = self.daily_usage(now, connection)
            if used >= limit:
                raise QuotaError(f"Günlük hava servisi sınırı dolu: {used}/{limit}.")
            return connection.execute("""
                INSERT INTO api_requests(requested_at, endpoint, status_code, success)
                VALUES (?, ?, NULL, 0)
            """, (now.isoformat(), endpoint)).lastrowid

    def finish_request(self, request_id, endpoint, params, payload, now, status, success):
        with transaction(self.db_path) as connection:
            if payload is not None:
                connection.execute("""
                    INSERT INTO raw_api_responses
                    (request_id, endpoint, params_json, payload_json, fetched_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (request_id, endpoint, json.dumps(params, sort_keys=True),
                      json.dumps(payload, ensure_ascii=False), now.isoformat()))
            connection.execute("UPDATE api_requests SET status_code=?, success=? WHERE id=?",
                               (status, int(success), request_id))

    def read_hours(self, key, first, last):
        with transaction(self.db_path) as connection:
            return [dict(row) for row in connection.execute("""
                SELECT weather_time, temperature, wind_speed, cloud_cover,
                       shortwave_radiation, tilted_radiation, fetched_at
                FROM weather_cache_hours
                WHERE kind=? AND latitude=? AND longitude=? AND timezone=?
                  AND tilt=? AND azimuth=? AND weather_time>=? AND weather_time<=?
                ORDER BY weather_time
            """, (*key, first, last))]

    def save_hours(self, key, site_id, rows, elevation=None):
        with transaction(self.db_path) as connection:
            connection.executemany("""
                INSERT OR IGNORE INTO weather_cache_hours
                (kind, latitude, longitude, timezone, tilt, azimuth, weather_time,
                 temperature, wind_speed, cloud_cover, shortwave_radiation,
                 tilted_radiation, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [(*key, *(row[name] for name in (
                'weather_time', 'temperature', 'wind_speed', 'cloud_cover',
                'shortwave_radiation', 'tilted_radiation', 'fetched_at'
            ))) for row in rows])
            if key[0] == 'forecast':
                connection.executemany("""
                    INSERT OR IGNORE INTO weather_data
                    (site_id, forecast_time, temperature, wind_speed, cloud_cover,
                     shortwave_radiation, tilted_radiation, tilt, azimuth, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [(site_id, r['weather_time'], r['temperature'], r['wind_speed'],
                       r['cloud_cover'], r['shortwave_radiation'], r['tilted_radiation'],
                       key[4], key[5], r['fetched_at']) for r in rows])
            else:
                connection.executemany("""
                    INSERT OR IGNORE INTO historical_weather_data
                    (site_id, latitude, longitude, weather_time, temperature,
                     wind_speed, cloud_cover, shortwave_radiation, tilted_radiation,
                     tilt, azimuth, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [(site_id, key[1], key[2], r['weather_time'], r['temperature'],
                       r['wind_speed'], r['cloud_cover'], r['shortwave_radiation'],
                       r['tilted_radiation'], key[4], key[5], r['fetched_at']) for r in rows])
            if elevation is not None:
                connection.execute("UPDATE sites SET elevation=? WHERE id=? AND elevation IS NULL",
                                   (elevation, site_id))

    def cached_location(self, query):
        with transaction(self.db_path) as connection:
            row = connection.execute("SELECT result_json FROM location_results WHERE query_name=?",
                                     (query,)).fetchone()
            if row:
                return json.loads(row[0])
            old = connection.execute("SELECT * FROM geocoding_cache WHERE query_name=?", (query,)).fetchone()
            if old:
                return [{"name": old['display_name'], **{key: old[key] for key in
                         ('latitude', 'longitude', 'elevation', 'timezone')}}]
        return None

    def save_location(self, query, result, now):
        with transaction(self.db_path) as connection:
            connection.execute("""
                INSERT OR REPLACE INTO location_results VALUES (?, ?, ?)
            """, (query, json.dumps(result, ensure_ascii=False), now.isoformat()))
