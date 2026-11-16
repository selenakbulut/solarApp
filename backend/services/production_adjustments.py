from datetime import timedelta

from .solar import interval_solar_context, low_irradiance_sunset_factor, solar_noon_on_date


GENERAL_MODEL_VERSION = 'v1.2-hourly-conditions'
HOUR = timedelta(hours=1)


def hourly_energy_factor(site, end, weather_by_end):
    """Select one energy correction using the site's solar position and weather."""
    row = weather_by_end[end]
    radiation = row['tilted_radiation']
    latitude, longitude, zone = (site[key] for key in ('latitude', 'longitude', 'timezone'))
    stamp = row['weather_time']
    sunset_factor = low_irradiance_sunset_factor(stamp, radiation, latitude, longitude, zone)
    if sunset_factor != 1.0:
        return sunset_factor

    cloud, temperature = row['cloud_cover'], row['temperature']
    if cloud is None:
        return 1.0
    cold_morning = temperature <= 2.5 and cloud > 0 and radiation >= 100
    cloudy_midday = temperature > 2.5 and cloud >= 30 and radiation >= 300
    if not (cold_morning or cloudy_midday):
        return 1.0

    midpoint = end - HOUR / 2
    noon = solar_noon_on_date(midpoint.date(), latitude, longitude, zone).replace(tzinfo=None)
    midday_start = noon - 2 * HOUR
    solar = interval_solar_context(stamp, latitude, longitude, zone)
    if not solar['sun_above_horizon_fraction']:
        return 1.0
    if cold_morning and midpoint < midday_start and not solar['sun_is_descending']:
        return 0.65
    in_midday_or_afternoon = (midpoint >= midday_start
                              and (midpoint <= noon + 2 * HOUR or solar['midpoint_solar_elevation_deg'] > 12))
    if cloudy_midday and in_midday_or_afternoon:
        previous_clouds = [weather_by_end.get(end - offset * HOUR, {}).get('cloud_cover')
                           for offset in (1, 2)]
        last_cloud, earlier_cloud = previous_clouds
        if last_cloud is not None and earlier_cloud is not None and cloud > last_cloud > earlier_cloud:
            increase = cloud - earlier_cloud
            if increase >= 20:
                return 1 - min(0.30, increase / 100)
    return 1.0
