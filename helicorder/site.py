from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from .models import PlotResult, StationMapEntry

logger = logging.getLogger(__name__)

PACKAGE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = PACKAGE_DIR / "templates"
STATIC_DIR = PACKAGE_DIR / "static"


def build_site(
    plots: list[PlotResult],
    station_map: list[StationMapEntry],
    output_dir: str,
) -> None:
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
    os.makedirs(output_dir, exist_ok=True)

    _generate_index(env, plots, output_dir)
    _generate_station_pages(env, plots, output_dir)
    _generate_map_page(env, output_dir)
    _generate_station_json(station_map, output_dir)
    _copy_static(output_dir)

    logger.info("Site built in %s (%d station pages)", output_dir, len(plots))


def _generate_index(env: Environment, plots: list[PlotResult], output_dir: str) -> None:
    template = env.get_template("index.html")
    path = os.path.join(output_dir, "index.html")
    with open(path, "w") as f:
        f.write(template.render(plots=plots))


def _generate_station_pages(env: Environment, plots: list[PlotResult], output_dir: str) -> None:
    template = env.get_template("station.html")
    for plot in plots:
        path = os.path.join(output_dir, f"{plot.id}.html")
        with open(path, "w") as f:
            f.write(template.render(plot=plot))


def _generate_map_page(env: Environment, output_dir: str) -> None:
    template = env.get_template("map.html")
    path = os.path.join(output_dir, "map.html")
    with open(path, "w") as f:
        f.write(template.render())


def _generate_station_json(station_map: list[StationMapEntry], output_dir: str) -> None:
    data = [
        {
            "id": entry.station.id,
            "network": entry.station.network,
            "station": entry.station.station,
            "channel": entry.station.channel,
            "location": entry.station.location,
            "latitude": entry.latitude,
            "longitude": entry.longitude,
            "elevation": entry.elevation,
        }
        for entry in station_map
    ]
    path = os.path.join(output_dir, "station_data.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _copy_static(output_dir: str) -> None:
    dest = os.path.join(output_dir, "static")
    if STATIC_DIR.exists():
        shutil.copytree(str(STATIC_DIR), dest, dirs_exist_ok=True)
