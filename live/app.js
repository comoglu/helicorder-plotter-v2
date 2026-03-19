// Import seisplotjs
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

// Configuration
const CONFIG = {
    host: window.location.hostname,
    protocol: window.location.protocol,
    updateInterval: 30000, // 30 seconds
    defaultDuration: 600, // 10 minutes
};

// State
const state = {
    stations: [],
    updateInterval: null,
    filter: {
        type: 'none',
        lowcut: 1.0,
        highcut: 10.0,
        poles: 2
    }
};

// Parse URL parameters
function parseURLStations() {
    // Get raw query string without the '?'
    const queryString = window.location.search.substring(1);

    if (!queryString) return [];

    // Parse format: ?KO.ISK,KO.CHAY
    const stations = [];

    // Split by comma to get individual station codes
    const parts = queryString.split(',');
    parts.forEach(part => {
        // Match pattern: NETWORK.STATION (e.g., KO.ISK)
        const match = part.trim().match(/([A-Z0-9]{2})\.([A-Z0-9]+)/i);
        if (match) {
            stations.push({
                network: match[1],
                code: match[2],
            });
        }
    });

    return stations;
}

// Initialize
async function init() {
    console.log('Initializing Live Monitor...');

    const urlStations = parseURLStations();

    if (urlStations.length === 0) {
        // Show welcome screen
        return;
    }

    // Load station metadata
    await loadStationMetadata(urlStations);

    // Display stations
    displayStations();

    // Setup filter controls
    setupFilterControls();

    // Start live updates
    startLiveUpdates();

    console.log('Live monitor active');
}

// Load station metadata
async function loadStationMetadata(urlStations) {
    // Group stations by network for efficient queries
    const byNetwork = {};
    urlStations.forEach(s => {
        if (!byNetwork[s.network]) byNetwork[s.network] = [];
        byNetwork[s.network].push(s.code);
    });

    state.stations = [];

    // Fetch metadata for each network group
    const fetches = Object.entries(byNetwork).map(async ([network, codes]) => {
        try {
            const url = `${CONFIG.protocol}//${CONFIG.host}/fdsnws/station/1/query?network=${network}&station=${codes.join(',')}&level=station&format=text`;
            const response = await fetch(url);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const text = await response.text();
            const lines = text.trim().split('\n');

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('|');
                if (parts.length >= 7) {
                    const net = parts[0].trim();
                    const stationCode = parts[1].trim();
                    if (urlStations.find(s => s.network === net && s.code === stationCode)) {
                        state.stations.push({
                            network: net,
                            code: stationCode,
                            latitude: parseFloat(parts[2].trim()),
                            longitude: parseFloat(parts[3].trim()),
                            elevation: parseFloat(parts[4].trim()),
                            siteName: parts[5].trim(),
                            duration: CONFIG.defaultDuration,
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`Error loading metadata for network ${network}:`, error);
        }
    });

    await Promise.all(fetches);
    console.log(`Loaded metadata for ${state.stations.length} stations`);
}

// Display stations
function displayStations() {
    const content = document.getElementById('content');

    document.getElementById('stationCount').textContent =
        `Monitoring ${state.stations.length} station${state.stations.length > 1 ? 's' : ''}`;

    content.innerHTML = `
        <div class="station-grid">
            ${state.stations.map(station => `
                <div class="station-card" id="station-${station.code}">
                    <div class="station-header">
                        <div>
                            <div class="station-title">${station.network}.${station.code}</div>
                            <div class="station-subtitle">${station.siteName}</div>
                        </div>
                        <div class="time-window">
                            <button class="time-btn ${station.duration === 600 ? 'active' : ''}"
                                    onclick="changeTimeWindow('${station.code}', 600)">10m</button>
                            <button class="time-btn ${station.duration === 1800 ? 'active' : ''}"
                                    onclick="changeTimeWindow('${station.code}', 1800)">30m</button>
                            <button class="time-btn ${station.duration === 3600 ? 'active' : ''}"
                                    onclick="changeTimeWindow('${station.code}', 3600)">1h</button>
                        </div>
                    </div>
                    <div class="seismograph-container" id="seismo-${station.code}">
                        <div class="loading">
                            <div class="spinner"></div>
                            <p>Loading data...</p>
                        </div>
                    </div>
                    <div class="metadata">
                        <div>
                            <div class="metadata-label">Location</div>
                            <div class="metadata-value">${station.latitude.toFixed(2)}°N, ${station.longitude.toFixed(2)}°E</div>
                        </div>
                        <div>
                            <div class="metadata-label">Elevation</div>
                            <div class="metadata-value">${station.elevation}m</div>
                        </div>
                        <div>
                            <div class="metadata-label">Start Time</div>
                            <div class="metadata-value" id="start-${station.code}">--:--</div>
                        </div>
                        <div>
                            <div class="metadata-label">End Time</div>
                            <div class="metadata-value" id="end-${station.code}">--:--</div>
                        </div>
                        <div>
                            <div class="metadata-label">Sample Rate</div>
                            <div class="metadata-value" id="rate-${station.code}">-- Hz</div>
                        </div>
                        <div>
                            <div class="metadata-label">Samples</div>
                            <div class="metadata-value" id="samples-${station.code}">0</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Fetch initial data
    state.stations.forEach(station => {
        fetchStationData(station);
    });
}

// Setup filter controls
function setupFilterControls() {
    const filterControls = document.getElementById('filterControls');
    const filterType = document.getElementById('filterType');
    const filterPreset = document.getElementById('filterPreset');

    if (!filterControls || !filterType || !filterPreset) {
        console.warn('Filter controls not found in DOM');
        return;
    }

    // Show filter controls
    filterControls.style.display = 'flex';

    filterType.addEventListener('change', () => {
        state.filter.type = filterType.value;

        if (filterType.value === 'none') {
            filterPreset.style.display = 'none';
        } else {
            filterPreset.style.display = 'block';
            if (filterType.value === 'bandpass') {
                filterPreset.innerHTML = `
                    <option value="1-10">1-10 Hz</option>
                    <option value="2-5">2-5 Hz</option>
                    <option value="0.5-15">0.5-15 Hz</option>
                `;
            } else if (filterType.value === 'highpass') {
                filterPreset.innerHTML = `
                    <option value="0.5">0.5 Hz</option>
                    <option value="1">1 Hz</option>
                    <option value="2">2 Hz</option>
                `;
            } else if (filterType.value === 'lowpass') {
                filterPreset.innerHTML = `
                    <option value="5">5 Hz</option>
                    <option value="10">10 Hz</option>
                    <option value="15">15 Hz</option>
                `;
            }
            updateFilterFromPreset(filterPreset.value);
        }

        // Reload all stations
        state.stations.forEach(station => fetchStationData(station));
    });

    filterPreset.addEventListener('change', () => {
        updateFilterFromPreset(filterPreset.value);
        state.stations.forEach(station => fetchStationData(station));
    });
}

// Update filter from preset
function updateFilterFromPreset(preset) {
    const filterType = state.filter.type;

    if (filterType === 'bandpass') {
        const [low, high] = preset.split('-').map(parseFloat);
        state.filter.lowcut = low;
        state.filter.highcut = high;
    } else if (filterType === 'highpass') {
        state.filter.lowcut = parseFloat(preset);
    } else if (filterType === 'lowpass') {
        state.filter.highcut = parseFloat(preset);
    }

    console.log(`Filter updated: ${filterType} - Low: ${state.filter.lowcut} Hz, High: ${state.filter.highcut} Hz`);
}

// Apply filter to seismogram display data
function applyFilter(displayData) {
    if (state.filter.type === 'none') {
        return displayData;
    }

    try {
        let seismogram = displayData.seismogram;

        // Remove mean
        seismogram = sp.filter.rMean(seismogram);

        // Remove linear trend
        const fitLine = sp.filter.lineFit(seismogram);
        seismogram = sp.filter.removeTrend(seismogram, fitLine);

        // Create Butterworth filter
        let filterStyle;
        if (state.filter.type === 'lowpass') {
            filterStyle = sp.filter.LOW_PASS;
        } else if (state.filter.type === 'bandpass') {
            filterStyle = sp.filter.BAND_PASS;
        } else if (state.filter.type === 'highpass') {
            filterStyle = sp.filter.HIGH_PASS;
        }

        const butterworth = sp.filter.createButterworth(
            state.filter.poles,
            filterStyle,
            state.filter.lowcut,
            state.filter.highcut,
            1 / seismogram.sampleRate
        );

        seismogram = sp.filter.applyFilter(butterworth, seismogram);

        console.log(`✅ Applied ${state.filter.type} filter`);

        return displayData.cloneWithNewSeismogram(seismogram);

    } catch (error) {
        console.error('Error applying filter:', error);
        return displayData;
    }
}

// Change time window
window.changeTimeWindow = function(stationCode, duration) {
    const station = state.stations.find(s => s.code === stationCode);
    if (!station) return;

    station.duration = duration;

    // Update button states
    const card = document.getElementById(`station-${stationCode}`);
    card.querySelectorAll('.time-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    card.querySelector(`[onclick="changeTimeWindow('${stationCode}', ${duration})"]`)?.classList.add('active');

    // Fetch new data
    fetchStationData(station);
};

// Fetch station data
async function fetchStationData(station) {
    try {
        const endTime = sp.luxon.DateTime.utc();
        const startTime = endTime.minus({ seconds: station.duration });

        const dsQuery = new sp.fdsndataselect.DataSelectQuery()
            .host(CONFIG.host)
            .networkCode(station.network)
            .stationCode(station.code)
            .channelCode('??Z') // Vertical component
            .startTime(startTime)
            .endTime(endTime)
            .nodata(404);

        console.log(`Fetching data for ${station.code}...`);

        const dataRecords = await dsQuery.queryDataRecords();

        if (dataRecords && dataRecords.length > 0) {
            const seismograms = sp.miniseed.seismogramPerChannel(dataRecords);
            if (seismograms.length > 0) {
                displaySeismograph(station, seismograms[0]);
            }
        } else {
            showNoData(station.code);
        }

    } catch (error) {
        console.error(`Error fetching data for ${station.code}:`, error);
        showNoData(station.code);
    }
}

// Display seismograph
function displaySeismograph(station, seismogram) {
    const container = document.getElementById(`seismo-${station.code}`);
    if (!container) return;

    container.innerHTML = '';

    // Update metadata
    document.getElementById(`start-${station.code}`).textContent =
        seismogram.startTime.toFormat('HH:mm:ss');
    document.getElementById(`end-${station.code}`).textContent =
        seismogram.endTime.toFormat('HH:mm:ss');
    document.getElementById(`rate-${station.code}`).textContent =
        `${seismogram.sampleRate} Hz`;

    let totalSamples = 0;
    seismogram.segments.forEach(seg => totalSamples += seg.y.length);
    document.getElementById(`samples-${station.code}`).textContent =
        totalSamples.toLocaleString();

    // Create seismograph config
    const config = new sp.seismographconfig.SeismographConfig();
    config.title = `${seismogram.codes()}`;
    config.xLabel = null; // Hide x-label for cleaner look
    config.yLabel = 'Counts';
    config.doGain = false;

    // Wrap in display data
    let displayData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seismogram);

    // Apply filter if configured
    displayData = applyFilter(displayData);

    // Create seismograph
    const seismograph = new sp.seismograph.Seismograph([displayData], config);
    container.appendChild(seismograph);
}

// Show no data
function showNoData(stationCode) {
    const container = document.getElementById(`seismo-${stationCode}`);
    if (container) {
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 200px; color: #7a8ca0;">
                <p>No data available</p>
            </div>
        `;
    }
}

// Start live updates
function startLiveUpdates() {
    // Update all stations every 30 seconds
    state.updateInterval = setInterval(() => {
        console.log('Updating all stations...');
        state.stations.forEach(station => {
            fetchStationData(station);
        });
    }, CONFIG.updateInterval);

    console.log(`Live updates started (every ${CONFIG.updateInterval/1000}s)`);
}

// Cleanup
window.addEventListener('beforeunload', () => {
    if (state.updateInterval) {
        clearInterval(state.updateInterval);
    }
});

// Initialize on load
window.addEventListener('DOMContentLoaded', init);
