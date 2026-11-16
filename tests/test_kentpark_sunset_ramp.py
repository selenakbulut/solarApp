from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from backend.model import calculate_production
from backend.services import kentpark_candidate
from tests.conftest import fake_weather


def test_october_model_applies_only_to_kentpark_hourly_results(system, monkeypatch):
    def sunset(day, lat, lon, zone):
        return datetime(day.year, day.month, day.day, 17, 45, tzinfo=ZoneInfo(zone))

    monkeypatch.setattr(kentpark_candidate, 'sunset_on_date', sunset)

    def get_weather(url, *, params, timeout):
        payload = fake_weather(params)
        hourly = payload['hourly']
        for index, stamp in enumerate(hourly['time']):
            if stamp.endswith('T17:00'):
                hourly['global_tilted_irradiance'][index] = 200.0
            elif stamp.endswith('T18:00'):
                hourly['global_tilted_irradiance'][index] = 15.0
        return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: payload)

    system.app.state.weather.http_get = get_weather
    for site_id in (13, 12):
        response = system.client.post('/forecasts', json={'site_id': site_id, 'forecast_days': 1})
        assert response.status_code == 201
        result = response.json()
        expected_version = kentpark_candidate.KENTPARK_MONTHLY_VERSION if site_id == 13 else 'v1.0'
        assert result['run']['model_version'] == expected_version
        run = result['run']
        hourly = {row['forecast_time'][-5:]: row for row in result['hourly']}
        for hour, kentpark_factor in [('09:00', 1), ('12:00', 1), ('17:00', 19 / 28), ('18:00', 0)]:
            row = hourly[hour]
            base, _ = calculate_production(
                row['tilted_radiation'], row['temperature'],
                run['panel_count'] * run['panel_power_wp'] / 1000,
                run['ac_power_kw'], run['site_age_years'],
            )
            assert base > 0
            factor = kentpark_factor if site_id == 13 else 1
            expected = base
            if site_id == 13:
                if hour == '17:00':
                    next_base = calculate_production(15, 20, 9819.7, 7500, 3)[0]
                    expected += kentpark_candidate.OCTOBER_TIMING_WEIGHT * (next_base - base)
                expected *= factor
            assert row['predicted_energy_kwh'] == pytest.approx(expected)
        if site_id == 13:
            preview = system.client.get(f"/forecasts/{run['id']}/kentpark-candidate")
            assert preview.status_code == 200
            row = next(row for row in preview.json()['hourly'] if row['forecast_time'].endswith('T17:00'))
            assert row['selected_energy_kwh'] == hourly['17:00']['predicted_energy_kwh']
            assert row['selected_model'] == kentpark_candidate.OCTOBER_MODEL


def test_kentpark_forecast_selects_model_by_production_day(system, monkeypatch):
    system.now[0] = datetime.fromisoformat('2026-10-30T09:00:00+00:00')
    monkeypatch.setattr(
        kentpark_candidate, 'daylight_minutes',
        lambda day, lat, lon, zone: 626 if day.day == 31 else 625,
    )
    monkeypatch.setattr(
        kentpark_candidate, 'sunset_on_date',
        lambda day, lat, lon, zone: datetime(day.year, day.month, day.day, 17, 40, tzinfo=ZoneInfo(zone)),
    )

    def get_weather(url, *, params, timeout):
        payload = fake_weather(params)
        payload['hourly']['temperature_2m'] = [2.5] * len(payload['hourly']['time'])
        return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: payload)

    system.app.state.weather.http_get = get_weather
    response = system.client.post('/forecasts', json={'site_id': 13, 'forecast_days': 2})
    assert response.status_code == 201
    result = response.json()
    run_id = result['run']['id']
    rows = {row['forecast_time']: row for row in result['hourly']}
    base = calculate_production(600, 2.5, 9819.7, 7500, 3)[0]
    assert rows['2026-10-31T09:00']['predicted_energy_kwh'] == pytest.approx(base)
    assert rows['2026-11-01T09:00']['predicted_energy_kwh'] == pytest.approx(base * 0.425)
    assert system.client.post('/actuals/import', json={'rows': [{
        'site_id': 13, 'production_time': '2026-11-01T09:00',
        'actual_energy_kwh': base * 0.425,
    }]}).status_code == 200
    preview = system.client.get(f'/forecasts/{run_id}/kentpark-candidate').json()
    saved = {row['forecast_time']: row for row in preview['hourly']}
    assert saved['2026-11-01T00:00']['selected_model'] == kentpark_candidate.OCTOBER_MODEL
    assert saved['2026-11-01T09:00']['selected_model'] == kentpark_candidate.SHORT_DAY_MODEL
    assert saved['2026-11-01T09:00']['selected_success_percent'] == pytest.approx(100)
    assert all(row['selected_energy_kwh'] == rows[time]['predicted_energy_kwh'] for time, row in saved.items())
    assert [row['selected_model'] for row in preview['daily']] == [
        kentpark_candidate.OCTOBER_MODEL, kentpark_candidate.SHORT_DAY_MODEL,
    ]
    assert preview['daily'][1]['selected_success_percent'] == pytest.approx(100)


@pytest.mark.parametrize(('stamp', 'temperature', 'cloud', 'radiation', 'factor'), [
    ('2026-11-09T09:00', -2.0, 0, 261.6, 1.0),
    ('2026-11-10T09:00', -1.7, 7, 267.6, 0.425),
    ('2026-11-10T10:00', 0.2, 15, 529.7, 0.50),
    ('2026-11-10T12:00', 4.7, 32, 776.0, 0.968),
    ('2026-11-10T13:00', 6.2, 54, 745.2, 0.946),
    ('2026-11-06T15:00', 3.2, 68, 475.7, 0.932),
    ('2026-11-10T15:00', 7.9, 98, 596.6, 0.608),
    ('2026-11-09T17:00', 3.4, 2, 273.4, 0.35),
    ('2026-11-09T18:00', 2.5, 0, 29.9, 0.0),
])
def test_short_day_conditions(stamp, temperature, cloud, radiation, factor):
    def calculate(radiation, temperature):
        return calculate_production(radiation, temperature, 9819.7, 7500, 3)

    base = calculate(radiation, temperature)[0]
    row = {'forecast_time': stamp, 'temperature': temperature, 'cloud_cover': cloud,
           'tilted_radiation': radiation, 'predicted_energy_kwh': base}
    predicted = kentpark_candidate.monthly_forecast_energy(
        kentpark_candidate.SITE, row, {}, calculate, 7350,
    )
    assert predicted == pytest.approx(base * factor)
