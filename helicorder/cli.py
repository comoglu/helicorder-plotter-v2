from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime

import click
from obspy import UTCDateTime

from .config import load_config
from .fetcher import (
    fetch_all_station_info,
    fetch_all_waveforms,
    fetch_earthquake_events,
)
from .models import StationMapEntry
from .plotter import generate_plots
from .site import build_site

logger = logging.getLogger(__name__)


def setup_logging(log_dir: str = "logs") -> None:
    os.makedirs(log_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(log_dir, f"helicorder_{timestamp}.log")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(),
        ],
    )
    logger.info("Log file: %s", log_file)


async def run(
    config_path: str,
    output_override: str | None,
    hours_override: int | None,
    station_filter: tuple[str, ...],
    skip_map: bool,
) -> None:
    import aiohttp

    config = load_config(config_path)
    if output_override:
        config.output_dir = output_override
    if hours_override:
        config.hours = hours_override

    stations = config.stations
    if station_filter:
        ids = set(station_filter)
        stations = [s for s in stations if f"{s.network}.{s.station}" in ids]
        if not stations:
            logger.error("No stations matched filter: %s", station_filter)
            sys.exit(1)

    logger.info("Processing %d stations for %d hours of data", len(stations), config.hours)

    endtime = UTCDateTime.now()
    starttime = endtime.replace(minute=0, second=0, microsecond=0) - config.hours * 3600

    async with aiohttp.ClientSession() as session:
        # Fetch events and waveforms concurrently
        events, waveform_results = await asyncio.gather(
            fetch_earthquake_events(session, config, starttime, endtime),
            fetch_all_waveforms(session, config, stations, starttime, endtime),
        )

    # Pair stations with their waveform data, filtering out failures
    waveform_data = [
        (station, data)
        for station, data in zip(stations, waveform_results)
        if data is not None
    ]

    logger.info("Got waveforms for %d/%d stations", len(waveform_data), len(stations))

    if not waveform_data:
        logger.error("No waveform data retrieved. Check your data source and config.")
        sys.exit(1)

    # Generate plots in separate processes
    plots = generate_plots(
        waveform_data, events, starttime, endtime,
        config.output_dir, config.max_workers,
    )

    if not plots:
        logger.error("No plots were generated.")
        sys.exit(1)

    # Fetch station coordinates for the map
    station_map: list[StationMapEntry] = []
    if not skip_map:
        async with aiohttp.ClientSession() as session:
            locations = await fetch_all_station_info(session, config, stations)
        for station, loc in zip(stations, locations):
            if loc is not None:
                station_map.append(StationMapEntry(
                    station=station,
                    latitude=loc.latitude,
                    longitude=loc.longitude,
                    elevation=loc.elevation,
                ))

    # Build the static site
    build_site(plots, station_map, config.output_dir)
    logger.info("Done. %d/%d stations plotted. Open %s/index.html to view.",
                len(plots), len(stations), config.output_dir)


@click.command()
@click.option("--config", "-c", "config_path", default="config.yaml",
              help="Path to config YAML file")
@click.option("--output", "-o", default=None,
              help="Output directory override")
@click.option("--hours", "-H", default=None, type=int,
              help="Hours of data to plot (overrides config)")
@click.option("--station", "-s", multiple=True,
              help="Process specific station(s) only (e.g. -s AU.CNB -s AU.CTA)")
@click.option("--skip-map", is_flag=True, default=False,
              help="Skip fetching station coordinates and map generation")
def main(config_path, output, hours, station, skip_map):
    """Generate helicorder plots from FDSN seismic data."""
    setup_logging()
    asyncio.run(run(config_path, output, hours, station, skip_map))


if __name__ == "__main__":
    main()
