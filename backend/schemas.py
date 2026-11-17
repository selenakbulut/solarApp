from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator

Nonnegative = Annotated[FiniteFloat, Field(ge=0)]
Positive = Annotated[FiniteFloat, Field(gt=0)]
LossRatio = Annotated[FiniteFloat, Field(ge=0, lt=1)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class SiteCreate(InputModel):
    name: str = Field(min_length=1, max_length=120)
    latitude: FiniteFloat = Field(ge=-90, le=90)
    longitude: FiniteFloat = Field(ge=-180, le=180)
    panel_count: int = Field(gt=0, strict=True)
    panel_power_wp: Positive
    ac_power_kw: Positive
    tilt: FiniteFloat = Field(ge=0, le=90)
    azimuth: FiniteFloat = Field(ge=-180, le=180)
    site_age_years: Nonnegative
    elevation: FiniteFloat | None = None
    timezone: str | None = None
    mounting_type: Literal["Arazi", "Çatı", "İzleyici"] = "Arazi"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError) as error:
                raise ValueError("Geçersiz saat dilimi.") from error
        return value

    @model_validator(mode="after")
    def valid_capacity(self):
        ratio = self.panel_count * self.panel_power_wp / 1000 / self.ac_power_kw
        if not 0.8 <= ratio <= 1.5:
            raise ValueError("DC/AC oranı mevcut proje kuralına göre 0.8–1.5 arasında olmalı.")
        return self


class Losses(InputModel):
    soiling_loss: LossRatio
    reflection_loss: LossRatio
    mismatch_loss: LossRatio
    dc_cable_loss: LossRatio
    ac_cable_loss: LossRatio
    transformer_loss: LossRatio
    shading_loss: LossRatio
    availability_loss: LossRatio
    snow_loss: LossRatio


class ForecastCreate(InputModel):
    site_id: int = Field(gt=0)
    panel_count: int | None = Field(default=None, gt=0, strict=True)
    panel_power_wp: Positive | None = None
    ac_power_kw: Positive | None = None
    site_age_years: Nonnegative | None = None
    tilt: FiniteFloat | None = Field(default=None, ge=0, le=90)
    azimuth: FiniteFloat | None = Field(default=None, ge=-180, le=180)
    temperature_coefficient: FiniteFloat = Field(default=-0.004, ge=-0.02, le=0)
    source: Literal["forecast", "historical"] = "forecast"
    refresh_weather: bool = False
    forecast_days: int = Field(default=3, ge=1, le=7)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def valid_dates(self):
        if self.refresh_weather and self.source != "forecast":
            raise ValueError("Zorunlu hava yenilemesi yalnızca ileri tahminde kullanılabilir.")
        if self.source == "forecast" and self.start_date is None and self.end_date is None:
            return self
        if self.start_date is None or self.end_date is None:
            raise ValueError("Başlangıç ve bitiş tarihlerini birlikte seçin.")
        max_days = 366 if self.source == "historical" else 7
        if not 0 <= (self.end_date - self.start_date).days < max_days:
            raise ValueError(f"Tarih aralığı 1–{max_days} gün olmalı.")
        return self


class ActualRow(InputModel):
    site_id: int = Field(gt=0)
    production_time: datetime
    actual_energy_kwh: Nonnegative


class ActualImport(InputModel):
    timestamp_label: Literal["end", "start"] = "end"
    rows: list[ActualRow] = Field(min_length=1, max_length=50000)
