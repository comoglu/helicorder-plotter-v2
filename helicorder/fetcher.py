from __future__ import annotations

import asyncio
import io
import logging
from typing import Optional

import aiohttp
import obspy
from obspy import UTCDateTime

from .config import AppConfig
from .models import Event, Station, StationLocation

logger = logging.getLogger(__name__)


async def fetch_earthquake_events(
    session: aiohttp.ClientSession,
    config: AppConfig,
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> list[Event]:
    if config.event_source == "ga":
        return await _fetch_ga_events(session, config, starttime, endtime)
    return await _fetch_iris_events(session, config, starttime, endtime)


async def _fetch_ga_events(
    session: aiohttp.ClientSession,
    config: AppConfig,
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> list[Event]:
    params = {
        "service": "WFS",
        "request": "getfeature",
        "typeNames": "earthquakes:earthquakes_seven_days",
        "outputFormat": "application/json",
        "CQL_FILTER": f"display_flag='Y' AND preferred_magnitude>={config.min_magnitude}",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(config.resolved_event_url, params=params, timeout=timeout) as resp:
            resp.raise_for_status()
            data = await resp.json()
            events = []
            for feature in data.get("features", []):
                props = feature["properties"]
                coords = feature["geometry"]["coordinates"]
                origin = props.get("origin_time", "")
                if not origin:
                    continue
                # Filter by time window
                try:
                    event_time = UTCDateTime(origin)
                    if event_time < starttime or event_time > endtime:
                        continue
                except Exception:
                    continue
                events.append(Event(
                    time_iso=origin,
                    latitude=coords[1],
                    longitude=coords[0],
                    depth=float(props.get("depth", 0)),
                    magnitude=float(props.get("preferred_magnitude", 0)),
                    description=props.get("description", ""),
                    source="GA",
                ))
            logger.info("Fetched %d earthquake events from GA", len(events))
            return events
    except Exception as e:
        logger.error("Error fetching GA earthquake events: %s", e)
        return []


async def _fetch_iris_events(
    session: aiohttp.ClientSession,
    config: AppConfig,
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> list[Event]:
    params = {
        "starttime": starttime.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": endtime.strftime("%Y-%m-%dT%H:%M:%S"),
        "minmagnitude": config.min_magnitude,
        "format": "text",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(config.resolved_event_url, params=params, timeout=timeout) as resp:
            resp.raise_for_status()
            text = await resp.text()
            events = []
            for line in text.split("\n")[1:]:
                if not line.strip():
                    continue
                parts = line.split("|")
                events.append(Event(
                    time_iso=parts[1].strip(),
                    latitude=float(parts[2]),
                    longitude=float(parts[3]),
                    depth=float(parts[4]),
                    magnitude=float(parts[10]),
                    description=parts[12].strip(),
                    source="IRIS",
                ))
            logger.info("Fetched %d earthquake events from IRIS", len(events))
            return events
    except Exception as e:
        logger.error("Error fetching IRIS earthquake events: %s", e)
        return []


async def fetch_waveform_data(
    session: aiohttp.ClientSession,
    config: AppConfig,
    station: Station,
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> Optional[bytes]:
    url = f"{config.base_url}/fdsnws/dataselect/1/query"
    params = {
        "network": station.network,
        "station": station.station,
        "location": station.location,
        "channel": station.channel,
        "starttime": starttime.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": endtime.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(url, params=params, timeout=timeout) as resp:
            if resp.status == 200:
                return await resp.read()
            elif resp.status == 204:
                logger.info("No data available for %s", station.nslc)
            else:
                logger.error("Error fetching %s: HTTP %d", station.nslc, resp.status)
            return None
    except Exception as e:
        logger.error("Error fetching waveforms for %s: %s", station.nslc, e)
        return None


async def fetch_all_waveforms(
    session: aiohttp.ClientSession,
    config: AppConfig,
    stations: list[Station],
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> list[Optional[bytes]]:
    tasks = [
        fetch_waveform_data(session, config, station, starttime, endtime)
        for station in stations
    ]
    return await asyncio.gather(*tasks, return_exceptions=False)


async def fetch_channel_sensitivity(
    session: aiohttp.ClientSession,
    config: AppConfig,
    station: Station,
) -> Optional[float]:
    """Fetch overall sensitivity (counts per m/s) from FDSN station service."""
    url = f"{config.base_url}/fdsnws/station/1/query"
    params = {
        "network": station.network,
        "station": station.station,
        "channel": station.channel,
        "location": station.location,
        "level": "channel",
        "format": "text",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(url, params=params, timeout=timeout) as resp:
            if resp.status == 200:
                text = await resp.text()
                lines = text.strip().split("\n")
                if len(lines) > 1:
                    parts = lines[1].split("|")
                    scale = float(parts[11])
                    if scale > 0:
                        return scale
            return None
    except Exception as e:
        logger.warning("Could not fetch sensitivity for %s: %s", station.nslc, e)
        return None


async def fetch_all_sensitivities(
    session: aiohttp.ClientSession,
    config: AppConfig,
    stations: list[Station],
) -> list[Optional[float]]:
    tasks = [fetch_channel_sensitivity(session, config, s) for s in stations]
    return await asyncio.gather(*tasks, return_exceptions=False)


async def fetch_station_info(
    session: aiohttp.ClientSession,
    config: AppConfig,
    station: Station,
) -> Optional[StationLocation]:
    url = (
        f"{config.base_url}/fdsnws/station/1/query"
        f"?network={station.network}&station={station.station}"
        f"&level=station&format=text"
    )
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(url, timeout=timeout) as resp:
            if resp.status == 200:
                text = await resp.text()
                lines = text.strip().split("\n")
                if len(lines) > 1:
                    parts = lines[1].split("|")
                    return StationLocation(
                        latitude=float(parts[2]),
                        longitude=float(parts[3]),
                        elevation=float(parts[4]),
                    )
            return None
    except Exception as e:
        logger.error("Error fetching station info for %s: %s", station.nslc, e)
        return None


async def fetch_all_station_info(
    session: aiohttp.ClientSession,
    config: AppConfig,
    stations: list[Station],
) -> list[Optional[StationLocation]]:
    tasks = [fetch_station_info(session, config, s) for s in stations]
    return await asyncio.gather(*tasks, return_exceptions=False)


async def fetch_inventory(
    session: aiohttp.ClientSession,
    config: AppConfig,
    station: Station,
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> Optional[bytes]:
    """Fetch StationXML with full response information for a station."""
    url = f"{config.base_url}/fdsnws/station/1/query"
    params = {
        "network": station.network,
        "station": station.station,
        "channel": station.channel,
        "location": station.location,
        "starttime": starttime.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": endtime.strftime("%Y-%m-%dT%H:%M:%S"),
        "level": "response",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(url, params=params, timeout=timeout) as resp:
            if resp.status == 200:
                return await resp.read()
            else:
                logger.warning("No inventory for %s: HTTP %d", station.nslc, resp.status)
                return None
    except Exception as e:
        logger.error("Error fetching inventory for %s: %s", station.nslc, e)
        return None


async def fetch_all_inventories(
    session: aiohttp.ClientSession,
    config: AppConfig,
    stations: list[Station],
    starttime: UTCDateTime,
    endtime: UTCDateTime,
) -> list[Optional[bytes]]:
    tasks = [
        fetch_inventory(session, config, s, starttime, endtime)
        for s in stations
    ]
    return await asyncio.gather(*tasks, return_exceptions=False)


def parse_waveform_bytes(data: bytes) -> Optional[obspy.Stream]:
    try:
        return obspy.read(io.BytesIO(data))
    except Exception as e:
        logger.error("Error parsing waveform data: %s", e)
        return None
