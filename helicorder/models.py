from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Station:
    network: str
    station: str
    channel: str
    location: str = ""

    @property
    def id(self) -> str:
        loc = self.location if self.location else "--"
        return f"{self.network}.{self.station}.{loc}.{self.channel}"

    @property
    def nslc(self) -> str:
        return f"{self.network}.{self.station}.{self.location}.{self.channel}"


@dataclass(frozen=True)
class Event:
    time_iso: str
    latitude: float
    longitude: float
    depth: float
    magnitude: float
    description: str
    source: str = ""


@dataclass
class StationLocation:
    latitude: float
    longitude: float
    elevation: float


@dataclass
class PlotResult:
    station: Station
    filename: str
    thumbnail: str
    starttime: str
    endtime: str

    @property
    def id(self) -> str:
        return self.station.id


@dataclass
class StationMapEntry:
    station: Station
    latitude: float
    longitude: float
    elevation: float
