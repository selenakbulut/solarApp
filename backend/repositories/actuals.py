from datetime import timedelta
from zoneinfo import ZoneInfo

from ..database import transaction
from .sites import SiteRepository
from ..services.timezones import site_timezone


class ActualRepository:
    def __init__(self, db_path):
        self.db_path = db_path

    def list(self, site_id):
        SiteRepository(self.db_path).get(site_id)
        with transaction(self.db_path) as connection:
            return [dict(row) for row in connection.execute("""
                SELECT production_time, actual_energy_kwh FROM actual_production
                WHERE site_id=? ORDER BY production_time
            """, (site_id,))]

    def save(self, request):
        sites, rows, seen = {}, [], set()
        for item in request.rows:
            if item.site_id not in sites:
                sites[item.site_id] = SiteRepository(self.db_path).get(item.site_id)
            timestamp = item.production_time
            if timestamp.tzinfo is not None:
                timestamp = timestamp.astimezone(ZoneInfo(site_timezone(sites[item.site_id])))
            if timestamp.minute or timestamp.second or timestamp.microsecond:
                raise ValueError("Gerçek üretim saat başlarına hizalanmalı; örneğin 15:00.")
            timestamp = timestamp.replace(tzinfo=None)
            if request.timestamp_label == 'start':
                timestamp += timedelta(hours=1)
            text = timestamp.strftime('%Y-%m-%dT%H:%M')
            key = (item.site_id, text)
            if key in seen:
                raise ValueError("Dosyada aynı saha ve saat birden fazla kez bulunuyor.")
            seen.add(key)
            rows.append((item.site_id, text, item.actual_energy_kwh))
        with transaction(self.db_path) as connection:
            connection.executemany("""
                INSERT INTO actual_production(site_id, production_time, actual_energy_kwh)
                VALUES (?, ?, ?) ON CONFLICT(site_id, production_time)
                DO UPDATE SET actual_energy_kwh=excluded.actual_energy_kwh
            """, rows)
        return {'saved_rows': len(rows), 'timestamp_semantics': 'interval_end'}
