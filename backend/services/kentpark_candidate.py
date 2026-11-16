import math
from collections import defaultdict
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from ..model import calculate_production
from ..repositories.sites import LOSS_COLUMNS
from .comparison import production_day
from .production_adjustments import GENERAL_MODEL_VERSION
from .solar import interval_solar_context, solar_noon_on_date, sunset_on_date


SITE = {'id': 13, 'latitude': 40.862088, 'longitude': 33.094728, 'timezone': 'Europe/Istanbul'}
HOUR = timedelta(hours=1)
OCTOBER_TIMING_WEIGHT = 0.7485977192500309
LEGACY_MONTHLY_VERSION = 'v1.3-kentpark-monthly'
PREVIOUS_SOLAR_VERSION = 'v1.4-kentpark-solar-conditions'
KENTPARK_MONTHLY_VERSION = 'v1.5-kentpark-solar-conditions'
OCTOBER_MODEL = 'Zamanlama + gün batımı'
NOVEMBER_MODEL = 'Soğuk hava'
SHORT_DAY_MODEL = 'Güneş konumu + hava koşulları'
SHORT_DAY_MINUTES = 625
ENERGY_COLUMNS = (
    'kayitli_kwh', 'gun_batimi_kwh', 'sabah_kwh', 'ogle_kwh', 'aksam_azaltma_kwh', 'birlesik_kwh',
)


def is_kentpark(site):
    return (site['id'] == 13
            and abs(site['latitude'] - 40.862088) < 0.001
            and abs(site['longitude'] - 33.094728) < 0.001)


def below_kentpark_sunset_cutoff(site, weather_time, radiation):
    if radiation >= 20:
        return False
    zone = ZoneInfo(site['timezone'])
    end = datetime.fromisoformat(weather_time).replace(tzinfo=zone)
    day = (end - timedelta(hours=1)).date()
    sunset = sunset_on_date(day, site['latitude'], site['longitude'], site['timezone'])
    return sunset is not None and end - sunset >= timedelta(minutes=15)


def kentpark_sunset_factor(site, weather_time, radiation):
    zone = ZoneInfo(site['timezone'])
    end = datetime.fromisoformat(weather_time)
    end = end.replace(tzinfo=zone) if end.tzinfo is None else end.astimezone(zone)
    day = (end - timedelta(hours=1)).date()
    sunset = sunset_on_date(day, site['latitude'], site['longitude'], site['timezone'])
    if sunset is None:
        return 1.0

    minutes_before_sunset = (sunset - end).total_seconds() / 60
    if radiation < 20 and minutes_before_sunset <= -15:
        return 0.0
    reduction_weight = max(0.0, min(1.0, (90 - minutes_before_sunset) / 105))
    return 1 - 0.75 * reduction_weight


def nonnegative(row, column):
    value = float(row[column])
    if not math.isfinite(value) or value < 0:
        raise ValueError(f'Geçersiz {column}: {value}')
    return value


def solar_noon(day, latitude=SITE['latitude'], longitude=SITE['longitude'], timezone=SITE['timezone']):
    return solar_noon_on_date(day, latitude, longitude, timezone)


def evaluate(end, weather, actual=None, *, site=SITE, calculate_energy=None, capacity_kwh=7350):
    radiation = nonnegative(weather, 'tilted_radiation')
    cloud = nonnegative(weather, 'cloud_cover')
    if cloud > 100:
        raise ValueError('Bulutluluk 0–100 aralığında olmalı.')
    recorded = nonnegative(weather, 'predicted_energy_kwh')
    start = end - HOUR
    day = start.date()
    label = end.isoformat(timespec='minutes')
    base = 0.0 if below_kentpark_sunset_cutoff(site, label, radiation) else recorded
    sunrise_delta = 0.0
    noon_delta = 0.0
    evening_delta = 0.0

    if 0 < radiation < 20 and base > 0:
        solar = interval_solar_context(label, site['latitude'], site['longitude'], site['timezone'])
        if solar['phase'] == 'sunrise':
            temperature = float(weather['temperature'])
            if calculate_energy is None:
                replay = calculate_production(radiation, temperature, 9819.7, 7500, 3)[0]
                if not math.isclose(replay, recorded, abs_tol=1e-6, rel_tol=0):
                    raise ValueError(f'{label}: Kayıtlı tahmin Kentpark deney parametreleriyle uyuşmuyor.')
                increased = calculate_production(1.25 * radiation, temperature, 9819.7, 7500, 3)[0]
            else:
                increased = calculate_energy(1.25 * radiation, temperature)[0]
            sunrise_delta = increased - base

    if cloud > 90 and radiation < 300 and base > 0:
        noon = solar_noon(day, site['latitude'], site['longitude'], site['timezone']).replace(tzinfo=None)
        overlap = min(end, noon + 2 * HOUR) - max(start, noon - 2 * HOUR)
        hour_weight = max(0.0, overlap / HOUR)
        radiation_weight = min(1.0, (300 - radiation) / 150)
        multiplier = 1 + 0.445 * ((cloud - 90) / 10) * hour_weight * radiation_weight
        noon_delta = min(capacity_kwh, base * multiplier) - base if hour_weight else 0.0

    sunset = sunset_on_date(day, site['latitude'], site['longitude'], site['timezone'])
    minutes_before_sunset = (sunset.replace(tzinfo=None) - end).total_seconds() / 60
    if 10 < minutes_before_sunset <= 45:
        evening_delta = -0.25 * base

    values = (
        recorded, base, base + sunrise_delta, base + noon_delta,
        base + evening_delta, base + sunrise_delta + noon_delta + evening_delta,
    )
    row = {'saat_bitisi': label, 'gercek_kwh': actual, 'egimli_isinim_w_m2': radiation,
           'bulut_yuzde': cloud, 'gun_batimina_dakika': minutes_before_sunset}
    row.update({key: round(value, 6) for key, value in zip(ENERGY_COLUMNS, values)})
    row.update({f'{key}_mutlak_hata': round(abs(value - actual), 6) if actual is not None else None
                for key, value in zip(ENERGY_COLUMNS, values)})
    return row


def october_energy(site, end, hour, baselines):
    baseline = baselines[end]
    next_hour = baselines.get(end + HOUR, baseline)
    time = hour['forecast_time']
    if next_hour != baseline:
        solar = interval_solar_context(time, site['latitude'], site['longitude'], site['timezone'])
        if solar['sun_above_horizon_fraction'] > 0:
            baseline += OCTOBER_TIMING_WEIGHT * (next_hour - baseline)
    return baseline * kentpark_sunset_factor(site, time, hour['tilted_radiation'])


def cold_weather_energy(end, hour, evaluated, *, allow_cold=True, nine_am_factor=0.50):
    radiation = evaluated['egimli_isinim_w_m2']
    combined = evaluated['birlesik_kwh']
    if radiation > 0 and 10 < evaluated['gun_batimina_dakika'] <= 45:
        return evaluated['kayitli_kwh'] * 0.35
    cold = allow_cold and hour['temperature'] <= 2.5 and (
        (end.hour in (9, 10, 11, 16, 17) and radiation >= 100)
        or (end.hour in (12, 13) and radiation >= 400)
    )
    if cold:
        if end.hour == 9:
            return combined * nine_am_factor
        return combined * (0.50 if end.hour == 10 or (end.hour == 11 and radiation >= 400) else 0.75)
    return combined


@lru_cache(maxsize=128)
def daylight_minutes(day, latitude, longitude, zone):
    sunset = sunset_on_date(day, latitude, longitude, zone)
    midnight = datetime.combine(day, datetime.min.time())
    for hour in range(1, 13):
        end = midnight + hour * HOUR
        solar = interval_solar_context(end.isoformat(timespec='minutes'), latitude, longitude, zone)
        for event in solar['events']:
            if event['kind'] == 'sunrise':
                return (sunset - datetime.fromisoformat(event['local_time'])).total_seconds() / 60
    raise ValueError('Kentpark için gün doğumu hesaplanamadı.')


def short_day_energy(site, end, hour, evaluated):
    remaining = evaluated['gun_batimina_dakika']
    radiation = evaluated['egimli_isinim_w_m2']
    if remaining <= -15 and radiation < 30:
        return 0.0
    if remaining <= 45:
        if 10 < remaining and radiation > 0:
            return evaluated['kayitli_kwh'] * 0.35
        return evaluated['gun_batimi_kwh']

    if evaluated['sabah_kwh'] != evaluated['gun_batimi_kwh']:
        return evaluated['sabah_kwh']

    cloud = hour['cloud_cover']
    temperature = hour['temperature']
    if cloud >= 30 and radiation >= 300 and temperature > 2.5:
        day = (end - HOUR).date()
        noon = solar_noon(day, site['latitude'], site['longitude'], site['timezone']).replace(tzinfo=None)
        if end >= noon - timedelta(minutes=45):
            strength = 0.10
            if end - HOUR / 2 >= noon and cloud >= 50 and temperature >= 4.0:
                strength = 0.40
            return evaluated['kayitli_kwh'] * (1 - strength * cloud / 100)

    return cold_weather_energy(end, hour, evaluated, allow_cold=cloud > 0, nine_am_factor=0.425)


def uses_short_day_model(site, day):
    return daylight_minutes(day, site['latitude'], site['longitude'], site['timezone']) <= SHORT_DAY_MINUTES


def monthly_forecast_energy(site, hour, baselines, calculate_energy, capacity_kwh):
    end = datetime.fromisoformat(hour['forecast_time'])
    day = (end - HOUR).date()
    if day.month in (10, 11):
        if not uses_short_day_model(site, day):
            return october_energy(site, end, hour, baselines)
        evaluated = evaluate(end, hour, site=site, calculate_energy=calculate_energy, capacity_kwh=capacity_kwh)
        return short_day_energy(site, end, hour, evaluated)
    return hour['predicted_energy_kwh'] * kentpark_sunset_factor(site, hour['forecast_time'], hour['tilted_radiation'])


def success_percent(predicted, actual):
    if actual is None:
        return None
    larger = max(predicted, actual)
    if larger == 0:
        return 100.0
    return min(predicted, actual) / larger * 100


def candidate_preview(forecast, meter_rows):
    run = forecast['run']
    metadata = forecast['metadata']
    assumptions = forecast['assumptions'] or {}
    site = {'id': run['site_id'], 'latitude': metadata.get('latitude'),
            'longitude': metadata.get('longitude'), 'timezone': metadata.get('timezone')}
    if (metadata.get('source') != 'forecast' or site['latitude'] is None
            or site['longitude'] is None or not is_kentpark(site)):
        raise ValueError('Birleşik aday için Kentpark’ın kayıtlı ileri tahminini seçin.')

    actuals = {row['production_time']: row['actual_energy_kwh'] for row in meter_rows}
    version = run['model_version']
    if version == GENERAL_MODEL_VERSION:
        return summarize_preview([{
            'forecast_time': hour['forecast_time'],
            'predicted_energy_kwh': hour['predicted_energy_kwh'],
            'actual_energy_kwh': actuals.get(hour['forecast_time']),
        } for hour in forecast['hourly']], model_label='Kayıtlı tahmin')
    if version in (KENTPARK_MONTHLY_VERSION, PREVIOUS_SOLAR_VERSION, LEGACY_MONTHLY_VERSION):
        return summarize_preview([{
            'forecast_time': hour['forecast_time'],
            'predicted_energy_kwh': hour['predicted_energy_kwh'],
            'actual_energy_kwh': actuals.get(hour['forecast_time']),
        } for hour in forecast['hourly']], saved_monthly=True,
            solar_site=site if run['model_version'] != LEGACY_MONTHLY_VERSION else None)

    dc_power = (run['panel_count'] or 0) * (run['panel_power_wp'] or 0) / 1000
    if (site['timezone'] != SITE['timezone'] or dc_power != 9819.7
            or run['ac_power_kw'] != 7500 or run['site_age_years'] != 3
            or run['tilt'] != 25 or run['azimuth'] != 0
            or run['model_version'] not in ('v1.0', 'v1.1-kentpark-sunset', 'v1.2-kentpark-sunset-ramp')
            or assumptions.get('temperature_coefficient') != -0.004
            or assumptions.get('dc_loss') != 0.05 or assumptions.get('ac_loss') != 0.02
            or any(run[key] is not None for key in LOSS_COLUMNS)):
        raise ValueError('Bu tahmin, Kentpark deneyinde kullanılan teknik ayarlarla uyuşmuyor.')

    recorded_has_ramp = run['model_version'] == 'v1.2-kentpark-sunset-ramp'
    baselines = {}
    for hour in forecast['hourly']:
        if any(hour.get(key) is None for key in ('temperature', 'tilted_radiation', 'cloud_cover')):
            raise ValueError('Kayıtlı tahminde aday hesabı için gerekli hava verileri eksik.')
        baseline = hour['predicted_energy_kwh']
        if run['model_version'] != 'v1.0':
            # Recover the production before any sunset adjustment.
            baseline, _ = calculate_production(
                radiation=hour['tilted_radiation'], air_temp=hour['temperature'],
                dc_power_kwp=dc_power, inverter_power_kw=run['ac_power_kw'],
                panel_age_years=run['site_age_years'],
                temperature_coefficient=assumptions['temperature_coefficient'],
            )
        baselines[datetime.fromisoformat(hour['forecast_time'])] = baseline

    rows = []
    for hour in forecast['hourly']:
        time = hour['forecast_time']
        end = datetime.fromisoformat(time)
        baseline = baselines[end]
        candidate_input = hour
        if recorded_has_ramp:
            candidate_input = {**hour, 'predicted_energy_kwh': baseline}
        evaluated = evaluate(end, candidate_input, actuals.get(time))
        sunset_factor = kentpark_sunset_factor(site, time, evaluated['egimli_isinim_w_m2'])
        month = (end - HOUR).month
        timing_and_sunset = round(october_energy(site, end, hour, baselines), 6) if month == 10 else None
        combined = evaluated['birlesik_kwh']
        cold_energy = cold_weather_energy(end, hour, evaluated)
        monthly_energy = None
        if month in (10, 11):
            if uses_short_day_model(site, (end - HOUR).date()):
                adjusted = evaluated
                if candidate_input['predicted_energy_kwh'] != baseline:
                    adjusted = evaluate(end, {**hour, 'predicted_energy_kwh': baseline}, site=site)
                monthly_energy = short_day_energy(site, end, hour, adjusted)
            else:
                monthly_energy = october_energy(site, end, hour, baselines)
        rows.append({
            'forecast_time': time,
            'predicted_energy_kwh': round(hour['predicted_energy_kwh'], 6),
            'sunset_ramp_energy_kwh': round(
                hour['predicted_energy_kwh'] if recorded_has_ramp
                else baseline * sunset_factor, 6
            ),
            'timing_sunset_energy_kwh': timing_and_sunset,
            'monthly_candidate_energy_kwh': round(monthly_energy, 6) if monthly_energy is not None else None,
            'candidate_energy_kwh': combined,
            'cold_morning_energy_kwh': round(cold_energy, 6),
            'actual_energy_kwh': evaluated['gercek_kwh'],
        })

    return summarize_preview(rows, solar_site=site)


def summarize_preview(rows, *, saved_monthly=False, solar_site=None, model_label=None):
    days = defaultdict(lambda: {'forecast_kwh': 0.0, 'matched_forecast_kwh': 0.0,
                                'actual_kwh': 0.0, 'matched_hours': 0, 'forecast_hours': 0})
    for row in rows:
        date = production_day(row['forecast_time'])
        month = int(date[5:7])
        model = model_label or {10: OCTOBER_MODEL, 11: NOVEMBER_MODEL}.get(month, 'Kayıtlı tahmin')
        if solar_site is not None and month in (10, 11):
            model = SHORT_DAY_MODEL if uses_short_day_model(solar_site, datetime.fromisoformat(date).date()) else OCTOBER_MODEL
        predicted = row.get('monthly_candidate_energy_kwh')
        if predicted is None:
            predicted = row['predicted_energy_kwh']
        actual = row['actual_energy_kwh']
        row.update(selected_model=model, selected_energy_kwh=predicted,
                   selected_success_percent=success_percent(predicted, actual))
        day = days[date]
        day['selected_model'] = model
        day['forecast_kwh'] += predicted
        day['forecast_hours'] += 1
        if actual is not None:
            day['matched_forecast_kwh'] += predicted
            day['actual_kwh'] += actual
            day['matched_hours'] += 1

    daily = []
    for date, day in sorted(days.items()):
        matched_hours = day['matched_hours']
        predicted = day['matched_forecast_kwh'] if matched_hours else day['forecast_kwh']
        actual = day['actual_kwh'] if matched_hours else None
        daily.append({'date': date, 'selected_model': day['selected_model'],
                      'selected_energy_kwh': predicted, 'actual_energy_kwh': actual,
                      'selected_success_percent': success_percent(predicted, actual),
                      'matched_hours': matched_hours, 'forecast_hours': day['forecast_hours']})

    matched = [row for row in rows if row['actual_energy_kwh'] is not None]
    def mae(key):
        errors = [abs(row[key] - row['actual_energy_kwh']) for row in matched if row.get(key) is not None]
        return sum(errors) / len(errors) if errors else None

    return {'hourly': rows, 'daily': daily, 'matched_hours': len(matched), 'saved_monthly': saved_monthly,
            'recorded_mae_kwh': mae('predicted_energy_kwh'),
            'sunset_ramp_mae_kwh': mae('sunset_ramp_energy_kwh'),
            'timing_sunset_mae_kwh': mae('timing_sunset_energy_kwh'),
            'monthly_candidate_mae_kwh': mae('monthly_candidate_energy_kwh'),
            'monthly_candidate_matched_hours': sum(row.get('monthly_candidate_energy_kwh') is not None for row in matched),
            'candidate_mae_kwh': mae('candidate_energy_kwh'),
            'cold_morning_mae_kwh': mae('cold_morning_energy_kwh')}
