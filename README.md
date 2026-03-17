# Helicorder Plotter v2

Seismic helicorder (dayplot) generator that fetches waveform data from FDSN web services, annotates earthquake events, and produces a self-contained static website with an interactive Leaflet station map.

## How It Works

```
config.yaml
    │
    ├─ stations ──► async fetch waveforms (aiohttp)
    │                        │
    └─ event_url ──► async fetch earthquakes
                             │
                     ┌───────┴───────┐
                     ▼               ▼
              waveform bytes    event list
                     │               │
                     └───────┬───────┘
                             ▼
                  ProcessPoolExecutor
                   ├─ obspy.read()
                   ├─ dayplot render
                   ├─ full-res PNG
                   └─ thumbnail PNG
                             │
                             ▼
                    Jinja2 site builder
                             │
                             ▼
                        output/
                         ├── index.html
                         ├── map.html
                         ├── station_data.json
                         ├── <station>.html
                         ├── <station>.png
                         ├── <station>_thumb.png
                         └── static/{css,js}
```

### Pipeline

1. **Config** — Station definitions and service URLs loaded from `config.yaml` and validated with Pydantic.
2. **Async fetch** — Earthquake events and all station waveforms are fetched concurrently using aiohttp.
3. **Parallel plot** — Waveform bytes are handed to a `ProcessPoolExecutor` where each worker parses with ObsPy and renders a helicorder dayplot. Matplotlib runs in fully isolated processes — no global state issues.
4. **Site build** — Jinja2 templates with inheritance produce an index grid, individual station pages, and a Leaflet map. Static assets are copied to the output directory.

## Requirements

- Python 3.9+
- A running FDSN dataselect web service (SeisComP, ringserver, or any FDSN-compliant server)

### Dependencies

| Package    | Purpose                                      |
|------------|----------------------------------------------|
| ObsPy      | Waveform I/O, dayplot rendering, UTCDateTime |
| matplotlib | Plotting backend (used by ObsPy)             |
| Pillow     | Thumbnail generation                         |
| aiohttp    | Async HTTP for concurrent data fetching      |
| pydantic   | Typed, validated configuration               |
| pyyaml     | YAML config parsing                          |
| click      | CLI with flags and options                   |
| Jinja2     | HTML template rendering                      |

## Installation

```bash
git clone https://github.com/comoglu/helicorder-plotter-v2.git
cd helicorder-plotter-v2

python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

pip install -e .           # installs the 'helicorder' command

# For development/testing:
pip install -e ".[dev]"
```

## Configuration

Edit `config.yaml`:

```yaml
# FDSN service endpoints
base_url: "http://127.0.0.1:18081"
event_url: "http://service.iris.edu/fdsnws/event/1/query"

# Plot settings
output_dir: "output"
max_workers: 8
min_magnitude: 5.5
hours: 24
timeout: 30

# Stations: "Network.Station": "Channel" or "Channel.Location"
stations:
  AU.CNB: "BHZ.00"
  AU.CTA: "BHZ"
  2O.BTL01: "BHZ.00"
```

`base_url` must expose both `/fdsnws/dataselect/1/query` and `/fdsnws/station/1/query`.

## Usage

```bash
# Run with defaults
helicorder

# Or run as a module
python -m helicorder.cli

# Override config path and output directory
helicorder -c my_config.yaml -o /tmp/plots

# Only plot specific stations
helicorder -s AU.CNB -s AU.CTA

# Plot 12 hours instead of 24
helicorder -H 12

# Skip map generation (faster if you don't need it)
helicorder --skip-map
```

### Output

```
output/
├── index.html                 # Thumbnail grid of all stations
├── map.html                   # Interactive Leaflet map
├── station_data.json          # Station coordinates (JSON)
├── AU.CNB.00.BHZ.html         # Station detail page
├── AU.CNB.00.BHZ.png          # Full-resolution helicorder
├── AU.CNB.00.BHZ_thumb.png    # Thumbnail
└── static/
    ├── css/styles.css
    └── js/map.js
```

Open `output/index.html` in a browser to view results.

### Logs

Written to `logs/` with timestamps, e.g. `logs/helicorder_20260318_120000.log`.

## Testing

```bash
pip install -e ".[dev]"
pytest
```

## Project Structure

```
helicorder-plotter-v2/
├── pyproject.toml          # Build config, dependencies, CLI entry point
├── config.yaml             # Station + service configuration
├── helicorder/
│   ├── __init__.py
│   ├── cli.py              # Click CLI, async orchestration, logging
│   ├── config.py           # Pydantic config model, YAML loader
│   ├── models.py           # Dataclasses: Station, Event, PlotResult
│   ├── fetcher.py          # Async FDSN client (aiohttp)
│   ├── plotter.py          # ProcessPoolExecutor dayplot rendering
│   └── site.py             # Jinja2 HTML + static file builder
├── templates/
│   ├── base.html           # Shared layout (nav, head)
│   ├── index.html          # Station grid
│   ├── station.html        # Individual station page
│   └── map.html            # Leaflet map page
├── static/
│   ├── css/styles.css
│   └── js/map.js
└── tests/
    ├── test_config.py
    ├── test_models.py
    └── test_fetcher.py
```

## License

MIT — see [LICENSE](LICENSE).
