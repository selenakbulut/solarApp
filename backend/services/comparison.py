import math
from collections import defaultdict
from datetime import datetime, timedelta

from ..repositories.actuals import ActualRepository
from ..repositories.forecasts import ForecastRepository, PARAMETERS


def metrics(rows, capacity):
    if not rows:
        return None
    errors = [
        row['predicted_energy_kwh'] - row['actual_energy_kwh']
        for row in rows
    ]
    mae = sum(abs(error) for error in errors) / len(errors)
    rmse = math.sqrt(sum(error ** 2 for error in errors) / len(errors))
    return {'hour_count': len(rows), 'mae_kwh': mae, 'rmse_kwh': rmse,
            'bias_kwh': sum(errors) / len(errors),
            'nmae_percent': mae / capacity * 100,
            'nrmse_percent': rmse / capacity * 100}


def production_day(timestamp):
    return (datetime.fromisoformat(timestamp) - timedelta(hours=1)).date().isoformat()


def daily_summary(hours):
    days = defaultdict(lambda: {'predicted_energy_kwh': 0.0, 'clipping_loss_kwh': 0.0,
                                'peak_power_kw': 0.0, 'hour_count': 0})
    for row in hours:
        day = days[production_day(row['forecast_time'])]
        day['predicted_energy_kwh'] += row['predicted_energy_kwh']
        day['clipping_loss_kwh'] += row.get('clipping_loss_kwh') or 0
        day['peak_power_kw'] = max(day['peak_power_kw'], row['average_power_kw'])
        day['hour_count'] += 1
    return [{'date': date, **values, 'complete_day': values['hour_count'] == 24}
            for date, values in sorted(days.items())]


class ComparisonService:
    def __init__(self, db_path):
        self.runs = ForecastRepository(db_path)
        self.actuals = ActualRepository(db_path)

    def actual_comparison(self, run_id):
        forecast = self.runs.get(run_id)
        actual = {
            row['production_time']: row['actual_energy_kwh']
            for row in self.actuals.list(forecast['run']['site_id'])
        }
        rows, missing = [], []
        for hour in forecast['hourly']:
            timestamp = hour['forecast_time']
            if timestamp not in actual:
                missing.append(timestamp)
                continue
            observed = actual[timestamp]
            difference = hour['predicted_energy_kwh'] - observed
            rows.append({**hour, 'actual_energy_kwh': observed,
                         'error_kwh': difference, 'absolute_error_kwh': abs(difference),
                         'percentage_deviation': difference / observed * 100 if observed else None,
                         'deviation_status': ('Yüksek tahmin' if difference > 0 else
                                              'Düşük tahmin' if difference < 0 else 'Tam isabet')})
        capacity = forecast['run']['panel_count'] * forecast['run']['panel_power_wp'] / 1000
        daily = defaultdict(lambda: {'predicted_energy_kwh': 0.0, 'actual_energy_kwh': 0.0, 'hour_count': 0})
        by_hour, by_weather, baseline = defaultdict(list), defaultdict(list), []
        for row in rows:
            day = daily[production_day(row['forecast_time'])]
            for key in ('predicted_energy_kwh', 'actual_energy_kwh'):
                day[key] += row[key]
            day['hour_count'] += 1
            by_hour[row['forecast_time'][11:13]].append(row)
            cloud = row.get('cloud_cover')
            label = 'Bilinmiyor' if cloud is None else 'Açık' if cloud < 20 else 'Parçalı bulutlu' if cloud < 70 else 'Kapalı'
            by_weather[label].append(row)
            prior = (datetime.fromisoformat(row['forecast_time']) - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M')
            if prior in actual:
                baseline.append({**row, 'baseline_energy_kwh': actual[prior]})
        daily_rows = []
        for day, values in sorted(daily.items()):
            difference = values['predicted_energy_kwh'] - values['actual_energy_kwh']
            daily_rows.append({'date': day, **values, 'complete_day': values['hour_count'] == 24,
                               'error_kwh': difference,
                               'percentage_deviation': difference / values['actual_energy_kwh'] * 100
                               if values['actual_energy_kwh'] else None})
        baseline_mae = (sum(abs(row['baseline_energy_kwh'] - row['actual_energy_kwh'])
                            for row in baseline) / len(baseline)) if baseline else None
        return {'run_id': run_id, 'forecast_hour_count': len(forecast['hourly']),
                'missing_actual_hours': missing, 'hourly': rows, 'daily': daily_rows,
                'metrics': metrics(rows, capacity),
                'hour_of_day': [{'hour': key, **metrics(value, capacity)} for key, value in sorted(by_hour.items())],
                'weather_groups': [{'weather': key, **metrics(value, capacity)} for key, value in by_weather.items()],
                'baseline': {'matched_hours': len(baseline), 'mae_kwh': baseline_mae,
                             'model_metrics_same_hours': metrics(baseline, capacity),
                             'note': 'Geriye dönük dünün aynı saati referansı; veri yayın zamanları bilinmediğinden eşit bilgi ufkunda ileri tahmin başarısı kanıtı değildir.'}}

    def scenarios(self, first_id, second_id):
        first, second = self.runs.get(first_id), self.runs.get(second_id)
        if first['run']['site_id'] != second['run']['site_id']:
            raise ValueError("Senaryolar aynı santrale ait olmalı.")
        second_hours = {row['forecast_time']: row for row in second['hourly']}
        rows = [{'forecast_time': row['forecast_time'],
                 'first_energy_kwh': row['predicted_energy_kwh'],
                 'second_energy_kwh': second_hours[row['forecast_time']]['predicted_energy_kwh'],
                 'difference_kwh': second_hours[row['forecast_time']]['predicted_energy_kwh'] - row['predicted_energy_kwh']}
                for row in first['hourly'] if row['forecast_time'] in second_hours]
        changed = [key for key in PARAMETERS if first['run'][key] != second['run'][key]]
        return {'first_run_id': first_id, 'second_run_id': second_id,
                'changed_parameters': changed, 'hourly': rows,
                'warning': 'Üretim farkı hava girdileri ve kayıp katsayılarının farklılığından da kaynaklanabilir.'}
