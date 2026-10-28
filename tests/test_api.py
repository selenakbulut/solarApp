from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
import requests

from backend.database import transaction
from backend.schemas import ForecastCreate
from tests.conftest import fake_weather


def create(system, site_id=12, **values):
    response = system.client.post('/forecasts', json={'site_id': site_id, **values})
    assert response.status_code == 201, response.text
    return response.json()


def count(system, table):
    with transaction(system.settings.db_path) as db:
        return db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]


def test_reading_pages_never_calls_open_meteo(system):
    for _ in range(3):
        for path in ['/health', '/sites', '/api-usage', '/sites/12/forecasts', '/sites/12/losses', '/sites/12/actuals']:
            assert system.client.get(path).status_code == 200
    assert system.calls == []
    assert count(system, 'api_requests') == 0


@pytest.mark.parametrize('site_id', [12, 13, 14])
def test_create_complete_72_hours_and_daily_totals(system, site_id):
    data = create(system, site_id)
    assert data['run']['site_id'] == site_id
    assert len(data['hourly']) == 72
    assert data['hourly'][0]['forecast_time'] == '2026-10-27T01:00'
    assert data['hourly'][-1]['forecast_time'] == '2026-10-30T00:00'
    assert len(data['daily']) == 3
    assert all(day['hour_count'] == 24 and day['complete_day'] for day in data['daily'])
    assert sum(x['predicted_energy_kwh'] for x in data['hourly']) == pytest.approx(
        sum(x['predicted_energy_kwh'] for x in data['daily']))
    assert all(row['predicted_energy_kwh'] == 0 for row in data['hourly'] if row['tilted_radiation'] == 0)
    assert data['metadata']['timestamp_semantics'] == 'interval_end'


def test_full_response_stored_and_repeat_uses_cache_and_preserves_versions(system):
    first = create(system)
    assert count(system, 'weather_cache_hours') == 96
    assert count(system, 'raw_api_responses') == 1
    second = create(system)
    assert len(system.calls) == 1
    assert count(system, 'api_requests') == 1
    assert first['run']['id'] != second['run']['id']
    assert count(system, 'forecast_results') == 144
    assert system.client.get(f"/forecasts/{first['run']['id']}").status_code == 200


def test_same_location_across_sites_reuses_cache(system):
    create(system)
    with transaction(system.settings.db_path) as db:
        db.execute('UPDATE sites SET latitude=37.075739, longitude=36.804529, tilt=20 WHERE id=14')
    create(system, 14)
    assert len(system.calls) == 1


def test_concurrent_identical_weather_query_is_deduplicated(system):
    def run(_):
        return system.app.state.forecasts.create(ForecastCreate(site_id=12))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert len(system.calls) == 1
    assert len({result['run']['id'] for result in results}) == 2


def test_bad_forecast_input_rejected_before_network(system):
    for body in ({'site_id': 12, 'tilt': 91}, {'site_id': 12, 'panel_count': -1},
                 {'site_id': 12, 'ac_power_kw': 0}, {'site_id': 12, 'temperature_coefficient': 'NaN'},
                 {'site_id': 12, 'source': 'historical'}, {'site_id': 12, 'unused': 1}):
        assert system.client.post('/forecasts', json=body).status_code == 422
    assert system.client.post('/forecasts', json={'site_id': 999}).status_code == 404
    assert system.calls == []


def test_network_failure_logs_attempt_without_creating_forecast(system):
    def fail(*args, **kwargs):
        raise requests.ConnectionError('Simulated offline')
    system.app.state.weather.http_get = fail
    response = system.client.post('/forecasts', json={'site_id': 12})
    assert response.status_code == 502
    assert count(system, 'forecast_runs') == 0
    assert count(system, 'api_requests') == 1
    with transaction(system.settings.db_path) as db:
        assert db.execute('SELECT success FROM api_requests').fetchone()[0] == 0


def test_offline_fallback_has_warning_and_no_new_version(system):
    first = create(system)
    system.now[0] += timedelta(days=10)
    def fail(*args, **kwargs):
        raise requests.ConnectionError('Simulated offline')
    system.app.state.weather.http_get = fail
    response = system.client.post('/forecasts', json={'site_id': 12})
    assert response.status_code == 200
    assert response.json()['is_fallback'] is True
    assert response.json()['run']['id'] == first['run']['id']
    assert response.json()['warning']
    assert count(system, 'forecast_runs') == 1


def test_quota_counts_requests_atomically_and_blocks_network(system):
    system.client.get('/geocoding', params={'name': 'Ankara'})
    object.__setattr__(system.app.state.weather.settings, 'daily_api_limit', 1)
    response = system.client.post('/forecasts', json={'site_id': 12})
    assert response.status_code == 429
    assert len(system.calls) == 1
    assert count(system, 'api_requests') == 1


def test_geocoding_uses_persistent_cache(system):
    first = system.client.get('/geocoding', params={'name': 'Ankara'})
    second = system.client.get('/geocoding', params={'name': ' ankara '})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(system.calls) == 1


def test_invalid_weather_is_logged_and_raw_response_is_retained(system):
    from types import SimpleNamespace
    def invalid(url, params, timeout):
        payload = fake_weather(params)
        del payload['hourly']['global_tilted_irradiance']
        return SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: payload)
    system.app.state.weather.http_get = invalid
    assert system.client.post('/forecasts', json={'site_id': 12}).status_code == 502
    assert count(system, 'raw_api_responses') == 1
    assert count(system, 'forecast_runs') == 0


def test_actual_start_end_alignment_units_and_rollback(system):
    response = system.client.post('/actuals/import', json={'timestamp_label': 'start', 'rows': [
        {'site_id': 12, 'production_time': '2026-10-20T14:00:00', 'actual_energy_kwh': 1000}
    ]})
    assert response.status_code == 200
    assert system.client.get('/sites/12/actuals').json() == [
        {'production_time': '2026-10-20T15:00', 'actual_energy_kwh': 1000}]
    invalid = system.client.post('/actuals/import', json={'rows': [
        {'site_id': 12, 'production_time': '2026-10-20T16:00', 'actual_energy_kwh': 10},
        {'site_id': 12, 'production_time': '2026-10-20T17:30', 'actual_energy_kwh': 10},
    ]})
    assert invalid.status_code == 422
    assert count(system, 'actual_production') == 1


def test_actual_duplicate_invalid_site_and_negative_are_rejected(system):
    row = {'site_id': 12, 'production_time': '2026-10-20T15:00', 'actual_energy_kwh': 10}
    assert system.client.post('/actuals/import', json={'rows': [row, row]}).status_code == 422
    assert system.client.post('/actuals/import', json={'rows': [{**row, 'site_id': 999}]}).status_code == 404
    assert system.client.post('/actuals/import', json={'rows': [{**row, 'actual_energy_kwh': -1}]}).status_code == 422
    assert count(system, 'actual_production') == 0


def test_hourly_daily_deviation_zero_and_missing_coverage(system):
    forecast = create(system)
    hours = forecast['hourly']
    rows = [{'site_id': 12, 'production_time': hour['forecast_time'],
             'actual_energy_kwh': hour['predicted_energy_kwh'] / 2} for hour in hours[:24]]
    assert system.client.post('/actuals/import', json={'rows': rows}).status_code == 200
    report = system.client.get(f"/forecasts/{forecast['run']['id']}/comparison").json()
    assert report['metrics']['hour_count'] == 24
    assert len(report['missing_actual_hours']) == 48
    assert report['daily'][0]['complete_day']
    assert report['daily'][0]['percentage_deviation'] == pytest.approx(100)
    assert all(row['percentage_deviation'] is None for row in report['hourly'] if row['actual_energy_kwh'] == 0)
    assert all(row['percentage_deviation'] == pytest.approx(100) for row in report['hourly'] if row['actual_energy_kwh'] > 0)


def test_loss_snapshots_exports_and_scenarios(system):
    first = create(system)
    losses = {name: 0.03 for name in ('soiling_loss', 'reflection_loss', 'mismatch_loss',
        'dc_cable_loss', 'ac_cable_loss', 'transformer_loss', 'shading_loss', 'availability_loss', 'snow_loss')}
    assert system.client.put('/sites/12/losses', json=losses).status_code == 200
    second = create(system)
    assert second['assumptions']['dc_loss'] > first['assumptions']['dc_loss']
    assert system.client.get(f"/forecasts/{first['run']['id']}").json()['run']['soiling_loss'] is None
    scenario = system.client.get('/scenarios/compare', params={'first_run_id': first['run']['id'], 'second_run_id': second['run']['id']})
    assert scenario.status_code == 200 and len(scenario.json()['hourly']) == 72
    assert system.client.get(f"/forecasts/{first['run']['id']}/export?format=csv").status_code == 200
    excel = system.client.get(f"/forecasts/{first['run']['id']}/export?format=xlsx")
    assert excel.status_code == 200 and excel.content.startswith(b'PK')


def test_historical_forward_caches_are_separate_and_versioned(system):
    history = create(system, source='historical', start_date='2026-10-10', end_date='2026-10-12')
    assert history['metadata']['source'] == 'historical'
    assert len(history['hourly']) == 72
    assert 'archive-api' in system.calls[0][0]
    repeat = create(system, source='historical', start_date='2026-10-10', end_date='2026-10-12')
    assert len(system.calls) == 1
    assert history['run']['id'] != repeat['run']['id']
    assert system.client.get('/sites/12/forecasts/latest').status_code == 404


def test_create_site_and_duplicate(system):
    body = dict(name='Yeni GES', latitude=39.93, longitude=32.85, panel_count=20,
                panel_power_wp=500, ac_power_kw=8, site_age_years=0,
                tilt=20, azimuth=0, timezone='Europe/Istanbul')
    assert system.client.post('/sites', json=body).status_code == 201
    assert system.client.post('/sites', json=body).status_code == 409
    assert system.client.post('/sites', json={**body, 'latitude': 95}).status_code == 422
    assert system.calls == []


def test_baseline_and_model_are_compared_on_identical_matched_hours(system):
    forecast = create(system)
    first, second = forecast['hourly'][9], forecast['hourly'][10]
    prior = (datetime.fromisoformat(first['forecast_time']) - timedelta(days=1)).isoformat()
    body = {'rows': [
        {'site_id': 12, 'production_time': first['forecast_time'], 'actual_energy_kwh': first['predicted_energy_kwh'] + 10},
        {'site_id': 12, 'production_time': second['forecast_time'], 'actual_energy_kwh': second['predicted_energy_kwh'] + 100},
        {'site_id': 12, 'production_time': prior, 'actual_energy_kwh': first['predicted_energy_kwh'] + 5},
    ]}
    assert system.client.post('/actuals/import', json=body).status_code == 200
    report = system.client.get(f"/forecasts/{forecast['run']['id']}/comparison").json()
    assert report['metrics']['mae_kwh'] == pytest.approx(55)
    assert report['baseline']['matched_hours'] == 1
    assert report['baseline']['model_metrics_same_hours']['mae_kwh'] == pytest.approx(10)
    assert report['baseline']['mae_kwh'] == pytest.approx(5)


def test_timezone_aware_actual_is_converted_to_site_time(system):
    row = {'site_id': 12, 'production_time': '2026-10-20T23:00:00+00:00', 'actual_energy_kwh': 10}
    assert system.client.post('/actuals/import', json={'rows': [row]}).status_code == 200
    assert system.client.get('/sites/12/actuals').json()[0]['production_time'] == '2026-10-21T02:00'
