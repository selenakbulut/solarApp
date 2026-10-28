from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.application import create_app
from backend.database import transaction
from backend.settings import Settings


def fake_weather(params):
    current = datetime.fromisoformat(params['start_date'])
    stop = datetime.fromisoformat(params['end_date']) + timedelta(days=1)
    times = []
    while current < stop:
        times.append(current.strftime('%Y-%m-%dT%H:%M'))
        current += timedelta(hours=1)
    radiation = [600.0 if 9 <= int(hour[11:13]) <= 16 else 0.0 for hour in times]
    return {'elevation': 850.0, 'hourly': {
        'time': times, 'temperature_2m': [20.0] * len(times),
        'wind_speed_10m': [5.0] * len(times), 'cloud_cover': [40.0] * len(times),
        'shortwave_radiation': radiation, 'global_tilted_irradiance': radiation,
    }}


@pytest.fixture
def system(tmp_path):
    calls = []
    now = [datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc)]

    def http_get(url, *, params, timeout):
        calls.append((url, params))
        payload = ({'results': [{'name': 'Ankara', 'latitude': 39.93, 'longitude': 32.85,
                                'elevation': 850, 'timezone': 'Europe/Istanbul'}]}
                   if 'geocoding' in url else fake_weather(params))
        return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: payload)

    settings = Settings(tmp_path / 'solar.db')
    app = create_app(settings, http_get=http_get, clock=lambda: now[0])
    with TestClient(app) as client:
        with transaction(settings.db_path) as db:
            db.executemany('''
                INSERT INTO sites(id, name, latitude, longitude, tilt, azimuth,
                    panel_count, panel_power_wp, ac_power_kw, site_age_years, timezone)
                VALUES (?, ?, ?, ?, ?, 0, ?, 550, ?, ?, 'Europe/Istanbul')
            ''', [(12, 'Saha 1', 37.075739, 36.804529, 20, 91327, 39700, 2),
                  (13, 'Saha 2', 40.862088, 33.094728, 25, 17854, 7500, 3),
                  (14, 'Saha 3', 38.275934, 39.741377, 20, 7123, 3500, 1)])
        yield SimpleNamespace(client=client, app=app, settings=settings, calls=calls, now=now)
