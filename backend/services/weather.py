import math
import threading
from datetime import datetime, timedelta, timezone

import requests

from ..errors import WeatherError
from ..repositories.weather import WeatherRepository

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FIELDS = {
    'temperature': 'temperature_2m', 'wind_speed': 'wind_speed_10m',
    'cloud_cover': 'cloud_cover', 'shortwave_radiation': 'shortwave_radiation',
    'tilted_radiation': 'global_tilted_irradiance',
}


def utc_now():
    return datetime.now(timezone.utc)


class WeatherService:
    def __init__(self, settings, http_get=None, clock=None):
        self.settings = settings
        self.repo = WeatherRepository(settings.db_path)
        self.http_get = http_get or requests.get
        self.clock = clock or utc_now
        self.lock = threading.RLock()

    def request_json(self, url, params, validator):
        now = self.clock()
        request_id = self.repo.reserve_request(url, now, self.settings.daily_api_limit)
        payload, status, success = None, None, False
        try:
            response = self.http_get(url, params=params, timeout=self.settings.request_timeout)
            status = response.status_code
            response.raise_for_status()
            payload = response.json()
            result = validator(payload)
            success = True
            return result
        except (requests.RequestException, ValueError, KeyError, TypeError) as error:
            raise WeatherError(f"Open-Meteo verisi alınamadı veya geçersiz: {error}") from error
        finally:
            self.repo.finish_request(request_id, url, params, payload, now, status, success)

    def geocode(self, name):
        query = name.strip().casefold()
        if len(query) < 2:
            raise ValueError("Konum adı en az iki karakter olmalı.")
        with self.lock:
            cached = self.repo.cached_location(query)
            if cached is not None:
                return cached

            def validate(payload):
                results = payload.get('results', [])
                if not isinstance(results, list):
                    raise ValueError("Konum yanıtı geçersiz.")
                for place in results:
                    if not all(key in place for key in ('name', 'latitude', 'longitude')):
                        raise ValueError("Konum alanları eksik.")
                return results

            result = self.request_json(GEOCODING_URL, {
                'name': name.strip(), 'count': 5, 'language': 'tr', 'format': 'json'
            }, validate)
            self.repo.save_location(query, result, self.clock())
            return result

    def ensure_hours(self, site, kind, expected):
        key = (kind, site['latitude'], site['longitude'], site['timezone'], site['tilt'], site['azimuth'])
        with self.lock:
            cached = self.repo.read_hours(key, expected[0], expected[-1])
            present = {row['weather_time'] for row in cached}
            missing_days = sorted({hour[:10] for hour in expected if hour not in present})
            source = 'cache'
            for first_day, last_day in _consecutive_days(missing_days):
                params = {
                    'latitude': site['latitude'], 'longitude': site['longitude'],
                    'hourly': ','.join(FIELDS.values()), 'tilt': site['tilt'],
                    'azimuth': site['azimuth'], 'timezone': site['timezone'],
                    'start_date': first_day, 'end_date': last_day,
                }
                payload = self.request_json(
                    FORECAST_URL if kind == 'forecast' else ARCHIVE_URL,
                    params, _validate_weather,
                )
                fetched_at = self.clock().isoformat()
                hourly = payload['hourly']
                rows = [dict(weather_time=hour, fetched_at=fetched_at,
                             **{key: float(hourly[field][i]) for key, field in FIELDS.items()})
                        for i, hour in enumerate(hourly['time'])]
                elevation = payload.get('elevation')
                if not isinstance(elevation, (int, float)) or not math.isfinite(elevation):
                    elevation = None
                self.repo.save_hours(key, site['id'], rows, elevation)
                source = 'open_meteo'
            result = self.repo.read_hours(key, expected[0], expected[-1])
            if [row['weather_time'] for row in result] != expected:
                raise WeatherError("Hava yanıtında istenen saatlerin tamamı bulunamadı.")
            self.repo.save_hours(key, site['id'], result)
            return result, source


def _validate_weather(payload):
    hourly = payload.get('hourly')
    if not isinstance(hourly, dict):
        raise ValueError("hourly alanı yok.")
    times = hourly.get('time')
    if not isinstance(times, list) or not times or len(times) != len(set(times)):
        raise ValueError("Saatler boş veya yineleniyor.")
    for hour in times:
        parsed = datetime.fromisoformat(hour)
        if parsed.minute or parsed.second or parsed.microsecond or parsed.tzinfo:
            raise ValueError("Beklenmeyen saat etiketi.")
    for field in FIELDS.values():
        values = hourly.get(field)
        if not isinstance(values, list) or len(values) != len(times):
            raise ValueError(f"Eksik hava alanı: {field}")
        if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in values):
            raise ValueError(f"Geçersiz hava değeri: {field}")
    return payload


def _consecutive_days(days):
    if not days:
        return []
    groups, first, previous = [], days[0], days[0]
    for day in days[1:]:
        if datetime.fromisoformat(day) - datetime.fromisoformat(previous) != timedelta(days=1):
            groups.append((first, previous))
            first = day
        previous = day
    return groups + [(first, previous)]
