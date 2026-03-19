// Import seisplotjs
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

// Configuration
const CONFIG = {
    host: 'eida.koeri.boun.edu.tr',
    protocol: 'https:',
    network: 'KO',
    updateInterval: 30000,
    helicorderHours: 6, // Start with 6 hours for better performance
};

// State
const state = {
    stations: [],
    selectedStation: null,
    currentView: 'waveforms',
    isMonitoring: false,
    intervalId: null,
    map: null,
    seismographs: [],
    helicorderDuration: 6, // hours
};

// Initialize
async function init() {
    console.log('Initializing Professional Dashboard...');

    await loadStations();
    setupEventListeners();
    initializeMap();
    setupTabs();
    setupViewTabs();

    console.log('Dashboard ready!');
}

// Load stations
async function loadStations() {
    try {
        const url = `${CONFIG.protocol}//${CONFIG.host}/fdsnws/station/1/query?network=${CONFIG.network}&level=station&format=text`;
        const response = await fetch(url);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const text = await response.text();
        parseStations(text);
        renderStationList(state.stations);
        addStationsToMap(state.stations);

    } catch (error) {
        console.error('Error loading stations:', error);
        document.getElementById('stationList').innerHTML = `
            <div style="padding: 20px; text-align: center; color: #ef4444;">
                <p>Failed to load stations</p>
                <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
            </div>
        `;
    }
}

// Parse stations
function parseStations(text) {
    const lines = text.trim().split('\n');
    state.stations = [];

    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split('|');
        if (parts.length >= 7) {
            state.stations.push({
                network: parts[0].trim(),
                code: parts[1].trim(),
                latitude: parseFloat(parts[2].trim()),
                longitude: parseFloat(parts[3].trim()),
                elevation: parseFloat(parts[4].trim()),
                siteName: parts[5].trim(),
                startTime: parts[6].trim(),
                endTime: parts[7] ? parts[7].trim() : 'Present',
            });
        }
    }

    console.log(`Loaded ${state.stations.length} stations`);
}

// Render station list
function renderStationList(stations) {
    const listEl = document.getElementById('stationList');

    if (stations.length === 0) {
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #7a8ca0;">No stations found</div>';
        return;
    }

    listEl.innerHTML = stations.map(station => `
        <div class="station-item" data-station="${station.code}">
            <div class="station-code">${station.code}</div>
            <div class="station-location">${station.siteName}</div>
        </div>
    `).join('');

    listEl.querySelectorAll('.station-item').forEach(item => {
        item.addEventListener('click', () => {
            selectStation(item.dataset.station);
        });
    });
}

// Initialize map
function initializeMap() {
    const mapEl = document.getElementById('map');
    state.map = L.map(mapEl).setView([39.0, 35.0], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
    }).addTo(state.map);
}

// Add stations to map
function addStationsToMap(stations) {
    if (!state.map) return;

    stations.forEach(station => {
        const marker = L.marker([station.latitude, station.longitude])
            .addTo(state.map)
            .bindPopup(`
                <b>${station.code}</b><br>
                ${station.siteName}<br>
                Elevation: ${station.elevation}m
            `);

        marker.on('click', () => {
            selectStation(station.code);
            // Switch to stations tab
            document.querySelector('[data-tab="stations"]').click();
        });
    });
}

// Select station
function selectStation(stationCode) {
    const station = state.stations.find(s => s.code === stationCode);
    if (!station) return;

    state.selectedStation = station;

    // Update UI
    document.querySelectorAll('.station-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.querySelector(`[data-station="${stationCode}"]`)?.classList.add('selected');

    // Display based on current view
    displayCurrentView();

    // If monitoring, fetch data
    if (state.isMonitoring) {
        fetchDataForCurrentView();
    }
}

// Display current view
function displayCurrentView() {
    if (!state.selectedStation) return;

    switch (state.currentView) {
        case 'waveforms':
            displayWaveforms();
            break;
        case 'helicorder':
            displayHelicorderPanel();
            break;
        case 'particle':
            displayParticleMotion();
            break;
        case 'spectra':
            displaySpectra();
            break;
    }
}

// Display 3-component waveforms
function displayWaveforms() {
    const panel = document.getElementById('waveforms-panel');
    const station = state.selectedStation;

    panel.innerHTML = `
        <div class="seismograph-container">
            <div class="seismograph-header">
                <div>
                    <div class="seismograph-title">${station.code} - 3-Component Seismograms</div>
                    <div style="font-size: 12px; color: #7a8ca0; margin-top: 5px;">${station.siteName}</div>
                </div>
                <div class="time-controls">
                    <button class="time-btn active" data-duration="600">10 min</button>
                    <button class="time-btn" data-duration="1800">30 min</button>
                    <button class="time-btn" data-duration="3600">1 hour</button>
                </div>
            </div>
            <div class="channel-grid">
                <div class="channel-card">
                    <div class="channel-label">East-West (E)</div>
                    <div id="seismograph-e" class="seismograph-canvas"></div>
                </div>
                <div class="channel-card">
                    <div class="channel-label">North-South (N)</div>
                    <div id="seismograph-n" class="seismograph-canvas"></div>
                </div>
                <div class="channel-card">
                    <div class="channel-label">Vertical (Z)</div>
                    <div id="seismograph-z" class="seismograph-canvas"></div>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for time controls
    panel.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            panel.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (state.isMonitoring) {
                fetchWaveformData(parseInt(btn.dataset.duration));
            }
        });
    });

    if (state.isMonitoring) {
        fetchWaveformData(600);
    }
}

// Fetch waveform data for all 3 components
async function fetchWaveformData(duration = 600) {
    const station = state.selectedStation;
    if (!station) return;

    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: duration });

    // Fetch all components: E, N, Z
    const components = ['E', 'N', 'Z'];

    for (const comp of components) {
        try {
            const dsQuery = new sp.fdsndataselect.DataSelectQuery()
                .host(CONFIG.host)
                .networkCode(CONFIG.network)
                .stationCode(station.code)
                .channelCode(`??${comp}`)
                .startTime(startTime)
                .endTime(endTime)
                .nodata(404);

            console.log(`Fetching ${comp} component for ${station.code}...`);

            const dataRecords = await dsQuery.queryDataRecords();

            if (dataRecords && dataRecords.length > 0) {
                const seismograms = sp.miniseed.seismogramPerChannel(dataRecords);
                if (seismograms.length > 0) {
                    displaySeismograph(seismograms[0], comp.toLowerCase());
                }
            } else {
                showNoData(comp.toLowerCase());
            }

        } catch (error) {
            console.error(`Error fetching ${comp} component:`, error);
            showNoData(comp.toLowerCase());
        }
    }
}

// Display seismograph using seisplotjs
function displaySeismograph(seismogram, component) {
    const container = document.getElementById(`seismograph-${component}`);
    if (!container) return;

    container.innerHTML = '';

    // Create seismograph config
    const config = new sp.seismographconfig.SeismographConfig();
    config.title = `${seismogram.codes()} - ${component.toUpperCase()}`;
    config.xLabel = 'Time';
    config.yLabel = 'Amplitude';

    // Wrap seismogram in SeismogramDisplayData
    const displayData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seismogram);

    // Create seismograph
    const seismograph = new sp.seismograph.Seismograph([displayData], config);
    container.appendChild(seismograph);
}

// Show no data message
function showNoData(component) {
    const container = document.getElementById(`seismograph-${component}`);
    if (container) {
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 200px; color: #7a8ca0;">
                <p>No data available for ${component.toUpperCase()} component</p>
            </div>
        `;
    }
}

// Display helicorder panel
function displayHelicorderPanel() {
    const panel = document.getElementById('helicorder-panel');
    const station = state.selectedStation;

    panel.innerHTML = `
        <div class="seismograph-container">
            <div class="seismograph-header">
                <div>
                    <div class="seismograph-title">${station.code} - Helicorder</div>
                    <div style="font-size: 12px; color: #7a8ca0; margin-top: 5px;">${station.siteName}</div>
                </div>
                <div class="time-controls">
                    <button class="time-btn" data-hours="1">1 hour</button>
                    <button class="time-btn active" data-hours="6">6 hours</button>
                    <button class="time-btn" data-hours="12">12 hours</button>
                    <button class="time-btn" data-hours="24">24 hours</button>
                </div>
            </div>
            <div id="helicorder-display" style="padding: 20px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading helicorder data...</p>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for time controls
    panel.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            panel.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.helicorderDuration = parseInt(btn.dataset.hours);
            fetchHelicorderData();
        });
    });

    fetchHelicorderData();
}

// Fetch helicorder data
async function fetchHelicorderData() {
    const station = state.selectedStation;
    if (!station) return;

    const hours = state.helicorderDuration;
    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ hours });

    try {
        const dsQuery = new sp.fdsndataselect.DataSelectQuery()
            .host(CONFIG.host)
            .networkCode(CONFIG.network)
            .stationCode(station.code)
            .channelCode('??Z')
            .startTime(startTime)
            .endTime(endTime)
            .nodata(404);

        console.log(`Fetching ${hours}hour helicorder data for ${station.code}...`);

        const dataRecords = await dsQuery.queryDataRecords();

        if (dataRecords && dataRecords.length > 0) {
            const seismograms = sp.miniseed.seismogramPerChannel(dataRecords);
            if (seismograms.length > 0) {
                displayHelicorder(seismograms[0], hours);
            } else {
                showHelicorderError('No seismograms created from data');
            }
        } else {
            showHelicorderError('No data available');
        }

    } catch (error) {
        console.error('Error fetching helicorder data:', error);
        showHelicorderError(error.message);
    }
}

// Display helicorder
function displayHelicorder(seismogram, hours) {
    const container = document.getElementById('helicorder-display');
    if (!container) return;

    try {
        container.innerHTML = '';

        const endTime = seismogram.endTime;
        const startTime = endTime.minus({ hours });
        const fixedTimeScale = new sp.util.StartEndDuration(startTime, endTime);

        const config = new sp.helicorder.HelicorderConfig(fixedTimeScale);
        config.timeWindow = sp.luxon.Duration.fromObject({ minutes: hours * 60 / Math.min(hours * 2, 24) });
        config.overlap = sp.luxon.Duration.fromObject({ seconds: 0 });

        const helicorder = sp.helicorder.createHelicorder(config, [seismogram]);
        container.appendChild(helicorder);

        console.log(`Helicorder displayed for ${hours} hours`);

    } catch (error) {
        console.error('Error displaying helicorder:', error);
        showHelicorderError(error.message);
    }
}

// Show helicorder error
function showHelicorderError(message) {
    const container = document.getElementById('helicorder-display');
    if (container) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <p>Error loading helicorder</p>
                <p style="font-size: 12px; margin-top: 10px;">${message}</p>
            </div>
        `;
    }
}

// Display particle motion
function displayParticleMotion() {
    const panel = document.getElementById('particle-panel');
    panel.innerHTML = `
        <div class="particle-motion-container">
            <div class="seismograph-header">
                <div class="seismograph-title">${state.selectedStation.code} - Particle Motion</div>
            </div>
            <div id="particle-display" style="padding: 20px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading 3-component data...</p>
                </div>
            </div>
        </div>
    `;

    if (state.isMonitoring) {
        fetchParticleMotionData();
    }
}

// Fetch particle motion data
async function fetchParticleMotionData() {
    const station = state.selectedStation;
    if (!station) return;

    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: 600 });

    try {
        // Fetch E, N, Z components
        const promises = ['E', 'N', 'Z'].map(comp => {
            const dsQuery = new sp.fdsndataselect.DataSelectQuery()
                .host(CONFIG.host)
                .networkCode(CONFIG.network)
                .stationCode(station.code)
                .channelCode(`??${comp}`)
                .startTime(startTime)
                .endTime(endTime)
                .nodata(404);

            return dsQuery.queryDataRecords()
                .then(records => sp.miniseed.seismogramPerChannel(records))
                .then(seismograms => seismograms[0])
                .catch(() => null);
        });

        const [seisE, seisN, seisZ] = await Promise.all(promises);

        if (seisE && seisN && seisZ) {
            displayParticleMotionPlot(seisE, seisN, seisZ);
        } else {
            const container = document.getElementById('particle-display');
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #7a8ca0;">
                    <p>Need all 3 components (E, N, Z) for particle motion</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Error fetching particle motion data:', error);
    }
}

// Display particle motion plot
function displayParticleMotionPlot(seisE, seisN, seisZ) {
    const container = document.getElementById('particle-display');
    container.innerHTML = '';

    // Create seismograph config for particle motion
    const config = new sp.seismographconfig.SeismographConfig();

    const particleMotion = new sp.particlemotion.ParticleMotion(seisE, seisN, seisZ, config);
    container.appendChild(particleMotion);
}

// Display spectra
function displaySpectra() {
    const panel = document.getElementById('spectra-panel');
    panel.innerHTML = `
        <div class="spectra-container">
            <div class="seismograph-header">
                <div class="seismograph-title">${state.selectedStation.code} - Frequency Spectra</div>
            </div>
            <div id="spectra-display" style="padding: 20px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Computing FFT...</p>
                </div>
            </div>
        </div>
    `;

    if (state.isMonitoring) {
        fetchSpectraData();
    }
}

// Fetch spectra data
async function fetchSpectraData() {
    const station = state.selectedStation;
    if (!station) return;

    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: 600 });

    try {
        const dsQuery = new sp.fdsndataselect.DataSelectQuery()
            .host(CONFIG.host)
            .networkCode(CONFIG.network)
            .stationCode(station.code)
            .channelCode('??Z')
            .startTime(startTime)
            .endTime(endTime)
            .nodata(404);

        const dataRecords = await dsQuery.queryDataRecords();

        if (dataRecords && dataRecords.length > 0) {
            const seismograms = sp.miniseed.seismogramPerChannel(dataRecords);
            if (seismograms.length > 0) {
                displaySpectraPlot(seismograms[0]);
            }
        }

    } catch (error) {
        console.error('Error fetching spectra data:', error);
    }
}

// Display spectra plot
function displaySpectraPlot(seismogram) {
    const container = document.getElementById('spectra-display');
    container.innerHTML = '';

    try {
        // Get samples from seismogram segments
        const samples = [];
        seismogram.segments.forEach(seg => {
            samples.push(...seg.y);
        });

        // Compute FFT
        const fftResult = sp.fft.fftForward(samples);

        // Create spectra plot
        const spectraPlot = new sp.spectraplot.SpectraPlot(fftResult, seismogram.sampleRate);
        container.appendChild(spectraPlot);
    } catch (error) {
        console.error('Error creating spectra plot:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <p>Error creating spectra plot</p>
                <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
            </div>
        `;
    }
}

// Fetch data for current view
function fetchDataForCurrentView() {
    switch (state.currentView) {
        case 'waveforms':
            const activeBtn = document.querySelector('#waveforms-panel .time-btn.active');
            const duration = activeBtn ? parseInt(activeBtn.dataset.duration) : 600;
            fetchWaveformData(duration);
            break;
        case 'helicorder':
            fetchHelicorderData();
            break;
        case 'particle':
            fetchParticleMotionData();
            break;
        case 'spectra':
            fetchSpectraData();
            break;
    }
}

// Setup tabs
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');

            if (tabName === 'map' && state.map) {
                setTimeout(() => state.map.invalidateSize(), 100);
            }
        });
    });
}

// Setup view tabs
function setupViewTabs() {
    document.querySelectorAll('.view-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;
            state.currentView = viewName;

            document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`${viewName}-panel`).classList.add('active');

            displayCurrentView();
        });
    });
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('startBtn').addEventListener('click', startMonitoring);
    document.getElementById('stopBtn').addEventListener('click', stopMonitoring);

    document.getElementById('searchInput').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = state.stations.filter(s =>
            s.code.toLowerCase().includes(query) ||
            s.siteName.toLowerCase().includes(query)
        );
        renderStationList(filtered);
    });
}

// Start monitoring
function startMonitoring() {
    if (state.isMonitoring) return;

    state.isMonitoring = true;

    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('statusDot').classList.add('active');
    document.getElementById('statusText').textContent = 'Monitoring';

    console.log('Started monitoring');

    if (state.selectedStation) {
        fetchDataForCurrentView();

        // Set up interval for continuous updates (only for waveforms)
        if (state.currentView === 'waveforms') {
            state.intervalId = setInterval(() => {
                if (state.selectedStation && state.currentView === 'waveforms') {
                    const activeBtn = document.querySelector('#waveforms-panel .time-btn.active');
                    const duration = activeBtn ? parseInt(activeBtn.dataset.duration) : 600;
                    fetchWaveformData(duration);
                }
            }, CONFIG.updateInterval);
        }
    }
}

// Stop monitoring
function stopMonitoring() {
    if (!state.isMonitoring) return;

    state.isMonitoring = false;

    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
    }

    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('statusDot').classList.remove('active');
    document.getElementById('statusText').textContent = 'Stopped';

    console.log('Stopped monitoring');
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', stopMonitoring);
