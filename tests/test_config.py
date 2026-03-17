import tempfile
import os

import pytest

from helicorder.config import load_config
from helicorder.models import Station


def _write_config(tmp_path, content):
    path = os.path.join(tmp_path, "config.yaml")
    with open(path, "w") as f:
        f.write(content)
    return path


def test_load_minimal_config(tmp_path):
    path = _write_config(tmp_path, """
base_url: "http://localhost:8080"
stations:
  AU.CNB: "BHZ.00"
""")
    config = load_config(path)
    assert config.base_url == "http://localhost:8080"
    assert len(config.stations) == 1
    s = config.stations[0]
    assert s.network == "AU"
    assert s.station == "CNB"
    assert s.channel == "BHZ"
    assert s.location == "00"


def test_station_without_location(tmp_path):
    path = _write_config(tmp_path, """
stations:
  AU.CTA: "BHZ"
""")
    config = load_config(path)
    s = config.stations[0]
    assert s.location == ""
    assert s.id == "AU.CTA.--.BHZ"


def test_defaults(tmp_path):
    path = _write_config(tmp_path, """
stations:
  AU.CNB: "BHZ.00"
""")
    config = load_config(path)
    assert config.max_workers == 8
    assert config.min_magnitude == 5.5
    assert config.hours == 24
    assert config.timeout == 30
    assert config.output_dir == "output"


def test_override_values(tmp_path):
    path = _write_config(tmp_path, """
max_workers: 4
hours: 12
min_magnitude: 3.0
output_dir: "my_output"
stations:
  AU.CNB: "BHZ.00"
""")
    config = load_config(path)
    assert config.max_workers == 4
    assert config.hours == 12
    assert config.min_magnitude == 3.0
    assert config.output_dir == "my_output"


def test_multiple_stations(tmp_path):
    path = _write_config(tmp_path, """
stations:
  AU.CNB: "BHZ.00"
  AU.CTA: "BHZ"
  2O.BTL01: "BHZ.00"
""")
    config = load_config(path)
    assert len(config.stations) == 3
    assert config.stations[2].network == "2O"
    assert config.stations[2].station == "BTL01"
