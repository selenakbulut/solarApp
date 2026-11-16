"""Approximate astronomical context for an interval-END hourly label.

NOAA equations: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
The -0.833 degree horizon approximates refraction and the solar disk.
Local terrain, buildings, clouds and module orientation are not modeled here.
No API call is needed.
"""
import calendar
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

SUNRISE_HORIZON_DEGREES = -0.833
SUNSET_MAX_ELEVATION_DEGREES = 12.0
SUNSET_IRRADIANCE_THRESHOLD_W_M2 = 180.0
SUNSET_ENERGY_FACTOR = 0.75


def solar_elevation(instant, latitude, longitude):
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError('Güneş konumu için saat dilimi gerekli.')
    if not (math.isfinite(latitude) and -90 <= latitude <= 90
            and math.isfinite(longitude) and -180 <= longitude <= 180):
        raise ValueError('Koordinatlar geçersiz.')
    t = instant.astimezone(timezone.utc)
    hour = t.hour + t.minute / 60 + (t.second + t.microsecond / 1e6) / 3600
    year_days = 366 if calendar.isleap(t.year) else 365
    gamma = 2 * math.pi / year_days * (t.timetuple().tm_yday - 1 + (hour - 12) / 24)
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(gamma)
                       - 0.032077 * math.sin(gamma) - 0.014615 * math.cos(2 * gamma)
                       - 0.040849 * math.sin(2 * gamma))
    declination = (0.006918 - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma)
                   - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma)
                   - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma))
    solar_minutes = (hour * 60 + eqtime + 4 * longitude) % 1440
    angle = math.radians(solar_minutes / 4 - 180)
    lat = math.radians(latitude)
    sine = (math.sin(lat) * math.sin(declination)
            + math.cos(lat) * math.cos(declination) * math.cos(angle))
    return math.degrees(math.asin(max(-1.0, min(1.0, sine))))


def interval_solar_context(timestamp, latitude, longitude, timezone_name):
    zone = ZoneInfo(timezone_name)
    end = datetime.fromisoformat(timestamp)
    if end.tzinfo is None:
        end = end.replace(tzinfo=zone)
    end = end.astimezone(timezone.utc)
    start = end - timedelta(hours=1)
    horizon = SUNRISE_HORIZON_DEGREES
    points = [start + timedelta(minutes=i) for i in range(61)]
    heights = [solar_elevation(t, latitude, longitude) for t in points]
    events = []
    for i in range(60):
        rising = heights[i] < horizon <= heights[i + 1]
        setting = heights[i] >= horizon > heights[i + 1]
        if not (rising or setting):
            continue
        left, right = points[i], points[i + 1]
        for _ in range(16):
            mid = left + (right - left) / 2
            above = solar_elevation(mid, latitude, longitude) >= horizon
            if above == rising:
                right = mid
            else:
                left = mid
        events.append(('sunrise' if rising else 'sunset', left + (right - left) / 2))
    bounds = [start, *(t for _, t in events), end]
    daylight_seconds = sum((b - a).total_seconds() for a, b in zip(bounds, bounds[1:])
                          if solar_elevation(a + (b - a) / 2, latitude, longitude) >= horizon)
    fraction = max(0.0, min(1.0, daylight_seconds / 3600))
    phase = ('sunrise' if any(k == 'sunrise' for k, _ in events) else
             'sunset' if events else 'day' if fraction > 0 else 'sun_below_horizon')
    return {
        'interval_start': start.astimezone(zone).isoformat(timespec='minutes'),
        'interval_end': end.astimezone(zone).isoformat(timespec='minutes'),
        'phase': phase,
        'sun_above_horizon_fraction': fraction,
        'sun_above_horizon_minutes': fraction * 60,
        'midpoint_solar_elevation_deg': solar_elevation(start + timedelta(minutes=30), latitude, longitude),
        'sun_is_descending': heights[-1] < heights[0],
        'events': [{'kind': k, 'local_time': t.astimezone(zone).isoformat(timespec='minutes')}
                   for k, t in events],
    }


def low_irradiance_sunset_factor(timestamp, tilted_radiation, latitude, longitude, timezone_name):
    """Reduce estimated energy for dim hours with the sun low and setting."""
    if not 0 < tilted_radiation < SUNSET_IRRADIANCE_THRESHOLD_W_M2:
        return 1.0
    solar = interval_solar_context(timestamp, latitude, longitude, timezone_name)
    if (solar['sun_is_descending'] and solar['sun_above_horizon_fraction'] > 0
            and solar['midpoint_solar_elevation_deg'] <= SUNSET_MAX_ELEVATION_DEGREES):
        return SUNSET_ENERGY_FACTOR
    return 1.0


@lru_cache(maxsize=128)
def solar_noon_on_date(day, latitude, longitude, timezone_name):
    midnight = datetime.combine(day, datetime.min.time(), ZoneInfo(timezone_name))
    minutes = (midnight + timedelta(minutes=i) for i in range(1440))
    return max(minutes, key=lambda t: solar_elevation(t, latitude, longitude))


@lru_cache(maxsize=128)
def sunset_on_date(day, latitude, longitude, timezone_name):
    """Return the approximate local sunset minute for a site and date."""
    midnight = datetime.combine(day, datetime.min.time())
    for hour in range(1, 25):
        end = midnight + timedelta(hours=hour)
        context = interval_solar_context(end.isoformat(), latitude, longitude, timezone_name)
        for event in context['events']:
            if event['kind'] == 'sunset':
                return datetime.fromisoformat(event['local_time'])
    return None
