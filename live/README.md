# Live Seismic Monitoring Dashboard

A browser-based real-time seismic QC dashboard built with [seisplotjs](https://github.com/crotwell/seisplotjs) v3.1.5-SNAPSHOT. Designed for day-to-day Quality Control of seismic networks, served alongside an FDSNWS-compatible data server (tested with CAPS on port 18002).

## Files

```
live/
├── dashboard.html          # Main dashboard UI (dark/light theme, collapsible sidebar)
├── pro-dashboard.js        # Dashboard application (ES module, ~2500 lines)
├── index.html              # Simple landing page
├── app.js                  # Minimal single-station viewer (legacy)
├── dashboard.js            # Legacy dashboard logic
├── seisplotjs/             # seisplotjs library — NOT tracked in git, must be present locally
└── README.md               # This file
```

## Quick Start

ES modules require HTTP — open via a local server, not `file://`:

```bash
cd live/
python3 -m http.server 8000
# Open http://localhost:8000/dashboard.html
```

For production, point an nginx/Apache document root at this directory.

## Configuration

Edit the `CONFIG` block at the top of `pro-dashboard.js`:

```javascript
const CONFIG = {
    host: window.location.hostname,   // auto-detects; override if serving from different host
    protocol: window.location.protocol,
    port: null,                        // e.g. 18002 for CAPS FDSNWS
    networks: ['AU', '2O', 'AM', 'YC', 'M8', '3B', 'YW'],
    updateInterval: 30000,             // waveform auto-refresh in ms
    helicorderHours: 6,
};
```

URL parameters can override at runtime:

| Parameter    | Example               | Description                              |
|-------------|-----------------------|------------------------------------------|
| `port`      | `?port=18002`         | Override FDSNWS port                     |
| `events`    | `?events=false`       | Disable earthquake event overlay         |
| `minmag`    | `?minmag=4.0`         | Minimum magnitude for event search       |
| `maxradius` | `?maxradius=30`       | Event search radius in degrees           |
| `lat`/`lon` | `?lat=-25&lon=134`    | Centre point for event search            |

## Views

### Waveforms
Multi-component real-time seismograph. Auto-refreshes every 30 s while monitoring is active.

- **Time windows:** 10 min / 30 min / 1 hour / 6 hours / 12 hours / 24 hours
- **Filters:** None / Bandpass / Highpass / Lowpass (configurable corner frequencies, 2-pole)
- **Earthquake events:** Overlaid as vertical markers showing origin time and location. Toggle on/off, configure min magnitude (M2–M6) and search radius (10°–180°)
- **QC indicators per component:** Latency, gap count, RMS amplitude (counts)

### Helicorder
Drum-plot style display for the selected station.

- **Duration:** 1 / 6 / 12 / 24 hours; hour-aligned start times
- **Component:** Auto-selects best Z channel; manually choose Z / E / N / 1 / 2
- **Line density:** Adapts automatically (fewer lines per hour for longer durations)

### Particle Motion
Horizontal plane (E–N or 1–2) particle motion plot.

- Components matched within the same band type (no cross-band mixing)
- Supports both E/N and 1/2 orientation codes

### Spectra
FFT amplitude spectrum per component.

- Toggle individual components on/off
- Axes: Frequency (Hz) vs Amplitude (counts)

### Spectrogram
Short-time Fourier transform (STFT) spectrogram.

- **Duration:** 1 / 5 / 10 / 30 minutes
- **Frequency range:** Configurable min and max frequency
- **Component:** Auto or manual selection

### Station Health
Single-scan QC summary across all network stations. Configurable scan window with adaptive batch sizing for server performance.

**Scan windows:** 5 min / 30 min / 1 hour / 6 hours / 24 hours

**Columns:**

| Column       | Description                                        |
|-------------|----------------------------------------------------|
| **Status**  | See status definitions below                       |
| **Latency** | Age of most recent sample relative to server time  |
| **Gaps**    | Number of data gaps detected in the scan window    |
| **RMS Z/E/N** | RMS amplitude in counts per component            |
| **Channels**| Active channel codes detected                      |

**Status categories:**

| Status      | Colour | Condition                                                          |
|------------|--------|--------------------------------------------------------------------|
| OK         | Green  | Latency < 60 s, no gaps                                            |
| Gaps       | Blue   | Latency OK but one or more data gaps detected                      |
| Delayed    | Yellow | Latency 60 s – 5 min                                               |
| Clock Off  | Purple | Negative latency > 10 s (station clock ahead of server — GPS/NTP) |
| Stale      | Red    | Latency > 5 min                                                    |
| No Data    | Grey   | No data returned for the scan window                               |

Results are:
- Sortable by any column (click header)
- Filterable by status badge (click badge to toggle)
- Searchable by station code
- Click a row to jump to that station's Waveforms view

## Channel Support

- **Band codes (priority order):** BH > HH > SH > EH > BN > HN > EN
- **Orientation codes:** Standard E/N/Z and 1/2/Z (e.g. QIS, QLP)
- **Excluded automatically:** Infrasound (`I??`), hydroacoustic (`H??`) stations

## Deployment to Production

```bash
# Push local changes to server
rsync -avz --exclude='seisplotjs/' live/ qcbox:/opt/helicorders-v2/live/
ssh qcbox "chmod -R a+rX /opt/helicorders-v2/live/"
```

## Dependencies

- [seisplotjs](https://github.com/crotwell/seisplotjs) v3.1.5-SNAPSHOT standalone ES module
- No build step — pure static files

## License

AGPL-3.0 — see [`LICENSE`](../LICENSE) at the repository root.
