from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, field_validator

from .models import Station


class AppConfig(BaseModel):
    base_url: str = "http://127.0.0.1:18081"
    event_source: str = "ga"  # "ga" for Geoscience Australia, "iris" for IRIS FDSN
    event_url: str = ""  # Override URL (auto-set based on event_source if empty)
    output_dir: str = "output"
    max_workers: int = 8
    min_magnitude: float = 3.0
    hours: int = 24
    timeout: int = 30
    stations: list[Station] = []

    GA_EVENT_URL: str = "https://earthquakes.ga.gov.au/geoserver/earthquakes/wfs"
    IRIS_EVENT_URL: str = "http://service.iris.edu/fdsnws/event/1/query"

    @property
    def resolved_event_url(self) -> str:
        if self.event_url:
            return self.event_url
        if self.event_source == "ga":
            return self.GA_EVENT_URL
        return self.IRIS_EVENT_URL

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("stations", mode="before")
    @classmethod
    def parse_stations(cls, v: Any) -> list[Station]:
        if isinstance(v, dict):
            result = []
            for key, value in v.items():
                net, sta = key.split(".", 1)
                parts = value.split(".")
                channel = parts[0]
                location = parts[1] if len(parts) > 1 else ""
                result.append(Station(
                    network=net,
                    station=sta,
                    channel=channel,
                    location=location,
                ))
            return result
        return v


def load_config(path: str | Path) -> AppConfig:
    with open(path) as f:
        raw = yaml.safe_load(f)
    return AppConfig(**raw)
