import re

import pytest
from aioresponses import aioresponses
import aiohttp

from helicorder.config import AppConfig
from helicorder.fetcher import fetch_earthquake_events, fetch_waveform_data
from helicorder.models import Station

try:
    from obspy import UTCDateTime
except ImportError:
    pytest.skip("obspy not installed", allow_module_level=True)


SAMPLE_EVENT_RESPONSE = """\
EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContribID|MagType|Magnitude|MagAuthor|EventLocationName
12345|2026-03-17T12:00:00|-10.5|160.2|35.0|us|us|us|us12345|mww|6.2|us|Solomon Islands
"""


@pytest.fixture
def config():
    return AppConfig(
        base_url="http://test-server:8080",
        event_url="http://test-events/fdsnws/event/1/query",
        stations=[Station(network="AU", station="CNB", channel="BHZ", location="00")],
    )


@pytest.mark.asyncio
async def test_fetch_earthquake_events(config):
    start = UTCDateTime("2026-03-17T00:00:00")
    end = UTCDateTime("2026-03-18T00:00:00")

    pattern = re.compile(r"^http://test-events/fdsnws/event/1/query\?")

    with aioresponses() as m:
        m.get(pattern, status=200, body=SAMPLE_EVENT_RESPONSE)
        async with aiohttp.ClientSession() as session:
            events = await fetch_earthquake_events(session, config, start, end)

    assert len(events) == 1
    assert events[0].magnitude == 6.2
    assert events[0].description == "Solomon Islands"


@pytest.mark.asyncio
async def test_fetch_earthquake_events_error(config):
    start = UTCDateTime("2026-03-17T00:00:00")
    end = UTCDateTime("2026-03-18T00:00:00")

    pattern = re.compile(r"^http://test-events/fdsnws/event/1/query\?")

    with aioresponses() as m:
        m.get(pattern, status=500)
        async with aiohttp.ClientSession() as session:
            events = await fetch_earthquake_events(session, config, start, end)

    assert events == []


@pytest.mark.asyncio
async def test_fetch_waveform_data_no_data(config):
    station = config.stations[0]
    start = UTCDateTime("2026-03-17T00:00:00")
    end = UTCDateTime("2026-03-18T00:00:00")

    pattern = re.compile(r"^http://test-server:8080/fdsnws/dataselect/1/query\?")

    with aioresponses() as m:
        m.get(pattern, status=204)
        async with aiohttp.ClientSession() as session:
            result = await fetch_waveform_data(session, config, station, start, end)

    assert result is None
