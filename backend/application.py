import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .database import initialize_database
from .errors import NotFoundError, ConflictError, QuotaError, WeatherError
from .logging_config import logger
from .repositories.actuals import ActualRepository
from .repositories.forecasts import ForecastRepository
from .repositories.sites import SiteRepository
from .routes import sites, forecasts, actuals
from .services.comparison import ComparisonService
from .services.forecasts import ForecastService
from .services.weather import WeatherService
from .settings import Settings


def create_app(settings=None, *, http_get=None, clock=None):
    settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app):
        initialize_database(settings.db_path)
        yield

    app = FastAPI(title='GES Üretim Tahmin API', version='2.0.0', lifespan=lifespan,
                  description='Saatlik tahmin, önbellek, gerçek üretim ve sürümlü sonuç aktarımı.')
    app.state.settings = settings
    app.state.sites = SiteRepository(settings.db_path)
    app.state.runs = ForecastRepository(settings.db_path)
    app.state.actuals = ActualRepository(settings.db_path)
    app.state.weather = WeatherService(settings, http_get=http_get, clock=clock)
    app.state.forecasts = ForecastService(settings, app.state.weather)
    app.state.comparison = ComparisonService(settings.db_path)

    async def domain_error(request: Request, error):
        codes = {NotFoundError: 404, ConflictError: 409, QuotaError: 429,
                 WeatherError: 502, ValueError: 422}
        return JSONResponse(status_code=codes[type(error)], content={'detail': str(error)})

    for error_type in (NotFoundError, ConflictError, QuotaError, WeatherError, ValueError):
        app.add_exception_handler(error_type, domain_error)

    @app.exception_handler(sqlite3.Error)
    async def database_error(request: Request, error):
        logger.exception('Veritabanı işlemi başarısız', exc_info=error)
        return JSONResponse(status_code=503, content={'detail': 'Veritabanı işlemi tamamlanamadı; logs/solar.log dosyasını kontrol edin.'})

    @app.get('/health', tags=['Durum'])
    def health():
        return {'status': 'ok', 'message': 'GES API çalışıyor.'}

    @app.get('/api-usage', tags=['Durum'])
    def api_usage():
        return {'daily_request_count': app.state.weather.repo.daily_usage(app.state.weather.clock()),
                'daily_limit': settings.daily_api_limit,
                'counter_scope': 'Open-Meteo denemeleri; yerel API okumaları dahil değil.'}

    app.include_router(sites.router)
    app.include_router(forecasts.router)
    app.include_router(actuals.router)
    return app
