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
    params = {
        "starttime": starttime.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": endtime.strftime("%Y-%m-%dT%H:%M:%S"),
        "minmagnitude": config.min_magnitude,
        "format": "text",
    }
    try:
        timeout = aiohttp.ClientTimeout(total=config.timeout)
        async with session.get(config.event_url, params=params, timeout=timeout) as resp:
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
                ))
            logger.info("Fetched %d earthquake events", len(events))
            return events
    except Exception as e:
        logger.error("Error fetching earthquake events: %s", e)
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


def parse_waveform_bytes(data: bytes) -> Optional[obspy.Stream]:
    try:
        return obspy.read(io.BytesIO(data))
    except Exception as e:
        logger.error("Error parsing waveform data: %s", e)
        return None
