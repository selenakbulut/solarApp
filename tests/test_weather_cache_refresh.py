from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import requests

from backend.database import transaction
from backend.errors import WeatherError
from backend.repositories.sites import SiteRepository
from backend.services.weather import _needs_refresh
from tests.conftest import fake_weather
from tests.test_api import create, count


def changing_response(system, *, incomplete=False):
    def get(url, *, params, timeout):
        system.calls.append((url, params))
        payload = fake_weather(params)
        hourly = payload['hourly']
        hourly['temperature_2m'] = [30.0] * len(hourly['time'])
        if incomplete:
            for key in hourly:
                hourly[key] = hourly[key][:1]
        return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: payload)
    system.app.state.weather.http_get = get


def test_six_hour_refresh_preserves_saved_and_legacy_inputs(system):
    first = create(system)
    changing_response(system)
    system.now[0] += timedelta(hours=6) - timedelta(seconds=1)
    assert create(system)['hourly'] == first['hourly']
    assert len(system.calls) == 1
    system.now[0] += timedelta(seconds=1)
    second = create(system)
    assert len(system.calls) == 2
    assert second['hourly'][0]['temperature'] == 30
    assert second['metadata']['weather_fetched_at'] != first['metadata']['weather_fetched_at']
    assert system.client.get(f"/forecasts/{first['run']['id']}").json()['hourly'] == first['hourly']
    with transaction(system.settings.db_path) as db:
        # Simulate a legacy run that relies on weather_data instead of snapshots.
        db.execute('DELETE FROM forecast_hour_inputs WHERE run_id=?', (first['run']['id'],))
    assert system.client.get(f"/forecasts/{first['run']['id']}").json()['hourly'] == first['hourly']
    assert count(system, 'raw_api_responses') == 2
    create(system)
    assert len(system.calls) == 2


def test_archive_refreshes_at_24_hours_but_old_archive_stays_cached(system):
    service = system.app.state.weather
    site = SiteRepository(system.settings.db_path).get(12)
    for hours in [['2026-10-24T12:00'], ['2026-10-10T12:00']]:
        service.ensure_hours(site, 'historical', hours)
    changing_response(system)
    system.now[0] += timedelta(hours=24) - timedelta(seconds=1)
    assert service.ensure_hours(site, 'historical', ['2026-10-24T12:00'])[1] == 'cache'
    system.now[0] += timedelta(seconds=1)
    rows, source = service.ensure_hours(site, 'historical', ['2026-10-24T12:00'])
    assert source == 'open_meteo' and rows[0]['temperature'] == 30
    rows, source = service.ensure_hours(site, 'historical', ['2026-10-10T12:00'])
    assert source == 'cache' and rows[0]['temperature'] == 20
    assert len(system.calls) == 3


def test_partial_refresh_cannot_silently_reuse_stale_hours(system):
    service = system.app.state.weather
    site = SiteRepository(system.settings.db_path).get(12)
    hours = ['2026-10-27T12:00']
    first, _ = service.ensure_hours(site, 'forecast', hours)
    system.now[0] += timedelta(hours=6)
    changing_response(system, incomplete=True)
    with pytest.raises(WeatherError):
        service.ensure_hours(site, 'forecast', hours)
    key = ('forecast', site['latitude'], site['longitude'], site['timezone'], site['tilt'], site['azimuth'])
    assert service.repo.read_hours(key, hours[0], hours[-1]) == first
    with transaction(system.settings.db_path) as db:
        assert db.execute('SELECT success FROM api_requests ORDER BY id DESC LIMIT 1').fetchone()[0] == 0


def test_refresh_network_failure_returns_explicit_old_run(system):
    first = create(system)
    system.now[0] += timedelta(hours=6)
    def fail(*args, **kwargs):
        raise requests.ConnectionError('offline')
    system.app.state.weather.http_get = fail
    response = system.client.post('/forecasts', json={'site_id': 12})
    assert response.status_code == 200
    result = response.json()
    assert result['is_fallback'] and result['warning']
    assert result['run']['id'] == first['run']['id']


def test_archive_boundary_uses_local_production_day():
    now = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
    def row(hour):
        return {'weather_time': hour, 'fetched_at': '2026-11-01T00:00:00+00:00'}
    assert _needs_refresh(row('2026-11-03T01:00'), 'historical', now, now.date())
    assert not _needs_refresh(row('2026-11-03T00:00'), 'historical', now, now.date())


@pytest.mark.parametrize('stamp', [None, 'bad', '2026-11-10T00:00:00', '2026-12-01T00:00:00+00:00'])
def test_unknown_or_future_fetch_time_is_refreshed(stamp):
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    assert _needs_refresh({'weather_time': '2026-11-11T12:00', 'fetched_at': stamp}, 'forecast', now, now.date())
