# Helicorder Plotter v2

Seismic helicorder (dayplot) generator that fetches waveform data from FDSN web services, removes instrument gain for true ground velocity (m/s), annotates earthquake events from Geoscience Australia or IRIS, and produces a self-contained static website with an interactive Leaflet station map.

## How It Works

```
config.yaml
    │
    ├─ stations ──► async fetch waveforms (aiohttp)
    │                        │
    ├─ stations ──► async fetch sensitivity (FDSN station level=channel)
    │                        │
    └─ event_source ──► async fetch earthquakes (GA WFS or IRIS FDSN)
                             │
                     ┌───────┴───────┐
                     ▼               ▼
              waveform bytes    event list + sensitivities
                     │               │
                     └───────┬───────┘
                             ▼
                  ProcessPoolExecutor
                   ├─ obspy.read()
                   ├─ demean + detrend
                   ├─ divide by sensitivity → m/s
                   ├─ autoscaled dayplot
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
2. **Async fetch** — Earthquake events, waveforms, and channel sensitivities are all fetched concurrently using aiohttp. Three parallel request batches complete before any plotting begins.
3. **Gain removal** — Each trace is demeaned, linearly detrended, and divided by the channel sensitivity (counts per m/s) from the FDSN station service. This gives approximate ground velocity in nm/s without the computational cost of full response deconvolution.
4. **Parallel plot** — Waveform data is handed to a `ProcessPoolExecutor` where each worker renders an autoscaled helicorder dayplot. Event annotations appear in a right-side legend column to keep waveform data unobstructed for QC.
5. **Site build** — Jinja2 templates with inheritance produce an index grid, individual station pages, and a Leaflet map with date line wrapping for Pacific stations.

### Earthquake Event Sources

| Source | What it provides | Config |
|--------|-----------------|--------|
| **Geoscience Australia** (default) | Local Australian events (M3+) plus global events via WFS GeoServer | `event_source: "ga"` |
| **IRIS FDSN** | Global events only | `event_source: "iris"` |

Events are displayed in a right-side column on each plot — sorted by time, with magnitude and description. Subtle dashed reference lines mark event times on the waveform without obscuring data.

## Requirements

- Python 3.9+
- A running FDSN dataselect + station web service (SeisComP, ringserver, or any FDSN-compliant server)

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
# FDSN service base URL (must serve both dataselect and station)
base_url: "http://127.0.0.1:8081"

# Earthquake event source: "ga" or "iris"
event_source: "ga"

# Plot settings
output_dir: "output"
max_workers: 8
min_magnitude: 3.0
hours: 24
timeout: 30

# Stations: "Network.Station": "Channel" or "Channel.Location"
stations:
  AU.CNB: "BHZ.00"
  AU.CTA: "BHZ"
  AU.NIUE: "BHZ.00"
  2O.BTL01: "BHZ.00"
```

`base_url` must expose both `/fdsnws/dataselect/1/query` and `/fdsnws/station/1/query`.

## Usage

```bash
# Run with defaults
helicorder

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
├── AU.CNB.00.BHZ.png          # Full-resolution helicorder (nm/s, autoscaled)
├── AU.CNB.00.BHZ_thumb.png    # Thumbnail
└── static/
    ├── css/styles.css
    └── js/map.js
```

Open `output/index.html` in a browser to view results.

### Logs

Written to `logs/` with timestamps, e.g. `logs/helicorder_20260318_120000.log`.

## Deployment

### systemd (recommended)

Create `/etc/systemd/system/helicorder-v2.service`:

```ini
[Unit]
Description=Helicorder Plotter v2
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/opt/helicorders-v2
ExecStart=/opt/helicorders-v2/venv/bin/helicorder -c /opt/helicorders-v2/config.yaml
TimeoutStartSec=1200
MemoryMax=12G
Nice=10

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/helicorder-v2.timer`:

```ini
[Unit]
Description=Run Helicorder Plotter v2 every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
AccuracySec=1min

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now helicorder-v2.timer

# Manual run
sudo systemctl start helicorder-v2.service

# Check status
systemctl status helicorder-v2.timer
journalctl -u helicorder-v2.service -f
```

### nginx

```nginx
location /helicorders-v2 {
    alias /opt/helicorders-v2/output;
    try_files $uri $uri/ =404;

    location ~* \.(json|png)$ {
        try_files $uri =404;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

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
│   ├── fetcher.py          # Async FDSN + GA WFS client (aiohttp)
│   ├── plotter.py          # ProcessPoolExecutor dayplot rendering
│   └── site.py             # Jinja2 HTML + static file builder
├── templates/
│   ├── base.html           # Shared layout (nav, head)
│   ├── index.html          # Station grid
│   ├── station.html        # Individual station page
│   └── map.html            # Leaflet map page
├── static/
│   ├── css/styles.css
│   └── js/map.js           # Leaflet map with date line wrapping
└── tests/
    ├── test_config.py
    ├── test_models.py
    └── test_fetcher.py
```

## License

AGPL-3.0 — see [LICENSE](LICENSE).
