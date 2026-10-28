from typing import Annotated

from fastapi import APIRouter, Path, Request

from ..schemas import ActualImport

router = APIRouter(tags=['Gerçek üretim ve karşılaştırma'])


@router.get('/sites/{site_id}/actuals')
def actuals(site_id: Annotated[int, Path(gt=0)], request: Request):
    return request.app.state.actuals.list(site_id)


@router.post('/actuals/import')
def import_actuals(body: ActualImport, request: Request):
    return request.app.state.actuals.save(body)


@router.get('/forecasts/{run_id}/comparison')
def comparison(run_id: Annotated[int, Path(gt=0)], request: Request):
    return request.app.state.comparison.actual_comparison(run_id)
