# Seismic Visualization Integration Guide

This guide explains how to add Helicorder, Particle Motion, and Spectra visualizations to the live monitoring system using seisplotjs.

## Available Visualization Modules

### 1. Helicorder (`sp.helicorder`)
24-hour drum plot showing continuous seismic data in a helicorder format.

**Usage:**
```javascript
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

// Create helicorder element
const heliDiv = document.createElement('sp-helicorder');
heliDiv.setAttribute('duration', 'P1D'); // 1 day
heliDiv.setAttribute('interval', 'PT30M'); // 30 minute lines

// Load data
const seismogramList = [...]; // Array of seismograms
const heli = new sp.helicorder.Helicorder(heliDiv);
heli.setSeismograms(seismogramList);
heli.draw();
```

**Features:**
- 24-hour continuous display
- Configurable line intervals (15min, 30min, 1hour)
- Amplitude scaling options
- Click to zoom into specific time window
- Filtering support (highpass, lowpass, bandpass)

### 2. Particle Motion (`sp.particlemotion`)
Shows particle motion plot from 3-component seismogram data (vertical, north-south, east-west).

**Usage:**
```javascript
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

// Requires 3-component data
const zSeismogram = ...; // Vertical (HHZ)
const nSeismogram = ...; // North (HHN)
const eSeismogram = ...; // East (HHE)

const pmDiv = document.getElementById('particleMotion');
const pm = new sp.particlemotion.ParticleMotion(pmDiv, eSeismogram, nSeismogram, zSeismogram);
pm.draw();
```

**Views:**
- EN (East-North, horizontal plane)
- EZ (East-Vertical, vertical east plane)
- NZ (North-Vertical, vertical north plane)
- All three views side-by-side

**Features:**
- Time window selection
- Color gradient by time
- Amplitude scaling
- Phase identification

### 3. Spectra (`sp.spectraplot` + `sp.fft`)
Frequency analysis showing spectral content of seismic data.

**Usage:**
```javascript
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

// Calculate FFT
const seismogram = ...;
const fftResult = sp.fft.fftForward(seismogram);

// Plot spectrum
const spectraDiv = document.getElementById('spectra');
const spectraPlot = new sp.spectraplot.SpectraPlot(spectraDiv, fftResult);
spectraPlot.draw();
```

**Features:**
- Power spectral density
- Logarithmic frequency scale
- Smoothing options
- Peak frequency identification
- Spectral ratio calculations

## Implementation Plan

### Step 1: Create Enhanced Dashboard HTML

Create `live/enhanced-dashboard.html` with view mode tabs:
- Waveforms (current view)
- Helicorder (new)
- Particle Motion (new)
- Spectra (new)

### Step 2: Modify Data Loading

Update data fetching to support:
- Multi-component data (Z, N, E) for particle motion
- Longer time windows for helicorder (24 hours)
- Configurable sampling for spectra

### Step 3: Add View Controllers

Create separate controller functions:
- `renderWaveformView()` - Current seismograph view
- `renderHelicorderView()` - 24-hour helicorder
- `renderParticleMotionView()` - 3-component particle motion
- `renderSpectraView()` - Frequency analysis

### Step 4: Add Configuration Controls

For each view type, add controls for:

**Helicorder:**
- Time duration (12h, 24h, 48h)
- Line interval (15min, 30min, 1hour)
- Amplitude mode (auto, fixed, percent)
- Filtering options

**Particle Motion:**
- Component selection (ENZ)
- Time window
- View mode (EN/EZ/NZ/All)
- Color scheme

**Spectra:**
- FFT window length
- Overlap percentage
- Smoothing factor
- Frequency range

## File Structure

```
live/
├── enhanced-dashboard.html     # New dashboard with all view modes
├── enhanced-dashboard.js       # Main controller
├── modules/
│   ├── helicorder-view.js     # Helicorder visualization
│   ├── particle-motion-view.js # Particle motion visualization
│   └── spectra-view.js        # Spectra visualization
└── seisplotjs/                # seisplotjs library (already exists)
```

## Example Integration

```javascript
// In enhanced-dashboard.js
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

class EnhancedMonitoringDashboard {
    constructor() {
        this.currentView = 'waveforms';
        this.sp = sp;
        this.stations = [];
    }

    switchView(viewName) {
        this.currentView = viewName;

        switch(viewName) {
            case 'waveforms':
                this.renderWaveformView();
                break;
            case 'helicorder':
                this.renderHelicorderView();
                break;
            case 'particlemotion':
                this.renderParticleMotionView();
                break;
            case 'spectra':
                this.renderSpectraView();
                break;
        }
    }

    async renderHelicorderView() {
        const stationCode = this.getSelectedStation();
        const endTime = sp.luxon.DateTime.utc();
        const startTime = endTime.minus({ days: 1 });

        // Fetch 24 hours of data
        const dsQuery = new sp.fdsndataselect.DataSelectQuery()
            .host('eida.koeri.boun.edu.tr')
            .networkCode('KO')
            .stationCode(stationCode)
            .channelCode('HHZ')
            .startTime(startTime)
            .endTime(endTime);

        const dataRecords = await dsQuery.queryDataRecords();
        const seismogramMap = sp.miniseed.seismogramPerChannel(dataRecords);
        const seismograms = Array.from(seismogramMap.values());

        // Create helicorder
        const heliContainer = document.getElementById('helicorderContainer');
        heliContainer.innerHTML = '<sp-helicorder></sp-helicorder>';
        const heliElement = heliContainer.querySelector('sp-helicorder');

        const heli = new sp.helicorder.Helicorder(heliElement);
        heli.setSeismograms(seismograms);
        heli.draw();
    }

    async renderParticleMotionView() {
        // Fetch 3-component data
        const stationCode = this.getSelectedStation();
        const endTime = sp.luxon.DateTime.utc();
        const startTime = endTime.minus({ minutes: 10 });

        // Fetch Z, N, E components in parallel
        const [zData, nData, eData] = await Promise.all([
            this.fetchComponent(stationCode, 'HHZ', startTime, endTime),
            this.fetchComponent(stationCode, 'HHN', startTime, endTime),
            this.fetchComponent(stationCode, 'HHE', startTime, endTime)
        ]);

        // Create particle motion plot
        const pmContainer = document.getElementById('particleMotionContainer');
        const pm = new sp.particlemotion.ParticleMotion(
            pmContainer,
            eData[0], // East
            nData[0], // North
            zData[0]  // Vertical
        );
        pm.draw();
    }

    async renderSpectraView() {
        const stationCode = this.getSelectedStation();
        const endTime = sp.luxon.DateTime.utc();
        const startTime = endTime.minus({ minutes: 10 });

        // Fetch data
        const seismogram = await this.fetchComponent(stationCode, 'HHZ', startTime, endTime);

        // Calculate FFT
        const fftResult = sp.fft.fftForward(seismogram[0]);

        // Plot spectrum
        const spectraContainer = document.getElementById('spectraContainer');
        const spectraPlot = new sp.spectraplot.SpectraPlot(spectraContainer, fftResult);
        spectraPlot.draw();
    }
}
```

## Next Steps

1. Create the enhanced dashboard HTML structure
2. Implement view switching logic
3. Add data fetching for each view type
4. Implement visualization rendering functions
5. Add configuration controls
6. Test with live KOERI data

## API Documentation

Full seisplotjs API documentation: `./seisplotjs/docs/api/index.html`

Relevant modules:
- `helicorder.html` - Helicorder API
- `particlemotion.html` - Particle Motion API
- `spectraplot.html` - Spectra Plot API
- `fft.html` - FFT API
