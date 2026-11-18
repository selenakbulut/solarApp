"""Collect fresh forecasts through the local API and save a CSV per site and run."""

import argparse
import csv
from datetime import date, datetime, time, timedelta
import json
from pathlib import Path
from time import sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


SITE_IDS = (12, 13)
SITE_NAMES = {12: 'Biska', 13: 'Kentpark'}
ISTANBUL = ZoneInfo('Europe/Istanbul')


def schedule(first_evening, last_morning):
    day = first_evening
    while day < last_morning:
        evening = datetime.combine(day, time(18), ISTANBUL)
        for hours in range(0, 15, 2):
            yield evening + timedelta(hours=hours)
        day += timedelta(days=1)


def api(base_url, path, body=None):
    headers = {'Content-Type': 'application/json'} if body is not None else {}
    data = json.dumps(body).encode() if body is not None else None
    request = Request(f'{base_url.rstrip("/")}{path}', data=data, headers=headers)
    with urlopen(request, timeout=90) as response:
        return json.load(response)


def save_forecast(path, slot, result):
    run = result['run']
    labels = {
        'scheduled_at_tsi': slot.isoformat(),
        'site_id': run['site_id'],
        'site_name': SITE_NAMES[run['site_id']],
        'run_id': run['id'],
        'created_at': run['created_at'],
        'model_version': run['model_version'],
        'weather_fetched_at': result['metadata']['weather_fetched_at'],
    }
    hourly = result['hourly']
    temp_path = path.with_suffix('.tmp')
    with temp_path.open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=[*labels, *hourly[0]])
        writer.writeheader()
        writer.writerows({**labels, **row} for row in hourly)
    temp_path.replace(path)


def log(output, slot, site_id, message):
    timestamp = datetime.now(ISTANBUL).isoformat(timespec='seconds')
    label = SITE_NAMES[site_id] if site_id is not None else 'Zamanlayıcı'
    line = f'{timestamp} | Plan {slot:%d.%m %H:%M} | {label} | {message}'
    print(line, flush=True)
    with (output / 'cekimler.log').open('a', encoding='utf-8') as stream:
        stream.write(line + '\n')


def collect(args, slot):
    for site_id in SITE_IDS:
        prefix = f'{slot:%Y%m%d_%H%M}_saha{site_id}_tahmin'
        if next(args.output.glob(f'{prefix}*.csv'), None):
            continue
        try:
            usage = api(args.api, '/api-usage')
            if usage['daily_request_count'] >= usage['daily_limit']:
                log(args.output, slot, site_id, 'Günlük API kotası doldu.')
                continue
            result = api(args.api, '/forecasts', {
                'site_id': site_id,
                'source': 'forecast',
                'start_date': slot.date().isoformat(),
                'end_date': args.forecast_end.isoformat(),
                'refresh_weather': True,
            })
            if result.get('weather_access') != 'open_meteo' or result['run']['site_id'] != site_id:
                raise ValueError('Beklenen saha için taze Open-Meteo yanıtı alınamadı.')
            run_id = result['run']['id']
            path = args.output / f'{prefix}{run_id}.csv'
            save_forecast(path, slot, result)
            log(args.output, slot, site_id, f'#{run_id} → {path.name}')
        except HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')
            log(args.output, slot, site_id, f'HTTP {error.code}: {detail}')
        except (OSError, ValueError, KeyError, IndexError) as error:
            log(args.output, slot, site_id, f'Hata: {error}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first-evening', type=date.fromisoformat, default=date(2026, 11, 17))
    parser.add_argument('--last-morning', type=date.fromisoformat, default=date(2026, 11, 20))
    parser.add_argument('--forecast-end', type=date.fromisoformat, default=date(2026, 11, 23))
    parser.add_argument('--api', default='http://127.0.0.1:8000')
    parser.add_argument('--output', type=Path, default=Path('.local-run/gece-tahminleri'))
    parser.add_argument('--dry-run', action='store_true', help='Planı göster, API isteği yapma.')
    args = parser.parse_args()
    if not args.first_evening < args.last_morning <= args.forecast_end:
        parser.error('İlk akşam, son sabahtan önce olmalı ve tahmin bitişi son sabahı kapsamalı.')
    if (args.forecast_end - args.first_evening).days >= 7:
        parser.error('İlk çekimde tahmin aralığı en fazla 7 gün olabilir.')

    if args.dry_run:
        site_names = ', '.join(SITE_NAMES[site_id] for site_id in SITE_IDS)
        for slot in schedule(args.first_evening, args.last_morning):
            print(f'{slot:%Y-%m-%d %H:%M} TSİ | {slot.date()} – {args.forecast_end} | {site_names}')
        return

    api(args.api, '/health')
    args.output.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(ISTANBUL)
    for slot in schedule(args.first_evening, args.last_morning):
        deadline = slot + timedelta(minutes=5)
        if started_at > deadline:
            continue
        now = datetime.now(ISTANBUL)
        if now < slot:
            log(args.output, slot, None, 'Çekim saati bekleniyor.')
            while now < slot:
                sleep(min(60, (slot - now).total_seconds()))
                now = datetime.now(ISTANBUL)
        if now <= deadline:
            collect(args, slot)
        else:
            log(args.output, slot, None, 'Çekim atlandı. Planlanan saatin üzerinden 5 dakikadan fazla geçti.')


if __name__ == '__main__':
    main()
