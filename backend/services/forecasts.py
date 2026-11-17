from datetime import datetime, timedelta
from functools import partial
import math
from zoneinfo import ZoneInfo

from ..errors import QuotaError, WeatherError
from ..model import calculate_production
from ..repositories.forecasts import ForecastRepository, PARAMETERS
from ..repositories.sites import SiteRepository
from .production_adjustments import GENERAL_MODEL_VERSION, hourly_energy_factor
from .timezones import site_timezone


def interval_labels(start_date, end_date):
    start = datetime.combine(start_date, datetime.min.time())
    count = ((end_date - start_date).days + 1) * 24
    return [(start + timedelta(hours=i + 1)).strftime('%Y-%m-%dT%H:%M') for i in range(count)]


class ForecastService:
    def __init__(self, settings, weather):
        self.sites = SiteRepository(settings.db_path)
        self.runs = ForecastRepository(settings.db_path)
        self.weather = weather

    def create(self, request):
        site = self.sites.get(request.site_id)
        for key in PARAMETERS:
            value = getattr(request, key)
            if value is not None:
                site[key] = value

        if any(site[key] is None for key in PARAMETERS):
            raise ValueError("Santralin teknik bilgileri eksik.")
        if any(not math.isfinite(site[key]) for key in PARAMETERS):
            raise ValueError("Santralin teknik bilgileri geçersiz.")
        if site['panel_count'] <= 0 or site['panel_power_wp'] <= 0 or site['ac_power_kw'] <= 0:
            raise ValueError("Panel sayısı ve kurulu güçler pozitif olmalı.")
        dc_power = site['panel_count'] * site['panel_power_wp'] / 1000
        if not 0.8 <= dc_power / site['ac_power_kw'] <= 1.5:
            raise ValueError("DC/AC oranı 0.8–1.5 arasında olmalı.")
        site['timezone'] = site_timezone(site)
        local_now = self.weather.clock().astimezone(ZoneInfo(site['timezone'])).replace(tzinfo=None)
        today = local_now.date()
        if request.source == 'historical':
            start, end = request.start_date, request.end_date
            if end >= today - timedelta(days=1):
                raise ValueError("Arşiv hesabında bitiş en geç önceki günün bir gün öncesi olmalı.")
        elif request.start_date is not None:
            start, end = request.start_date, request.end_date
            if start < today or end > today + timedelta(days=7):
                raise ValueError("İleri tahmin tarihleri bugün ile 7 gün sonrası arasında olmalı.")
        else:
            start = today + timedelta(days=1)
            end = today + timedelta(days=request.forecast_days)
        weather_hours = interval_labels(start, end)
        expected = weather_hours
        if request.source == 'forecast' and start == today:
            first_interval = local_now.replace(minute=0, second=0, microsecond=0)
            if first_interval < local_now:
                first_interval += timedelta(hours=1)
            first_label = (first_interval + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M')
            expected = [stamp for stamp in weather_hours if stamp >= first_label]
            if not expected:
                raise ValueError("Seçilen tarihte henüz başlamamış saatlik aralık kalmadı.")
        losses = self.sites.losses(site['id'])
        try:
            weather, cache_source = self.weather.ensure_hours(
                site, request.source, weather_hours, refresh_weather=request.refresh_weather,
            )
        except (WeatherError, QuotaError) as error:
            if request.source != 'forecast' or request.refresh_weather:
                raise
            for old in self.runs.list(site['id']):
                if old['source'] == 'historical':
                    continue
                if request.start_date is not None and (
                    old['first_time'] != expected[0] or old['last_time'] != expected[-1]
                    or old['hour_count'] != len(expected)
                ):
                    continue
                if any(old[key] != site[key] for key in PARAMETERS):
                    continue
                if any(old[key] != (losses[key] if losses else None) for key in
                       ('soiling_loss', 'reflection_loss', 'mismatch_loss', 'dc_cable_loss',
                        'ac_cable_loss', 'transformer_loss', 'shading_loss', 'availability_loss', 'snow_loss')):
                    continue
                result = self.runs.get(old['id'])
                recorded_coefficient = (result['assumptions'] or {}).get('temperature_coefficient')
                if recorded_coefficient != request.temperature_coefficient:
                    continue
                result['is_fallback'] = True
                result['warning'] = f"{error} Yeni tahmin oluşturulmadı; uyumlu eski kayıt gösteriliyor."
                return result
            raise
        hourly = []
        weather_by_end = {datetime.fromisoformat(row['weather_time']): row for row in weather}
        calculate_energy = partial(
            calculate_production,
            dc_power_kwp=dc_power, inverter_power_kw=site['ac_power_kw'],
            panel_age_years=site['site_age_years'],
            temperature_coefficient=request.temperature_coefficient, **(losses or {}),
        )
        for stamp in expected:
            hour_end = datetime.fromisoformat(stamp)
            row = weather_by_end[hour_end]
            energy, clipping = calculate_energy(row['tilted_radiation'], row['temperature'])
            if energy > 0:
                energy *= hourly_energy_factor(site, hour_end, weather_by_end)
            hourly.append({**row, 'forecast_time': row['weather_time'],
                           'predicted_energy_kwh': energy, 'clipping_loss_kwh': clipping,
                           'cell_temperature': row['temperature'] + (45 - 20) / 800 * row['tilted_radiation']})
        run_id = self.runs.save(
            site, hourly, losses, request.temperature_coefficient, request.source,
            model_version=GENERAL_MODEL_VERSION,
        )
        result = self.runs.get(run_id)
        result['weather_access'] = cache_source
        return result
