from datetime import datetime, timezone

from ..database import transaction
from ..errors import NotFoundError
from ..model import calculate_total_loss
from .sites import LOSS_COLUMNS

PARAMETERS = ('panel_count', 'panel_power_wp', 'ac_power_kw', 'site_age_years', 'tilt', 'azimuth')


class ForecastRepository:
    def __init__(self, db_path):
        self.db_path = db_path

    def save(self, site, hourly, losses, coefficient, source):
        created_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
        columns = ('site_id', 'created_at', 'model_version', *PARAMETERS, *LOSS_COLUMNS, 'mounting_type')
        values = (site['id'], created_at, 'v1.0', *(site[key] for key in PARAMETERS),
                  *(losses[key] if losses else None for key in LOSS_COLUMNS), site.get('mounting_type'))
        with transaction(self.db_path) as connection:
            cursor = connection.execute(
                f"INSERT INTO forecast_runs ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                values,
            )
            run_id = cursor.lastrowid
            connection.executemany("""
                INSERT INTO forecast_results
                (run_id, forecast_time, predicted_energy_kwh, cell_temperature, clipping_loss_kwh)
                VALUES (?, ?, ?, ?, ?)
            """, [(run_id, row['forecast_time'], row['predicted_energy_kwh'],
                   row['cell_temperature'], row['clipping_loss_kwh']) for row in hourly])
            dc_loss = calculate_total_loss([losses[key] for key in
                      ('soiling_loss', 'reflection_loss', 'mismatch_loss', 'dc_cable_loss',
                       'shading_loss', 'snow_loss')]) if losses else 0.05
            ac_loss = calculate_total_loss([losses[key] for key in
                      ('ac_cable_loss', 'transformer_loss')]) if losses else 0.02
            explanation = ('Sahaya özel dokuz katsayı kullanıldı.' if losses else
                           'Sahaya özel katsayı yok; varsayılan DC %5 ve AC %2 kullanıldı.')
            connection.execute("""
                INSERT INTO forecast_assumptions VALUES (?, ?, ?, ?, ?, ?)
            """, (run_id, dc_loss, ac_loss, coefficient, 0.005, explanation))
            connection.execute("""
                INSERT INTO forecast_metadata
                (run_id, source, timezone, latitude, longitude, weather_fetched_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (run_id, source, site['timezone'], site['latitude'], site['longitude'],
                  min(row['fetched_at'] for row in hourly)))
            connection.executemany("""
                INSERT INTO forecast_hour_inputs
                (run_id, forecast_time, temperature, wind_speed, cloud_cover,
                 shortwave_radiation, tilted_radiation) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [(run_id, row['forecast_time'], *(row.get(key) for key in
                   ('temperature', 'wind_speed', 'cloud_cover', 'shortwave_radiation', 'tilted_radiation')))
                  for row in hourly])
        return run_id

    def list(self, site_id):
        with transaction(self.db_path) as connection:
            return [dict(row) for row in connection.execute("""
                SELECT r.*, COUNT(f.id) AS hour_count, MIN(f.forecast_time) AS first_time,
                       MAX(f.forecast_time) AS last_time, COALESCE(m.source, 'legacy') AS source
                FROM forecast_runs r JOIN forecast_results f ON f.run_id=r.id
                LEFT JOIN forecast_metadata m ON m.run_id=r.id
                WHERE r.site_id=? GROUP BY r.id ORDER BY r.id DESC
            """, (site_id,))]

    def get(self, run_id):
        with transaction(self.db_path) as connection:
            run = connection.execute("SELECT * FROM forecast_runs WHERE id=?", (run_id,)).fetchone()
            if run is None:
                raise NotFoundError("Tahmin bulunamadı.")
            site = connection.execute("SELECT * FROM sites WHERE id=?", (run['site_id'],)).fetchone()
            metadata = connection.execute("SELECT * FROM forecast_metadata WHERE run_id=?", (run_id,)).fetchone()
            assumptions = connection.execute("SELECT * FROM forecast_assumptions WHERE run_id=?", (run_id,)).fetchone()
            rows = connection.execute("""
                SELECT f.forecast_time, f.predicted_energy_kwh, f.cell_temperature,
                       f.clipping_loss_kwh,
                       COALESCE(i.temperature, w.temperature) AS temperature,
                       COALESCE(i.wind_speed, w.wind_speed) AS wind_speed,
                       COALESCE(i.cloud_cover, w.cloud_cover) AS cloud_cover,
                       COALESCE(i.shortwave_radiation, w.shortwave_radiation) AS shortwave_radiation,
                       COALESCE(i.tilted_radiation, w.tilted_radiation) AS tilted_radiation
                FROM forecast_results f JOIN forecast_runs r ON r.id=f.run_id
                LEFT JOIN forecast_hour_inputs i ON i.run_id=f.run_id AND i.forecast_time=f.forecast_time
                LEFT JOIN weather_data w ON w.site_id=r.site_id AND w.forecast_time=f.forecast_time
                                        AND w.tilt=r.tilt AND w.azimuth=r.azimuth
                WHERE f.run_id=? ORDER BY f.forecast_time
            """, (run_id,)).fetchall()
        if not rows:
            raise NotFoundError("Bu tahminin saatlik sonucu bulunmuyor.")
        hourly = [dict(row, average_power_kw=row['predicted_energy_kwh'] / 1.0) for row in rows]
        meta = dict(metadata) if metadata else {
            'source': 'legacy', 'timezone': site['timezone'],
            'timestamp_semantics': 'interval_end', 'weather_fetched_at': None,
        }
        return {'run': dict(run), 'site_name': site['name'], 'metadata': meta,
                'assumptions': dict(assumptions) if assumptions else None, 'hourly': hourly,
                'is_fallback': False, 'warning': None}
