from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Request, Response

from ..errors import NotFoundError
from ..schemas import ForecastCreate
from ..services.comparison import daily_summary
from ..services.exports import forecast_export

router = APIRouter(tags=['Tahminler'])
PositiveId = Annotated[int, Path(gt=0)]


@router.post('/forecasts', status_code=201)
def create_forecast(body: ForecastCreate, request: Request, response: Response):
    result = request.app.state.forecasts.create(body)
    if result['is_fallback']:
        response.status_code = 200
    result['daily'] = daily_summary(result['hourly'])
    return result


@router.get('/sites/{site_id}/forecasts')
def list_forecasts(site_id: PositiveId, request: Request):
    request.app.state.sites.get(site_id)
    return request.app.state.runs.list(site_id)


@router.get('/sites/{site_id}/forecasts/latest')
def latest_forecast(site_id: PositiveId, request: Request):
    request.app.state.sites.get(site_id)
    for run in request.app.state.runs.list(site_id):
        if run['source'] != 'historical':
            result = request.app.state.runs.get(run['id'])
            result['daily'] = daily_summary(result['hourly'])
            return result
    raise NotFoundError('Kayıtlı ileri tahmin bulunamadı.')


@router.get('/forecasts/{run_id}')
def get_forecast(run_id: PositiveId, request: Request):
    result = request.app.state.runs.get(run_id)
    result['daily'] = daily_summary(result['hourly'])
    return result


@router.get('/forecasts/{run_id}/export')
def export_forecast(run_id: PositiveId, request: Request, format: Literal['csv', 'xlsx'] = 'csv'):
    content = forecast_export(request.app.state.runs.get(run_id), format)
    media = 'text/csv; charset=utf-8' if format == 'csv' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    return Response(content=content, media_type=media,
                    headers={'Content-Disposition': f'attachment; filename="forecast_{run_id}.{format}"'})


@router.get('/scenarios/compare')
def compare_scenarios(request: Request, first_run_id: Annotated[int, Query(gt=0)],
                      second_run_id: Annotated[int, Query(gt=0)]):
    return request.app.state.comparison.scenarios(first_run_id, second_run_id)
