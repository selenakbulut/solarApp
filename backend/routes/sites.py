from typing import Annotated

from fastapi import APIRouter, Path, Query, Request

from ..schemas import SiteCreate, Losses
from ..services.timezones import site_timezone

router = APIRouter(tags=['Santraller ve konum'])
PositiveId = Annotated[int, Path(gt=0)]


@router.get('/sites')
def list_sites(request: Request):
    return request.app.state.sites.list()


@router.post('/sites', status_code=201)
def create_site(body: SiteCreate, request: Request):
    values = body.model_dump()
    values['timezone'] = site_timezone(values)
    return request.app.state.sites.create(values)


@router.get('/sites/{site_id}/losses')
def get_losses(site_id: PositiveId, request: Request):
    return {'site_id': site_id, 'losses': request.app.state.sites.losses(site_id)}


@router.put('/sites/{site_id}/losses')
def save_losses(site_id: PositiveId, body: Losses, request: Request):
    return {'site_id': site_id, 'losses': request.app.state.sites.save_losses(site_id, body.model_dump())}


@router.get('/geocoding')
def geocoding(request: Request, name: Annotated[str, Query(min_length=2, max_length=120)]):
    return request.app.state.weather.geocode(name)
