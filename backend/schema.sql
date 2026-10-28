CREATE TABLE IF NOT EXISTS historical_weather_data (
    site_id INTEGER NOT NULL REFERENCES sites(id), latitude REAL NOT NULL,
    longitude REAL NOT NULL, weather_time TEXT NOT NULL, temperature REAL NOT NULL,
    wind_speed REAL NOT NULL, cloud_cover REAL NOT NULL,
    shortwave_radiation REAL NOT NULL, tilted_radiation REAL NOT NULL,
    tilt REAL NOT NULL, azimuth REAL NOT NULL, fetched_at TEXT NOT NULL,
    PRIMARY KEY(site_id, latitude, longitude, weather_time, tilt, azimuth)
);
CREATE TABLE IF NOT EXISTS weather_cache_hours (
    kind TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
    timezone TEXT NOT NULL, tilt REAL NOT NULL, azimuth REAL NOT NULL,
    weather_time TEXT NOT NULL, temperature REAL NOT NULL, wind_speed REAL,
    cloud_cover REAL, shortwave_radiation REAL, tilted_radiation REAL NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY(kind, latitude, longitude, timezone, tilt, azimuth, weather_time)
);
CREATE TABLE IF NOT EXISTS raw_api_responses (
    id INTEGER PRIMARY KEY, request_id INTEGER REFERENCES api_requests(id),
    endpoint TEXT NOT NULL, params_json TEXT NOT NULL, payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS location_results (
    query_name TEXT PRIMARY KEY, result_json TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forecast_metadata (
    run_id INTEGER PRIMARY KEY REFERENCES forecast_runs(id),
    source TEXT NOT NULL, timezone TEXT NOT NULL, latitude REAL NOT NULL,
    longitude REAL NOT NULL, weather_fetched_at TEXT,
    timestamp_semantics TEXT NOT NULL DEFAULT 'interval_end'
);
CREATE TABLE IF NOT EXISTS forecast_hour_inputs (
    run_id INTEGER NOT NULL REFERENCES forecast_runs(id), forecast_time TEXT NOT NULL,
    temperature REAL, wind_speed REAL, cloud_cover REAL,
    shortwave_radiation REAL, tilted_radiation REAL,
    PRIMARY KEY(run_id, forecast_time)
);
