// Import seisplotjs
import * as sp from './seisplotjs/docs/seisplotjs_3.1.5-SNAPSHOT_standalone.mjs';

// Configuration
const CONFIG = {
    host: window.location.hostname,
    protocol: window.location.protocol,
    port: null, // set to 18081 for CAPS FDSNWS (3-4x faster), null for default (8081)
    networks: ['AU', '2O', 'AM', 'YC', 'M8', '3B', 'YW'],
    updateInterval: 30000,
    helicorderHours: 6,
};

// Parse URL params for config overrides (e.g. ?port=18002&events=true)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('port')) {
    CONFIG.port = parseInt(urlParams.get('port'));
}

// Helper: configure a DataSelectQuery with host/port
function configureQuery(query) {
    query.host(CONFIG.host);
    if (CONFIG.port) {
        query.port(CONFIG.port);
    }
    return query;
}

// Event loading config
const EVENT_CONFIG = {
    enabled: urlParams.has('events') ? urlParams.get('events') === 'true' : true,
    minMagnitude: parseFloat(urlParams.get('minmag') || '3.0'),
    maxRadius: parseFloat(urlParams.get('maxradius') || '90'), // degrees
    // Australia center for regional events
    latitude: parseFloat(urlParams.get('lat') || '-25.0'),
    longitude: parseFloat(urlParams.get('lon') || '134.0'),
};

// State
const state = {
    stations: [],
    selectedStation: null,
    currentView: 'waveforms',
    isMonitoring: false,
    intervalId: null,
    seismographs: [],
    helicorderDuration: 6, // hours
    helicorderChannel: null, // selected channel code (e.g. 'SHZ'), null = auto-pick best Z
    filter: {
        type: 'none',  // 'none', 'bandpass', 'highpass', 'lowpass'
        lowcut: 1.0,
        highcut: 10.0,
        poles: 2
    },
    events: [], // cached earthquake events
    spectraSeismograms: [], // cached seismograms for spectra toggle
    spectrogramDuration: 600, // seconds
    spectrogramChannel: null, // selected channel, null = auto
};

// Initialize
async function init() {
    console.log('Initializing Professional Dashboard...');

    await loadStations();
    setupEventListeners();
    setupViewTabs();
    setupEventToggle();

    // If events enabled, fetch them on startup
    if (EVENT_CONFIG.enabled) {
        fetchEvents();
    }

    console.log('Dashboard ready!');
}

// Fetch earthquake events from USGS FDSN event service
async function fetchEvents() {
    try {
        const endTime = sp.luxon.DateTime.utc();
        const startTime = endTime.minus({ hours: 24 });

        const eventQuery = new sp.fdsnevent.EventQuery()
            .startTime(startTime)
            .endTime(endTime)
            .minMag(EVENT_CONFIG.minMagnitude)
            .latitude(EVENT_CONFIG.latitude)
            .longitude(EVENT_CONFIG.longitude)
            .maxRadius(EVENT_CONFIG.maxRadius);

        const quakeml = await eventQuery.query();
        state.events = quakeml;
        console.log(`Loaded ${state.events.length} events (M${EVENT_CONFIG.minMagnitude}+ within ${EVENT_CONFIG.maxRadius}deg)`);

        // Update toggle badge
        const badge = document.getElementById('event-count-badge');
        if (badge) {
            badge.textContent = state.events.length > 0 ? state.events.length : '';
            badge.style.display = state.events.length > 0 ? 'inline' : 'none';
        }

        return state.events;
    } catch (error) {
        console.warn('Event loading failed:', error.message);
        state.events = [];
        return [];
    }
}

// Setup event toggle in header
function setupEventToggle() {
    const headerControls = document.querySelector('.header-controls');
    if (!headerControls) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; display: flex; align-items: center; gap: 0;';

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'eventToggleBtn';
    toggleBtn.className = 'status-badge';
    toggleBtn.style.cssText = 'cursor: pointer; border: none; border-radius: 20px 0 0 20px; padding-right: 8px;';
    toggleBtn.innerHTML = `
        <span style="font-size: 13px;">Events</span>
        <span id="event-count-badge" style="background: #ef4444; color: white; border-radius: 10px; padding: 1px 6px; font-size: 11px; display: none;"></span>
    `;

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'status-badge';
    settingsBtn.style.cssText = 'cursor: pointer; border: none; border-radius: 0 20px 20px 0; padding: 5px 8px; border-left: 1px solid rgba(255,255,255,0.2); font-size: 10px;';
    settingsBtn.textContent = '▼';

    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'display: none; position: absolute; top: 100%; right: 0; margin-top: 6px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; padding: 12px; z-index: 200; min-width: 220px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
    dropdown.innerHTML = `
        <div style="font-size: 12px; color: var(--text); margin-bottom: 8px; font-weight: 600;">Event Settings</div>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
            <span>Min Mag:</span>
            <select id="event-min-mag" style="background: var(--bg-input); color: var(--text); border: 1px solid var(--border); padding: 3px 6px; border-radius: 4px; font-size: 12px;">
                <option value="2" ${EVENT_CONFIG.minMagnitude === 2 ? 'selected' : ''}>M2+</option>
                <option value="3" ${EVENT_CONFIG.minMagnitude === 3 ? 'selected' : ''}>M3+</option>
                <option value="4" ${EVENT_CONFIG.minMagnitude === 4 ? 'selected' : ''}>M4+</option>
                <option value="5" ${EVENT_CONFIG.minMagnitude === 5 ? 'selected' : ''}>M5+</option>
                <option value="6" ${EVENT_CONFIG.minMagnitude === 6 ? 'selected' : ''}>M6+</option>
            </select>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">
            <span>Radius:</span>
            <select id="event-max-radius" style="background: var(--bg-input); color: var(--text); border: 1px solid var(--border); padding: 3px 6px; border-radius: 4px; font-size: 12px;">
                <option value="10" ${EVENT_CONFIG.maxRadius === 10 ? 'selected' : ''}>10°</option>
                <option value="20" ${EVENT_CONFIG.maxRadius === 20 ? 'selected' : ''}>20°</option>
                <option value="45" ${EVENT_CONFIG.maxRadius === 45 ? 'selected' : ''}>45°</option>
                <option value="90" ${EVENT_CONFIG.maxRadius === 90 ? 'selected' : ''}>90°</option>
                <option value="180" ${EVENT_CONFIG.maxRadius === 180 ? 'selected' : ''}>180° (global)</option>
            </select>
        </label>
        <button id="event-refresh-btn" style="width: 100%; padding: 5px; background: var(--accent); color: #fff; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">Refresh Events</button>
    `;

    if (EVENT_CONFIG.enabled) {
        toggleBtn.style.background = 'rgba(74, 158, 255, 0.3)';
        settingsBtn.style.background = 'rgba(74, 158, 255, 0.3)';
    }

    const updateEventBtnStyle = () => {
        const bg = EVENT_CONFIG.enabled ? 'rgba(74, 158, 255, 0.3)' : 'rgba(255,255,255,0.1)';
        toggleBtn.style.background = bg;
        settingsBtn.style.background = bg;
        toggleBtn.querySelector('span').style.textDecoration = EVENT_CONFIG.enabled ? 'none' : 'line-through';
    };

    toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        EVENT_CONFIG.enabled = !EVENT_CONFIG.enabled;
        updateEventBtnStyle();

        if (EVENT_CONFIG.enabled && state.events.length === 0) {
            await fetchEvents();
        }

        if (state.isMonitoring && state.selectedStation) {
            fetchDataForCurrentView();
        }
    });

    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
    });

    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(settingsBtn);
    wrapper.appendChild(dropdown);

    const startBtn = document.getElementById('startBtn');
    headerControls.insertBefore(wrapper, startBtn);

    // Wire up dropdown controls after they're in the DOM
    setTimeout(() => {
        document.getElementById('event-min-mag')?.addEventListener('change', (e) => {
            EVENT_CONFIG.minMagnitude = parseFloat(e.target.value);
        });
        document.getElementById('event-max-radius')?.addEventListener('change', (e) => {
            EVENT_CONFIG.maxRadius = parseFloat(e.target.value);
        });
        document.getElementById('event-refresh-btn')?.addEventListener('click', async () => {
            dropdown.style.display = 'none';
            EVENT_CONFIG.enabled = true;
            updateEventBtnStyle();
            await fetchEvents();
            if (state.isMonitoring && state.selectedStation) {
                fetchDataForCurrentView();
            }
        });
    }, 0);
}

// Load stations
async function loadStations() {
    try {
        // Fetch stations for all networks in parallel
        const fetches = CONFIG.networks.map(async (net) => {
            try {
                const portStr = CONFIG.port ? `:${CONFIG.port}` : '';
                const url = `${CONFIG.protocol}//${CONFIG.host}${portStr}/fdsnws/station/1/query?network=${net}&level=station&format=text`;
                const response = await fetch(url);
                if (!response.ok) return '';
                return await response.text();
            } catch (e) {
                console.warn(`Failed to load network ${net}:`, e.message);
                return '';
            }
        });
        const results = await Promise.all(fetches);
        const combinedText = results.filter(t => t).join('\n');
        parseStations(combinedText);
        renderStationList(state.stations);

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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip header lines (start with #) and empty lines
        if (!line || line.startsWith('#') || line.startsWith('Network')) continue;
        const parts = line.split('|');
        if (parts.length >= 7) {
            const stationCode = parts[1].trim();
            // Skip infrasound (I0x*) and hydroacoustic (H0x*) IMS stations
            if (/^[IH]\d{2}/.test(stationCode)) continue;
            state.stations.push({
                network: parts[0].trim(),
                code: stationCode,
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
        <div class="station-item" data-station="${station.network}.${station.code}">
            <div class="station-code">${station.network}.${station.code}</div>
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

// Select station
function selectStation(stationCode) {
    // stationCode can be "NET.STA" or just "STA"
    const station = stationCode.includes('.')
        ? state.stations.find(s => `${s.network}.${s.code}` === stationCode)
        : state.stations.find(s => s.code === stationCode);
    if (!station) return;

    state.selectedStation = station;
    state.helicorderChannel = null; // reset channel selection for new station

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
    // Health summary doesn't need a selected station
    if (state.currentView === 'health') {
        displayHealthSummary();
        return;
    }
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
        case 'spectrogram':
            displaySpectrogram();
            break;
    }
}

// Display 3-component waveforms using sp-organized-display
function displayWaveforms() {
    const panel = document.getElementById('waveforms-panel');
    const station = state.selectedStation;

    panel.innerHTML = `
        <div class="seismograph-container">
            <div class="seismograph-header">
                <div>
                    <div class="seismograph-title">${station.code} - 3-Component Seismograms</div>
                    <div id="waveform-subtitle" style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">${station.siteName} (linked zoom/pan)</div>
                </div>
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <div class="time-controls">
                        <button class="time-btn active" data-duration="600">10 min</button>
                        <button class="time-btn" data-duration="1800">30 min</button>
                        <button class="time-btn" data-duration="3600">1 hour</button>
                        <button class="time-btn" data-duration="21600">6 hours</button>
                        <button class="time-btn" data-duration="43200">12 hours</button>
                        <button class="time-btn" data-duration="86400">24 hours</button>
                    </div>
                    <div style="display: flex; gap: 15px; align-items: center; border-left: 1px solid var(--border); padding-left: 20px;">
                        <label style="color: var(--text-secondary); font-size: 12px; display: flex; align-items: center; gap: 8px;">
                            <span>Filter:</span>
                            <select id="wave-filter-type" style="background: var(--bg-input); color: var(--text); border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                <option value="none">None</option>
                                <option value="bandpass">Bandpass</option>
                                <option value="highpass">Highpass</option>
                                <option value="lowpass">Lowpass</option>
                            </select>
                        </label>
                        <label id="wave-filter-preset" style="color: var(--text-secondary); font-size: 12px; display: none; align-items: center; gap: 8px;">
                            <span>Preset:</span>
                            <select id="wave-filter-preset-select" style="background: var(--bg-input); color: var(--text); border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                <option value="1-10">1-10 Hz</option>
                                <option value="2-5">2-5 Hz</option>
                                <option value="0.5-15">0.5-15 Hz</option>
                                <option value="custom">Custom</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>
            <details style="margin: 10px 0; padding: 10px 15px; background: var(--bg-input); border-radius: 6px; border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                <summary style="cursor: pointer; font-weight: 600; color: var(--text); font-size: 13px;">About this view</summary>
                <div style="margin-top: 8px;">
                    <p style="margin: 0 0 8px;">Shows real-time 3-component (E/N/Z or 1/2/Z) seismograms for the selected station with linked zoom and pan. All components share the same time axis so you can compare arrivals across channels.</p>
                    <p style="margin: 0 0 8px;"><strong>Time window</strong> — Choose 10 min, 30 min, or 1 hour of recent data. Data refreshes automatically while monitoring is active.</p>
                    <p style="margin: 0 0 8px;"><strong>Filters</strong> — Apply bandpass, highpass, or lowpass filters. Presets offer common ranges (e.g. 1-10 Hz for local/regional events). Filters are applied client-side after data is fetched.</p>
                    <p style="margin: 0 0 8px;"><strong>QC indicators</strong> — The subtitle bar shows per-channel: sample rate, data latency (green &lt;2m, orange 2-10m, red &gt;10m), gap count, and RMS noise level (raw counts).</p>
                    <p style="margin: 0;"><strong>Interaction</strong> — Mouse wheel to zoom, click-drag to pan. All three components move together.</p>
                </div>
            </details>
            <div id="organized-display-container" style="min-height: 600px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading 3-component data...</p>
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

    // Add event listeners for filter controls
    const waveFilterTypeSelect = document.getElementById('wave-filter-type');
    const waveFilterPresetLabel = document.getElementById('wave-filter-preset');
    const waveFilterPresetSelect = document.getElementById('wave-filter-preset-select');

    waveFilterTypeSelect.addEventListener('change', () => {
        const filterType = waveFilterTypeSelect.value;
        state.filter.type = filterType;

        if (filterType === 'none') {
            waveFilterPresetLabel.style.display = 'none';
        } else {
            waveFilterPresetLabel.style.display = 'flex';
            if (filterType === 'bandpass') {
                waveFilterPresetSelect.innerHTML = `
                    <option value="1-10">1-10 Hz</option>
                    <option value="2-5">2-5 Hz</option>
                    <option value="0.5-15">0.5-15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'highpass') {
                waveFilterPresetSelect.innerHTML = `
                    <option value="0.5">0.5 Hz</option>
                    <option value="1">1 Hz</option>
                    <option value="2">2 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'lowpass') {
                waveFilterPresetSelect.innerHTML = `
                    <option value="5">5 Hz</option>
                    <option value="10">10 Hz</option>
                    <option value="15">15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            }
            updateFilterFromPreset(waveFilterPresetSelect.value);
        }

        if (state.isMonitoring) {
            const activeBtn = document.querySelector('#waveforms-panel .time-btn.active');
            const duration = activeBtn ? parseInt(activeBtn.dataset.duration) : 600;
            fetchWaveformData(duration);
        }
    });

    waveFilterPresetSelect.addEventListener('change', () => {
        updateFilterFromPreset(waveFilterPresetSelect.value);

        if (state.isMonitoring) {
            const activeBtn = document.querySelector('#waveforms-panel .time-btn.active');
            const duration = activeBtn ? parseInt(activeBtn.dataset.duration) : 600;
            fetchWaveformData(duration);
        }
    });

    if (state.isMonitoring) {
        fetchWaveformData(600);
    }
}

// Fetch all 3 components in parallel and display with sp-organized-display
async function fetchWaveformData(duration = 600) {
    const station = state.selectedStation;
    if (!station) return;

    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: duration });

    try {
        // Fetch E/1, N/2, Z in parallel (some stations use 1,2 instead of E,N)
        const components = ['E', 'N', 'Z', '1', '2'];
        const promises = components.map(comp => {
            const dsQuery = configureQuery(new sp.fdsndataselect.DataSelectQuery())
                .networkCode(station.network)
                .stationCode(station.code)
                .channelCode(`??${comp}`)
                .startTime(startTime)
                .endTime(endTime)
                .nodata(404);

            return dsQuery.queryDataRecords()
                .then(records => {
                    if (records && records.length > 0) {
                        return sp.miniseed.seismogramPerChannel(records);
                    }
                    return [];
                })
                .catch(err => {
                    console.warn(`Failed to fetch ${comp}:`, err.message);
                    return [];
                });
        });

        const allSeismograms = (await Promise.all(promises)).flat();

        // Group by band code, then pick best complete 3-component group
        const bandGroups = {};
        for (const seis of allSeismograms) {
            const band = seis.channelCode.substring(0, 2);
            if (!bandGroups[band]) bandGroups[band] = {};
            const orient = seis.channelCode.charAt(2);
            if (orient === 'Z') bandGroups[band].Z = seis;
            else if (orient === 'E' || orient === '1') bandGroups[band].H1 = seis;
            else if (orient === 'N' || orient === '2') bandGroups[band].H2 = seis;
        }
        const bandPri = {'BH': 5, 'HH': 4, 'SH': 3, 'EH': 2.5, 'BN': 2, 'HN': 1, 'EN': 0.5};
        // Pick best band with all 3 components
        let bestBand = null, bestPri = -1;
        for (const [band, group] of Object.entries(bandGroups)) {
            const pri = bandPri[band] || 0;
            if (group.H1 && group.H2 && group.Z && pri > bestPri) {
                bestPri = pri;
                bestBand = band;
            }
        }
        let validSeismograms;
        if (bestBand) {
            const g = bandGroups[bestBand];
            validSeismograms = [g.H1, g.H2, g.Z].filter(Boolean);
        } else {
            // Fallback: pick best available per orientation within same instrument type
            const velocityBands = ['BH', 'HH', 'SH', 'EH'];
            const accelBands = ['BN', 'HN', 'EN'];
            let found = null;
            for (const bandSet of [velocityBands, accelBands]) {
                let h1 = null, h2 = null, z = null;
                for (const band of bandSet) {
                    const g = bandGroups[band];
                    if (!g) continue;
                    if (!h1 && g.H1) h1 = g.H1;
                    if (!h2 && g.H2) h2 = g.H2;
                    if (!z && g.Z) z = g.Z;
                }
                const parts = [h1, h2, z].filter(Boolean);
                if (parts.length > 0) { found = parts; break; }
            }
            validSeismograms = found || [];
        }

        if (validSeismograms.length === 0) {
            const container = document.getElementById('organized-display-container');
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    <p>No data available for ${station.code}</p>
                </div>
            `;
            return;
        }

        // Compute QC stats for each component
        const qcStats = validSeismograms.map(seis => {
            const latencyMs = sp.luxon.DateTime.utc().toMillis() - seis.endTime.toMillis();
            const latencySec = latencyMs / 1000;
            const gaps = seis.segments ? seis.segments.length - 1 : 0;
            // RMS: sqrt(mean(x^2)) after removing mean
            let rms = 0;
            if (seis.isContiguous && seis.isContiguous()) {
                const y = seis.y;
                const n = y.length;
                if (n > 0) {
                    let sum = 0, sumSq = 0;
                    for (let i = 0; i < n; i++) { sum += y[i]; }
                    const mean = sum / n;
                    for (let i = 0; i < n; i++) { sumSq += (y[i] - mean) ** 2; }
                    rms = Math.sqrt(sumSq / n);
                }
            } else if (seis.segments) {
                let totalSq = 0, totalN = 0;
                for (const seg of seis.segments) {
                    const y = seg.y;
                    const n = y.length;
                    let sum = 0;
                    for (let i = 0; i < n; i++) { sum += y[i]; }
                    const mean = sum / n;
                    for (let i = 0; i < n; i++) { totalSq += (y[i] - mean) ** 2; }
                    totalN += n;
                }
                if (totalN > 0) rms = Math.sqrt(totalSq / totalN);
            }
            return { channelCode: seis.channelCode, sampleRate: seis.sampleRate, latencySec, gaps, rms };
        });

        // Update subtitle with sample rate, latency, gaps, RMS
        const subtitle = document.getElementById('waveform-subtitle');
        if (subtitle) {
            const info = qcStats.map(q => {
                const latStr = q.latencySec < 60 ? `${q.latencySec.toFixed(0)}s`
                    : q.latencySec < 3600 ? `${(q.latencySec / 60).toFixed(1)}m`
                    : `${(q.latencySec / 3600).toFixed(1)}h`;
                const latColor = q.latencySec < 120 ? '#4caf50' : q.latencySec < 600 ? '#ff9800' : '#ef4444';
                const gapStr = q.gaps > 0 ? ` <span style="color: #ff9800;">${q.gaps} gap${q.gaps > 1 ? 's' : ''}</span>` : '';
                const rmsStr = q.rms > 0 ? ` RMS:${q.rms.toFixed(1)}` : '';
                return `${q.channelCode} ${q.sampleRate}sps <span style="color:${latColor};">lag:${latStr}</span>${gapStr}${rmsStr}`;
            }).join(' | ');
            subtitle.innerHTML = `${station.siteName} | ${info}`;
        }

        // Convert to SeismogramDisplayData and apply filters
        const displayDataList = validSeismograms.map(seis => {
            let sdd = sp.seismogram.SeismogramDisplayData.fromSeismogram(seis);
            sdd = applyFilter(sdd);
            return sdd;
        });

        // If events enabled, add event markers with location & origin time
        if (EVENT_CONFIG.enabled && state.events.length > 0 && station.latitude && station.longitude) {
            for (const quake of state.events) {
                try {
                    if (!quake.hasPreferredOrigin()) continue;
                    const mag = quake.hasPreferredMagnitude() ? `M${quake.preferredMagnitude.mag.toFixed(1)}` : 'M?';
                    const depthKm = (quake.depth / 1000).toFixed(0);
                    const loc = quake.description || `${quake.latitude.toFixed(1)}/${quake.longitude.toFixed(1)}`;
                    const distDeg = sp.distaz.distaz(
                        station.latitude, station.longitude,
                        quake.latitude, quake.longitude
                    ).delta;

                    // Origin time marker
                    const originMarker = {
                        markertype: 'predicted',
                        name: `${mag} ${loc}`,
                        time: quake.time,
                        description: `${quake.time.toFormat('HH:mm:ss')} ${depthKm}km ${distDeg.toFixed(1)}°`,
                    };

                    // P arrival marker (rough estimate: ~12 km/s for P at teleseismic)
                    // Use TauP for accuracy if available, otherwise skip
                    let pMarker = null;
                    try {
                        const ttQuery = new sp.traveltime.TraveltimeQuery()
                            .distdeg(distDeg)
                            .evdepth(quake.depth / 1000 || 10)
                            .phases('P,p,Pn');
                        const ttResult = await ttQuery.queryJson();
                        if (ttResult && ttResult.arrivals && ttResult.arrivals.length > 0) {
                            const firstP = ttResult.arrivals[0];
                            pMarker = {
                                markertype: 'predicted',
                                name: `${firstP.phase} ${mag}`,
                                time: quake.time.plus({ seconds: firstP.time }),
                                description: `${loc} ${distDeg.toFixed(1)}°`,
                            };
                        }
                    } catch (e) { /* travel time service unavailable, skip */ }

                    for (const sdd of displayDataList) {
                        if (sdd.timeRange.contains(originMarker.time)) {
                            sdd.markerList.push(originMarker);
                        }
                        if (pMarker && sdd.timeRange.contains(pMarker.time)) {
                            sdd.markerList.push(pMarker);
                        }
                    }
                } catch (err) {
                    console.warn('Event marker failed:', err.message);
                }
            }
        }

        // Create shared config with linked time and amplitude scales
        const seisConfig = new sp.seismographconfig.SeismographConfig();
        seisConfig.linkedTimeScale = new sp.scale.LinkedTimeScale();
        seisConfig.linkedAmplitudeScale = new sp.scale.LinkedAmplitudeScale();
        seisConfig.isRelativeTime = false;
        seisConfig.doRmean = true;

        // Create sp-organized-display element
        const container = document.getElementById('organized-display-container');
        container.innerHTML = '';

        const orgDisplay = document.createElement('sp-organized-display');
        orgDisplay.setAttribute('overlay', 'individual'); // one plot per component
        orgDisplay.setAttribute('tools', 'false');
        orgDisplay.seismographConfig = seisConfig;
        orgDisplay.seisData = displayDataList;

        container.appendChild(orgDisplay);

        console.log(`Organized display: ${displayDataList.length} components with linked zoom/pan`);

    } catch (error) {
        console.error('Error fetching waveform data:', error);
        const container = document.getElementById('organized-display-container');
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <p>Error loading waveform data</p>
                <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
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
                    <div id="heli-subtitle" style="font-size: 12px; color: #7a8ca0; margin-top: 5px;">${station.siteName}</div>
                </div>
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <span>Channel:</span>
                        <select id="heli-channel-select" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            <option value="">Loading...</option>
                        </select>
                    </label>
                    <div class="time-controls">
                        <button class="time-btn" data-hours="1">1 hour</button>
                        <button class="time-btn active" data-hours="6">6 hours</button>
                        <button class="time-btn" data-hours="12">12 hours</button>
                        <button class="time-btn" data-hours="24">24 hours</button>
                    </div>
                    <div style="display: flex; gap: 15px; align-items: center; border-left: 1px solid #2a3f5f; padding-left: 20px;">
                        <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                            <span>Filter:</span>
                            <select id="heli-filter-type" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                <option value="none">None</option>
                                <option value="bandpass">Bandpass</option>
                                <option value="highpass">Highpass</option>
                                <option value="lowpass">Lowpass</option>
                            </select>
                        </label>
                        <label id="heli-filter-preset" style="color: #7a8ca0; font-size: 12px; display: none; align-items: center; gap: 8px;">
                            <span>Preset:</span>
                            <select id="heli-filter-preset-select" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                <option value="1-10">1-10 Hz</option>
                                <option value="2-5">2-5 Hz</option>
                                <option value="0.5-15">0.5-15 Hz</option>
                                <option value="custom">Custom</option>
                            </select>
                        </label>
                    </div>
                    <div style="display: flex; gap: 15px; align-items: center; border-left: 1px solid #2a3f5f; padding-left: 20px;">
                        <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                            <span>Amplitude:</span>
                            <select id="heli-amp-mode" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                <option value="auto">Auto</option>
                                <option value="fixed">Fixed</option>
                                <option value="minmax">Min/Max</option>
                            </select>
                        </label>
                        <label id="heli-amp-value-label" style="color: #7a8ca0; font-size: 12px; display: none; align-items: center; gap: 8px;">
                            <span>Value:</span>
                            <input type="number" id="heli-amp-value" value="10000" step="1000" min="100"
                                style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; width: 100px; font-size: 12px;">
                        </label>
                    </div>
                </div>
            </div>
            <details style="margin: 10px 0; padding: 10px 15px; background: var(--bg-input); border-radius: 6px; border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                <summary style="cursor: pointer; font-weight: 600; color: var(--text); font-size: 13px;">About this view</summary>
                <div style="margin-top: 8px;">
                    <p style="margin: 0 0 8px;">A helicorder (drum recorder) display showing continuous waveform data stacked in horizontal lines, each representing a fixed time interval. The most recent data is at the bottom.</p>
                    <p style="margin: 0 0 8px;"><strong>Channel</strong> — Select which component to display (e.g. BHZ, HHZ, SHZ). Available channels depend on what the station provides.</p>
                    <p style="margin: 0 0 8px;"><strong>Duration</strong> — Choose how far back to display: 1, 6, 12, or 24 hours. Longer durations use fewer lines per hour to keep the display readable.</p>
                    <p style="margin: 0 0 8px;"><strong>Amplitude</strong> — <em>Auto</em> scales each line independently. <em>Fixed</em> uses a constant amplitude value (useful for comparing across time). <em>Min/Max</em> uses the full data range.</p>
                    <p style="margin: 0 0 8px;"><strong>Filters</strong> — Same as waveforms: bandpass, highpass, or lowpass with presets or custom values.</p>
                    <p style="margin: 0;"><strong>QC use</strong> — Look for changes in background noise level, sudden amplitude increases (events), data gaps (blank sections), or telemetry dropouts across the time window.</p>
                </div>
            </details>
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

    // Add event listener for channel selector
    const channelSelect = document.getElementById('heli-channel-select');
    channelSelect.addEventListener('change', () => {
        state.helicorderChannel = channelSelect.value || null;
        fetchHelicorderData();
    });
    // Populate channel dropdown from station metadata
    populateHelicorderChannels(station);

    // Add event listeners for amplitude controls
    const ampModeSelect = document.getElementById('heli-amp-mode');
    const ampValueLabel = document.getElementById('heli-amp-value-label');
    const ampValueInput = document.getElementById('heli-amp-value');

    ampModeSelect.addEventListener('change', () => {
        const mode = ampModeSelect.value;
        if (mode === 'fixed') {
            ampValueLabel.style.display = 'flex';
        } else {
            ampValueLabel.style.display = 'none';
        }
        fetchHelicorderData();
    });

    ampValueInput.addEventListener('change', () => {
        fetchHelicorderData();
    });

    // Add event listeners for filter controls
    const filterTypeSelect = document.getElementById('heli-filter-type');
    const filterPresetLabel = document.getElementById('heli-filter-preset');
    const filterPresetSelect = document.getElementById('heli-filter-preset-select');

    filterTypeSelect.addEventListener('change', () => {
        const filterType = filterTypeSelect.value;
        state.filter.type = filterType;

        if (filterType === 'none') {
            filterPresetLabel.style.display = 'none';
        } else {
            filterPresetLabel.style.display = 'flex';
            // Set default preset based on filter type
            if (filterType === 'bandpass') {
                filterPresetSelect.innerHTML = `
                    <option value="1-10">1-10 Hz</option>
                    <option value="2-5">2-5 Hz</option>
                    <option value="0.5-15">0.5-15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'highpass') {
                filterPresetSelect.innerHTML = `
                    <option value="0.5">0.5 Hz</option>
                    <option value="1">1 Hz</option>
                    <option value="2">2 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'lowpass') {
                filterPresetSelect.innerHTML = `
                    <option value="5">5 Hz</option>
                    <option value="10">10 Hz</option>
                    <option value="15">15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            }
            updateFilterFromPreset(filterPresetSelect.value);
        }
        fetchHelicorderData();
    });

    filterPresetSelect.addEventListener('change', () => {
        updateFilterFromPreset(filterPresetSelect.value);
        fetchHelicorderData();
    });

    fetchHelicorderData();
}

// Populate helicorder channel dropdown from station metadata
async function populateHelicorderChannels(station) {
    const select = document.getElementById('heli-channel-select');
    if (!select) return;

    try {
        const portStr = CONFIG.port ? `:${CONFIG.port}` : '';
        const url = `${CONFIG.protocol}//${CONFIG.host}${portStr}/fdsnws/station/1/query?network=${station.network}&station=${station.code}&level=channel&format=text`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Station query failed');
        const text = await response.text();

        // Parse channels from text response
        const channels = [];
        const seen = new Set();
        for (const line of text.split('\n')) {
            if (line.startsWith('#') || !line.trim()) continue;
            const parts = line.split('|');
            if (parts.length < 4) continue;
            const chan = parts[3].trim();
            const endTime = parts[16] ? parts[16].trim() : '';
            // Only include current channels (no end time = still active)
            if (endTime && endTime !== '') continue;
            if (!seen.has(chan)) {
                seen.add(chan);
                channels.push(chan);
            }
        }

        // Sort: velocity Z first, then velocity horizontals, then accel
        const chanPri = {'BH': 50, 'HH': 40, 'SH': 30, 'EH': 25, 'BN': 20, 'HN': 10, 'EN': 5};
        const orientPri = {'Z': 3, 'N': 2, 'E': 1, '2': 2, '1': 1};
        channels.sort((a, b) => {
            const aPri = (chanPri[a.substring(0, 2)] || 0) * 10 + (orientPri[a.charAt(2)] || 0);
            const bPri = (chanPri[b.substring(0, 2)] || 0) * 10 + (orientPri[b.charAt(2)] || 0);
            return bPri - aPri;
        });

        select.innerHTML = channels.map((ch, i) =>
            `<option value="${ch}" ${i === 0 ? 'selected' : ''}>${ch}</option>`
        ).join('');

        // Set state to best channel (first in sorted list)
        state.helicorderChannel = channels.length > 0 ? channels[0] : null;

    } catch (e) {
        console.warn('Failed to load channels, defaulting to ??Z:', e.message);
        select.innerHTML = '<option value="">??Z (auto)</option>';
        state.helicorderChannel = null;
    }
}

// Fetch helicorder data
async function fetchHelicorderData() {
    const station = state.selectedStation;
    if (!station) return;

    const hours = state.helicorderDuration;
    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ hours });

    // Use selected channel or fall back to ??Z wildcard
    const channelCode = state.helicorderChannel || '??Z';

    try {
        const dsQuery = configureQuery(new sp.fdsndataselect.DataSelectQuery())
            .networkCode(station.network)
            .stationCode(station.code)
            .channelCode(channelCode)
            .startTime(startTime)
            .endTime(endTime)
            .nodata(404);

        console.log(`Fetching ${hours}h helicorder for ${station.code} ${channelCode}...`);

        const dataRecords = await dsQuery.queryDataRecords();

        if (dataRecords && dataRecords.length > 0) {
            const seismograms = sp.miniseed.seismogramPerChannel(dataRecords);
            if (seismograms.length > 0) {
                // If wildcard query returned multiple, pick best by priority
                const zPri = {'BH': 5, 'HH': 4, 'SH': 3, 'EH': 2.5, 'BN': 2, 'HN': 1, 'EN': 0.5};
                const best = seismograms.reduce((a, b) =>
                    (zPri[b.channelCode.substring(0, 2)] || 0) > (zPri[a.channelCode.substring(0, 2)] || 0) ? b : a
                );
                displayHelicorder(best, hours);
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

// Update filter parameters from preset
function updateFilterFromPreset(preset) {
    if (preset === 'custom') return;

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

        // Remove mean first
        seismogram = sp.filter.rMean(seismogram);

        // Remove linear trend
        const fitLine = sp.filter.lineFit(seismogram);
        seismogram = sp.filter.removeTrend(seismogram, fitLine);

        // Create and apply Butterworth filter
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
            1 / seismogram.sampleRate  // delta (sample period)
        );

        seismogram = sp.filter.applyFilter(butterworth, seismogram);

        console.log(`✅ Applied ${state.filter.type} filter`);

        // Return new display data with filtered seismogram
        return displayData.cloneWithNewSeismogram(seismogram);

    } catch (error) {
        console.error('Error applying filter:', error);
        return displayData; // Return original on error
    }
}

// Display helicorder
function displayHelicorder(seismogram, hours) {
    const container = document.getElementById('helicorder-display');
    if (!container) return;

    try {
        container.innerHTML = '';

        // Update subtitle with sample rate
        const subtitle = document.getElementById('heli-subtitle');
        if (subtitle) {
            subtitle.textContent = `${state.selectedStation.siteName} | ${seismogram.channelCode} ${seismogram.sampleRate} sps`;
        }

        // Scale minutes per line based on duration for ~30-48 lines
        const minutesPerLine = hours <= 1 ? 2 : hours <= 3 ? 5 : hours <= 6 ? 10 : hours <= 12 ? 20 : 30;

        // Snap end time UP to next minutesPerLine boundary, start time DOWN
        const now = seismogram.endTime;
        const endMinute = Math.ceil(now.minute / minutesPerLine) * minutesPerLine;
        const endTime = now.set({ minute: 0, second: 0, millisecond: 0 }).plus({ minutes: endMinute });
        const numLines = Math.ceil((hours * 60) / minutesPerLine);
        const startTime = endTime.minus({ minutes: numLines * minutesPerLine });

        const timeRange = sp.luxon.Interval.fromDateTimes(startTime, endTime);

        // Create helicorder config with time range
        const heliConfig = new sp.helicorder.HelicorderConfig(timeRange);
        heliConfig.numLines = numLines;

        // Get amplitude scaling mode from controls
        const ampModeSelect = document.getElementById('heli-amp-mode');
        const ampValueInput = document.getElementById('heli-amp-value');

        if (ampModeSelect) {
            const ampMode = ampModeSelect.value;

            switch(ampMode) {
                case 'fixed':
                    // Fixed amplitude scaling
                    const fixedValue = parseFloat(ampValueInput.value) || 10000;
                    heliConfig.fixedAmplitudeScale = [fixedValue, -1 * fixedValue];
                    heliConfig.maxVariation = 0;
                    console.log(`Using fixed amplitude: ±${fixedValue}`);
                    break;
                case 'minmax':
                    // Min/Max scaling - use [0,0] with maxVariation=0 and doGain
                    heliConfig.fixedAmplitudeScale = [0, 0];
                    heliConfig.maxVariation = 0;
                    heliConfig.lineSeisConfig.doGain = true;
                    console.log('Using min/max amplitude scaling');
                    break;
                case 'auto':
                default:
                    // Auto scaling - use [0,0] with maxVariation=0
                    heliConfig.fixedAmplitudeScale = [0, 0];
                    heliConfig.maxVariation = 0;
                    console.log('Using auto amplitude scaling');
                    break;
            }
        }

        // Convert seismogram to SeismogramDisplayData
        let displayData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seismogram);

        // Apply filter if configured
        displayData = applyFilter(displayData);

        // Create helicorder element
        const heliElement = document.createElement('sp-helicorder');
        container.appendChild(heliElement);

        // Set helicorder properties
        heliElement.heliConfig = heliConfig;
        heliElement.seisData = [displayData];
        heliElement.draw();

        console.log(`✅ Helicorder displayed for ${hours} hours (${numLines} lines)`);

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
                <div>
                    <div class="seismograph-title">${state.selectedStation.code} - Particle Motion</div>
                    <div id="pm-subtitle" style="font-size: 12px; color: #7a8ca0; margin-top: 5px;">3-component motion visualization</div>
                </div>
                <div style="display: flex; gap: 15px; align-items: center;">
                    <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <span>Filter:</span>
                        <select id="pm-filter-type" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            <option value="none">None</option>
                            <option value="bandpass">Bandpass</option>
                            <option value="highpass">Highpass</option>
                            <option value="lowpass">Lowpass</option>
                        </select>
                    </label>
                    <label id="pm-filter-preset" style="color: #7a8ca0; font-size: 12px; display: none; align-items: center; gap: 8px;">
                        <span>Preset:</span>
                        <select id="pm-filter-preset-select" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            <option value="1-10">1-10 Hz</option>
                            <option value="2-5">2-5 Hz</option>
                            <option value="0.5-15">0.5-15 Hz</option>
                            <option value="custom">Custom</option>
                        </select>
                    </label>
                </div>
            </div>
            <details style="margin: 10px 0; padding: 10px 15px; background: var(--bg-input); border-radius: 6px; border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                <summary style="cursor: pointer; font-weight: 600; color: var(--text); font-size: 13px;">About this view</summary>
                <div style="margin-top: 8px;">
                    <p style="margin: 0 0 8px;">Particle motion plots show how ground motion moves in 2D space by plotting one component against another. Three projections are shown: E-N (horizontal plane), E-Z (east-vertical), and N-Z (north-vertical).</p>
                    <p style="margin: 0 0 8px;"><strong>Filters</strong> — Filtering is especially useful here. A bandpass filter (e.g. 1-10 Hz) isolates specific wave types and makes the particle motion pattern clearer.</p>
                    <p style="margin: 0 0 8px;"><strong>QC use</strong> — A healthy broadband station with ambient noise should show roughly circular/random motion in the E-N plane. Strong linear patterns may indicate a dominant source direction. Elliptical patterns in the vertical plane can reveal Rayleigh wave arrivals.</p>
                    <p style="margin: 0;"><strong>Note</strong> — Stations using orientation codes 1/2 instead of E/N are supported. The dashboard matches components from the same band type to avoid mixing sensor outputs.</p>
                </div>
            </details>
            <div id="particle-display" style="padding: 20px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading 3-component data...</p>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for filter controls
    const pmFilterTypeSelect = document.getElementById('pm-filter-type');
    const pmFilterPresetLabel = document.getElementById('pm-filter-preset');
    const pmFilterPresetSelect = document.getElementById('pm-filter-preset-select');

    pmFilterTypeSelect.addEventListener('change', () => {
        const filterType = pmFilterTypeSelect.value;
        state.filter.type = filterType;

        if (filterType === 'none') {
            pmFilterPresetLabel.style.display = 'none';
        } else {
            pmFilterPresetLabel.style.display = 'flex';
            if (filterType === 'bandpass') {
                pmFilterPresetSelect.innerHTML = `
                    <option value="1-10">1-10 Hz</option>
                    <option value="2-5">2-5 Hz</option>
                    <option value="0.5-15">0.5-15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'highpass') {
                pmFilterPresetSelect.innerHTML = `
                    <option value="0.5">0.5 Hz</option>
                    <option value="1">1 Hz</option>
                    <option value="2">2 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'lowpass') {
                pmFilterPresetSelect.innerHTML = `
                    <option value="5">5 Hz</option>
                    <option value="10">10 Hz</option>
                    <option value="15">15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            }
            updateFilterFromPreset(pmFilterPresetSelect.value);
        }
        fetchParticleMotionData();
    });

    pmFilterPresetSelect.addEventListener('change', () => {
        updateFilterFromPreset(pmFilterPresetSelect.value);
        fetchParticleMotionData();
    });

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
        // Fetch E/1, N/2, Z components (some stations use 1,2 instead of E,N)
        const components = ['E', 'N', 'Z', '1', '2'];
        const promises = components.map(comp => {
            const dsQuery = configureQuery(new sp.fdsndataselect.DataSelectQuery())
                .networkCode(station.network)
                .stationCode(station.code)
                .channelCode(`??${comp}`)
                .startTime(startTime)
                .endTime(endTime)
                .nodata(404);

            return dsQuery.queryDataRecords()
                .then(records => {
                    return sp.miniseed.seismogramPerChannel(records);
                })
                .catch(() => []);
        });

        const results = (await Promise.all(promises)).flat();

        // Group channels by band code (first 2 chars), then pick best complete 3-component group
        const bandGroups = {};
        for (const seis of results) {
            const band = seis.channelCode.substring(0, 2);
            if (!bandGroups[band]) bandGroups[band] = {};
            const orient = seis.channelCode.charAt(2);
            if (orient === 'Z') bandGroups[band].Z = seis;
            else if (orient === 'E' || orient === '1') bandGroups[band].H1 = seis;
            else if (orient === 'N' || orient === '2') bandGroups[band].H2 = seis;
        }
        // Pick highest-priority band that has all 3 components
        const bandPri = {'BH': 5, 'HH': 4, 'SH': 3, 'BN': 2, 'HN': 1};
        let seisH1 = null, seisH2 = null, seisZ = null;
        let bestPri = -1;
        for (const [band, group] of Object.entries(bandGroups)) {
            const pri = bandPri[band] || 0;
            if (group.H1 && group.H2 && group.Z && pri > bestPri) {
                bestPri = pri;
                seisH1 = group.H1;
                seisH2 = group.H2;
                seisZ = group.Z;
            }
        }
        // Fallback: if no single band has all 3, try mixing within same instrument type (velocity/accel)
        if (!seisH1 || !seisH2 || !seisZ) {
            const velocityBands = ['BH', 'HH', 'SH'];
            const accelBands = ['BN', 'HN'];
            for (const bandSet of [velocityBands, accelBands]) {
                let h1 = null, h2 = null, z = null;
                for (const band of bandSet) {
                    const g = bandGroups[band];
                    if (!g) continue;
                    if (!h1 && g.H1) h1 = g.H1;
                    if (!h2 && g.H2) h2 = g.H2;
                    if (!z && g.Z) z = g.Z;
                }
                if (h1 && h2 && z) {
                    seisH1 = h1; seisH2 = h2; seisZ = z;
                    break;
                }
            }
        }

        if (seisH1 && seisH2 && seisZ) {
            displayParticleMotionPlot(seisH1, seisH2, seisZ);
        } else {
            const container = document.getElementById('particle-display');
            const found = results.map(s => s.channelCode).join(', ') || 'none';
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #7a8ca0;">
                    <p>Need 3 components for particle motion (found: ${found})</p>
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

    try {
        // Update subtitle with sample rates
        const pmSubtitle = document.getElementById('pm-subtitle');
        if (pmSubtitle) {
            const info = [seisE, seisN, seisZ].map(s => `${s.channelCode} ${s.sampleRate} sps`).join(', ');
            pmSubtitle.textContent = info;
        }

        // Convert seismograms to SeismogramDisplayData and apply filter
        let eData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seisE);
        let nData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seisN);
        let zData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seisZ);

        // Apply filter if configured
        eData = applyFilter(eData);
        nData = applyFilter(nData);
        zData = applyFilter(zData);

        // Create particle motion config (optional)
        const config = sp.particlemotion.createParticleMotionConfig();

        // Create three particle motion plots: EN, EZ, NZ
        const pmEN = new sp.particlemotion.ParticleMotion(eData, nData, config);
        const pmEZ = new sp.particlemotion.ParticleMotion(eData, zData, config);
        const pmNZ = new sp.particlemotion.ParticleMotion(nData, zData, config);

        // Build labels from actual channel codes
        const h1Label = seisE.channelCode;
        const h2Label = seisN.channelCode;
        const zLabel = seisZ.channelCode;

        // Add titles and plots
        container.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                <div>
                    <h4 style="text-align: center; color: #4a9eff; margin-bottom: 10px;">${h1Label}-${h2Label}</h4>
                    <div id="pm-en"></div>
                </div>
                <div>
                    <h4 style="text-align: center; color: #4a9eff; margin-bottom: 10px;">${h1Label}-${zLabel}</h4>
                    <div id="pm-ez"></div>
                </div>
                <div>
                    <h4 style="text-align: center; color: #4a9eff; margin-bottom: 10px;">${h2Label}-${zLabel}</h4>
                    <div id="pm-nz"></div>
                </div>
            </div>
        `;

        document.getElementById('pm-en').appendChild(pmEN);
        document.getElementById('pm-ez').appendChild(pmEZ);
        document.getElementById('pm-nz').appendChild(pmNZ);
    } catch (error) {
        console.error('Error creating particle motion plots:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <p>Error creating particle motion plot</p>
                <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
            </div>
        `;
    }
}

// Display spectra
function displaySpectra() {
    const panel = document.getElementById('spectra-panel');
    panel.innerHTML = `
        <div class="spectra-container">
            <div class="seismograph-header">
                <div>
                    <div class="seismograph-title">${state.selectedStation.code} - Frequency Spectra</div>
                    <div id="spectra-subtitle" style="font-size: 12px; color: #7a8ca0; margin-top: 5px;">FFT-based frequency analysis</div>
                </div>
                <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                    <div id="spectra-channel-toggles" style="display: flex; gap: 10px; align-items: center; font-size: 12px; color: #7a8ca0;">
                        <span>Channels:</span>
                    </div>
                    <div style="border-left: 1px solid #2a3f5f; padding-left: 15px; display: flex; gap: 15px; align-items: center;">
                    <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <span>Filter:</span>
                        <select id="spectra-filter-type" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            <option value="none">None</option>
                            <option value="bandpass">Bandpass</option>
                            <option value="highpass">Highpass</option>
                            <option value="lowpass">Lowpass</option>
                        </select>
                    </label>
                    <label id="spectra-filter-preset" style="color: #7a8ca0; font-size: 12px; display: none; align-items: center; gap: 8px;">
                        <span>Preset:</span>
                        <select id="spectra-filter-preset-select" style="background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            <option value="1-10">1-10 Hz</option>
                            <option value="2-5">2-5 Hz</option>
                            <option value="0.5-15">0.5-15 Hz</option>
                            <option value="custom">Custom</option>
                        </select>
                    </label>
                    </div>
                </div>
            </div>
            <details style="margin: 10px 0; padding: 10px 15px; background: var(--bg-input); border-radius: 6px; border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                <summary style="cursor: pointer; font-weight: 600; color: var(--text); font-size: 13px;">About this view</summary>
                <div style="margin-top: 8px;">
                    <p style="margin: 0 0 8px;">Shows the frequency content of the signal using a Fast Fourier Transform (FFT). Amplitude is plotted on a log scale (Y axis) against frequency on a log scale (X axis).</p>
                    <p style="margin: 0 0 8px;"><strong>Channels</strong> — Toggle individual components on/off using the checkboxes. This lets you compare the spectral content of different channels overlaid on the same plot.</p>
                    <p style="margin: 0 0 8px;"><strong>Filters</strong> — Applying a filter before computing the FFT will shape the spectrum accordingly. This can help isolate frequency bands of interest.</p>
                    <p style="margin: 0 0 8px;"><strong>QC use</strong> — Look for spectral peaks that indicate cultural noise (e.g. machinery at specific frequencies), sensor problems (sharp resonance peaks), or site effects. A flat spectrum at low amplitudes across all frequencies may indicate a dead or disconnected channel.</p>
                    <p style="margin: 0;"><strong>Note</strong> — The FFT is computed from the most recent 10 minutes of data for the selected station. Amplitude units are raw counts (not corrected for instrument response).</p>
                </div>
            </details>
            <div id="spectra-display" style="padding: 20px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Computing FFT...</p>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for filter controls
    const spectraFilterTypeSelect = document.getElementById('spectra-filter-type');
    const spectraFilterPresetLabel = document.getElementById('spectra-filter-preset');
    const spectraFilterPresetSelect = document.getElementById('spectra-filter-preset-select');

    spectraFilterTypeSelect.addEventListener('change', () => {
        const filterType = spectraFilterTypeSelect.value;
        state.filter.type = filterType;

        if (filterType === 'none') {
            spectraFilterPresetLabel.style.display = 'none';
        } else {
            spectraFilterPresetLabel.style.display = 'flex';
            if (filterType === 'bandpass') {
                spectraFilterPresetSelect.innerHTML = `
                    <option value="1-10">1-10 Hz</option>
                    <option value="2-5">2-5 Hz</option>
                    <option value="0.5-15">0.5-15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'highpass') {
                spectraFilterPresetSelect.innerHTML = `
                    <option value="0.5">0.5 Hz</option>
                    <option value="1">1 Hz</option>
                    <option value="2">2 Hz</option>
                    <option value="custom">Custom</option>
                `;
            } else if (filterType === 'lowpass') {
                spectraFilterPresetSelect.innerHTML = `
                    <option value="5">5 Hz</option>
                    <option value="10">10 Hz</option>
                    <option value="15">15 Hz</option>
                    <option value="custom">Custom</option>
                `;
            }
            updateFilterFromPreset(spectraFilterPresetSelect.value);
        }
        fetchSpectraData();
    });

    spectraFilterPresetSelect.addEventListener('change', () => {
        updateFilterFromPreset(spectraFilterPresetSelect.value);
        fetchSpectraData();
    });

    if (state.isMonitoring) {
        fetchSpectraData();
    }
}

// Fetch spectra data — all 3 components
async function fetchSpectraData() {
    const station = state.selectedStation;
    if (!station) return;

    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: 600 });

    try {
        // Fetch all components
        const components = ['E', 'N', 'Z', '1', '2'];
        const promises = components.map(comp => {
            const dsQuery = configureQuery(new sp.fdsndataselect.DataSelectQuery())
                .networkCode(station.network)
                .stationCode(station.code)
                .channelCode(`??${comp}`)
                .startTime(startTime)
                .endTime(endTime)
                .nodata(404);
            return dsQuery.queryDataRecords()
                .then(records => sp.miniseed.seismogramPerChannel(records))
                .catch(() => []);
        });
        const allSeismograms = (await Promise.all(promises)).flat();

        if (allSeismograms.length > 0) {
            // Group by band, pick best complete set
            const bandGroups = {};
            for (const seis of allSeismograms) {
                const band = seis.channelCode.substring(0, 2);
                if (!bandGroups[band]) bandGroups[band] = {};
                const orient = seis.channelCode.charAt(2);
                if (orient === 'Z') bandGroups[band].Z = seis;
                else if (orient === 'E' || orient === '1') bandGroups[band].H1 = seis;
                else if (orient === 'N' || orient === '2') bandGroups[band].H2 = seis;
            }
            const bandPri = {'BH': 5, 'HH': 4, 'SH': 3, 'EH': 2.5, 'BN': 2, 'HN': 1, 'EN': 0.5};
            let bestBand = null, bestPri = -1;
            for (const [band, group] of Object.entries(bandGroups)) {
                const pri = bandPri[band] || 0;
                if (group.Z && pri > bestPri) { bestPri = pri; bestBand = band; }
            }
            if (bestBand) {
                const g = bandGroups[bestBand];
                const selected = [g.H1, g.H2, g.Z].filter(Boolean);
                // Cache and build toggles
                state.spectraSeismograms = selected;
                populateSpectraToggles(selected);
                displaySpectraPlot(selected);
            } else {
                const container = document.getElementById('spectra-display');
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #7a8ca0;">
                        <p>No seismogram data available for spectra</p>
                    </div>
                `;
            }
        } else {
            const container = document.getElementById('spectra-display');
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #7a8ca0;">
                    <p>No data available for selected time window</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Error fetching spectra data:', error);
    }
}

// Populate spectra channel toggle checkboxes
function populateSpectraToggles(seismograms) {
    const container = document.getElementById('spectra-channel-toggles');
    if (!container) return;

    // Channel colors matching typical seisplotjs palette
    const colors = ['#4a9eff', '#ff6b6b', '#51cf66'];

    container.innerHTML = '<span>Channels:</span>' + seismograms.map((seis, i) => `
        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" checked data-channel="${seis.channelCode}"
                style="accent-color: ${colors[i % colors.length]};">
            <span style="color: ${colors[i % colors.length]};">${seis.channelCode}</span>
        </label>
    `).join('');

    // Add toggle listeners
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(container.querySelectorAll('input:checked'))
                .map(el => el.dataset.channel);
            const visible = state.spectraSeismograms.filter(s => checked.includes(s.channelCode));
            if (visible.length > 0) {
                displaySpectraPlot(visible);
            }
        });
    });
}

// Display spectra plot — accepts array of seismograms
function displaySpectraPlot(seismograms) {
    const container = document.getElementById('spectra-display');
    container.innerHTML = '';

    // Normalize to array
    if (!Array.isArray(seismograms)) seismograms = [seismograms];
    seismograms = seismograms.filter(Boolean);

    try {
        if (seismograms.length === 0) {
            throw new Error('No seismogram data');
        }

        // Update subtitle
        const spectraSubtitle = document.getElementById('spectra-subtitle');
        if (spectraSubtitle) {
            const info = seismograms.map(s => `${s.channelCode} ${s.sampleRate} sps`).join(', ');
            const nyquist = (seismograms[0].sampleRate / 2).toFixed(1);
            spectraSubtitle.textContent = `${info} | Nyquist: ${nyquist} Hz`;
        }

        // Compute FFT for each component
        const fftResults = [];
        for (const seis of seismograms) {
            if (!seis.isContiguous || !seis.isContiguous()) {
                console.warn(`Skipping ${seis.channelCode}: not contiguous`);
                continue;
            }
            let displayData = sp.seismogram.SeismogramDisplayData.fromSeismogram(seis);
            displayData = applyFilter(displayData);
            fftResults.push(sp.fft.fftForward(displayData));
        }

        if (fftResults.length === 0) {
            throw new Error('No contiguous seismograms for FFT');
        }

        // Create spectra plot with all components overlaid
        const spectraConfig = new sp.seismographconfig.SeismographConfig();
        spectraConfig.xLabel = 'Frequency';
        spectraConfig.xSublabel = 'Hz';
        spectraConfig.yLabel = 'Amplitude';
        spectraConfig.ySublabel = 'counts';
        spectraConfig.ySublabelIsUnits = false;

        const spectraPlot = new sp.spectraplot.SpectraPlot(fftResults, spectraConfig);
        spectraPlot.style.width = '100%';
        spectraPlot.style.height = '500px';
        container.appendChild(spectraPlot);

        console.log(`Spectra plot: ${fftResults.length} component(s)`);
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

// Display spectrogram
function displaySpectrogram() {
    const panel = document.getElementById('spectrogram-panel');
    const selectStyle = 'background: #1a1f2e; color: #d1d5db; border: 1px solid #2a3f5f; padding: 4px 8px; border-radius: 4px; font-size: 12px;';
    panel.innerHTML = `
        <div class="spectrogram-container">
            <div class="seismograph-header">
                <div>
                    <div class="seismograph-title">${state.selectedStation.code} - Spectrogram (Time-Frequency)</div>
                    <div id="spectrogram-subtitle" style="font-size: 12px; color: #7a8ca0; margin-top: 5px;">Shows how frequency content evolves over time</div>
                </div>
                <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                    <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                        <span>Channel:</span>
                        <select id="sg-channel-select" style="${selectStyle}">
                            <option value="">Loading...</option>
                        </select>
                    </label>
                    <div class="time-controls">
                        <button class="time-btn" data-seconds="60">1 min</button>
                        <button class="time-btn" data-seconds="300">5 min</button>
                        <button class="time-btn active" data-seconds="600">10 min</button>
                        <button class="time-btn" data-seconds="1800">30 min</button>
                    </div>
                    <div style="border-left: 1px solid #2a3f5f; padding-left: 15px; display: flex; gap: 15px; align-items: center;">
                        <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>Min Freq:</span>
                            <select id="sg-min-freq" style="${selectStyle}">
                                <option value="0" selected>0 Hz</option>
                                <option value="0.1">0.1 Hz</option>
                                <option value="0.5">0.5 Hz</option>
                                <option value="1">1 Hz</option>
                                <option value="2">2 Hz</option>
                                <option value="5">5 Hz</option>
                            </select>
                        </label>
                        <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>Max Freq:</span>
                            <select id="sg-max-freq" style="${selectStyle}">
                                <option value="0">Full (Nyquist)</option>
                                <option value="5">5 Hz</option>
                                <option value="10">10 Hz</option>
                                <option value="20" selected>20 Hz</option>
                                <option value="50">50 Hz</option>
                            </select>
                        </label>
                        <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>Window:</span>
                            <select id="stft-window-size" style="${selectStyle}">
                                <option value="128">128</option>
                                <option value="256" selected>256</option>
                                <option value="512">512</option>
                                <option value="1024">1024</option>
                            </select>
                        </label>
                        <label style="color: #7a8ca0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                            <span>Overlap:</span>
                            <select id="stft-overlap" style="${selectStyle}">
                                <option value="0">0%</option>
                                <option value="0.25">25%</option>
                                <option value="0.5" selected>50%</option>
                                <option value="0.75">75%</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>
            <details style="margin: 10px 0; padding: 10px 15px; background: var(--bg-input); border-radius: 6px; border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                <summary style="cursor: pointer; font-weight: 600; color: var(--text); font-size: 13px;">About this view</summary>
                <div style="margin-top: 8px;">
                    <p style="margin: 0 0 8px;">A spectrogram shows how the frequency content of a signal changes over time. Time runs left to right, frequency runs bottom to top, and colour intensity represents amplitude (warm colours = higher energy).</p>
                    <p style="margin: 0 0 8px;"><strong>Channel</strong> — Select which component to analyse. Only one channel is shown at a time.</p>
                    <p style="margin: 0 0 8px;"><strong>Duration</strong> — Choose 1, 5, 10, or 30 minutes. Shorter durations give finer time resolution; longer durations show more context.</p>
                    <p style="margin: 0 0 8px;"><strong>Max Freq</strong> — Limits the upper frequency displayed. Use lower values (5-10 Hz) to focus on teleseismic/regional signals, or "Full (Nyquist)" to see the entire bandwidth.</p>
                    <p style="margin: 0 0 8px;"><strong>Window &amp; Overlap</strong> — Controls the Short-Time Fourier Transform (STFT). Larger windows give better frequency resolution but poorer time resolution. Higher overlap produces smoother results but takes longer to compute.</p>
                    <p style="margin: 0;"><strong>QC use</strong> — Persistent horizontal lines indicate continuous tonal noise (machinery, electronics). Broadband vertical streaks are transient events (earthquakes, blasts). Gaps in the spectrogram correspond to data gaps.</p>
                </div>
            </details>
            <div id="spectrogram-display" style="padding: 20px;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Computing spectrogram...</p>
                </div>
            </div>
        </div>
    `;

    // Duration state
    state.spectrogramDuration = 600;

    // Duration buttons
    panel.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            panel.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.spectrogramDuration = parseInt(btn.dataset.seconds);
            fetchSpectrogramData();
        });
    });

    // Channel selector
    const sgChannelSelect = document.getElementById('sg-channel-select');
    populateSpectrogramChannels(state.selectedStation, sgChannelSelect);
    sgChannelSelect.addEventListener('change', () => {
        state.spectrogramChannel = sgChannelSelect.value || null;
        fetchSpectrogramData();
    });

    // Other controls
    document.getElementById('stft-window-size').addEventListener('change', () => fetchSpectrogramData());
    document.getElementById('stft-overlap').addEventListener('change', () => fetchSpectrogramData());
    document.getElementById('sg-max-freq').addEventListener('change', () => fetchSpectrogramData());
    document.getElementById('sg-min-freq').addEventListener('change', () => fetchSpectrogramData());

    if (state.isMonitoring) {
        fetchSpectrogramData();
    }
}

// Populate spectrogram channel dropdown (reuse same logic as helicorder)
async function populateSpectrogramChannels(station, select) {
    try {
        const portStr = CONFIG.port ? `:${CONFIG.port}` : '';
        const url = `${CONFIG.protocol}//${CONFIG.host}${portStr}/fdsnws/station/1/query?network=${station.network}&station=${station.code}&level=channel&format=text`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Station query failed');
        const text = await response.text();

        const channels = [];
        const seen = new Set();
        for (const line of text.split('\n')) {
            if (line.startsWith('#') || !line.trim()) continue;
            const parts = line.split('|');
            if (parts.length < 4) continue;
            const chan = parts[3].trim();
            const endTime = parts[16] ? parts[16].trim() : '';
            if (endTime && endTime !== '') continue;
            if (!seen.has(chan)) { seen.add(chan); channels.push(chan); }
        }

        const chanPri = {'BH': 50, 'HH': 40, 'SH': 30, 'EH': 25, 'BN': 20, 'HN': 10, 'EN': 5};
        const orientPri = {'Z': 3, 'N': 2, 'E': 1, '2': 2, '1': 1};
        channels.sort((a, b) => {
            const aPri = (chanPri[a.substring(0, 2)] || 0) * 10 + (orientPri[a.charAt(2)] || 0);
            const bPri = (chanPri[b.substring(0, 2)] || 0) * 10 + (orientPri[b.charAt(2)] || 0);
            return bPri - aPri;
        });

        select.innerHTML = channels.map((ch, i) =>
            `<option value="${ch}" ${i === 0 ? 'selected' : ''}>${ch}</option>`
        ).join('');
        state.spectrogramChannel = channels.length > 0 ? channels[0] : null;
    } catch (e) {
        select.innerHTML = '<option value="">??Z (auto)</option>';
        state.spectrogramChannel = null;
    }
}

// Fetch spectrogram data
async function fetchSpectrogramData() {
    const station = state.selectedStation;
    if (!station) return;

    let startTime, endTime;
    const duration = state.spectrogramDuration || 600;
    endTime = sp.luxon.DateTime.utc();
    startTime = endTime.minus({ seconds: duration });
    // Use helicorder channel if available, otherwise spectrogram channel
    const channelCode = state.spectrogramChannel || state.helicorderChannel || '??Z';

    try {
        const dsQuery = configureQuery(new sp.fdsndataselect.DataSelectQuery())
            .networkCode(station.network)
            .stationCode(station.code)
            .channelCode(channelCode)
            .startTime(startTime)
            .endTime(endTime)
            .nodata(404);

        const dataRecords = await dsQuery.queryDataRecords();

        if (dataRecords && dataRecords.length > 0) {
            const seismograms = sp.miniseed.seismogramPerChannel(dataRecords);
            if (seismograms.length > 0) {
                const zPri = {'BH': 5, 'HH': 4, 'SH': 3, 'EH': 2.5, 'BN': 2, 'HN': 1, 'EN': 0.5};
                const best = seismograms.reduce((a, b) =>
                    (zPri[b.channelCode.substring(0, 2)] || 0) > (zPri[a.channelCode.substring(0, 2)] || 0) ? b : a
                );
                displaySpectrogramPlot(best);
            } else {
                const container = document.getElementById('spectrogram-display');
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #7a8ca0;">
                        <p>No seismogram data available for spectrogram</p>
                    </div>
                `;
            }
        } else {
            const container = document.getElementById('spectrogram-display');
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #7a8ca0;">
                    <p>No data available for selected time window</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Error fetching spectrogram data:', error);
        const container = document.getElementById('spectrogram-display');
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <p>Error loading spectrogram data</p>
                <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
            </div>
        `;
    }
}

// Display spectrogram plot using STFT
function displaySpectrogramPlot(seismogram) {
    const container = document.getElementById('spectrogram-display');
    container.innerHTML = '';

    try {
        if (!seismogram) {
            throw new Error('Seismogram is null or undefined');
        }

        // Update subtitle with sample rate
        const sgSubtitle = document.getElementById('spectrogram-subtitle');
        if (sgSubtitle) {
            sgSubtitle.textContent = `${seismogram.channelCode} ${seismogram.sampleRate} sps | Nyquist: ${(seismogram.sampleRate / 2).toFixed(1)} Hz`;
        }

        if (!seismogram.isContiguous || !seismogram.isContiguous()) {
            throw new Error('Seismogram must be contiguous for STFT');
        }

        // Get STFT parameters
        const windowSize = parseInt(document.getElementById('stft-window-size').value);
        const overlap = parseFloat(document.getElementById('stft-overlap').value);
        const hopSize = Math.floor(windowSize * (1 - overlap));

        // Extract samples - seismogram.y is a property, not a function
        // For contiguous seismograms, use .y directly
        // For segmented, we need to merge segments
        let samples;
        if (seismogram.y) {
            samples = seismogram.y;
        } else if (seismogram.segments && seismogram.segments.length > 0) {
            // Merge segments
            const totalLength = seismogram.segments.reduce((sum, seg) => sum + seg.y.length, 0);
            samples = new Float32Array(totalLength);
            let offset = 0;
            for (const seg of seismogram.segments) {
                samples.set(seg.y, offset);
                offset += seg.y.length;
            }
        } else {
            throw new Error('Cannot extract samples from seismogram');
        }

        const sampleRate = seismogram.sampleRate;
        const numWindows = Math.floor((samples.length - windowSize) / hopSize) + 1;

        console.log(`Computing STFT: ${numWindows} windows, ${windowSize} samples each, ${hopSize} hop size`);

        // Compute STFT - array of FFT results over time
        const stftResults = [];
        const timeStamps = [];

        for (let i = 0; i < numWindows; i++) {
            const startIdx = i * hopSize;
            const endIdx = startIdx + windowSize;

            if (endIdx > samples.length) break;

            // Calculate time window for this segment
            const windowStartTime = seismogram.startTime.plus({ milliseconds: (startIdx / sampleRate) * 1000 });
            const windowEndTime = seismogram.startTime.plus({ milliseconds: (endIdx / sampleRate) * 1000 });
            const timeWindow = sp.luxon.Interval.fromDateTimes(windowStartTime, windowEndTime);

            // Cut seismogram to this window
            const windowSeis = seismogram.cut(timeWindow);

            if (windowSeis && windowSeis.isContiguous()) {
                // Convert to display data and compute FFT
                const displayData = sp.seismogram.SeismogramDisplayData.fromSeismogram(windowSeis);
                const fftResult = sp.fft.fftForward(displayData);

                stftResults.push(fftResult);
                timeStamps.push(windowStartTime);
            }
        }

        console.log(`✅ Computed ${stftResults.length} FFT windows`);

        // Draw spectrogram heatmap
        drawSpectrogramHeatmap(container, stftResults, timeStamps, sampleRate, seismogram);

    } catch (error) {
        console.error('Error creating spectrogram:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <p>Error creating spectrogram</p>
                <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
            </div>
        `;
    }
}

// Draw spectrogram heatmap on canvas
function drawSpectrogramHeatmap(container, stftResults, timeStamps, sampleRate, seismogram) {
    const width = Math.max(container.clientWidth - 40, 600);
    const height = 550;

    // Create canvas with full dimensions
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.background = '#1a1f2e';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';

    const ctx = canvas.getContext('2d');

    // Get magnitude data from FFT results
    const numTimeSteps = stftResults.length;
    const [firstAmp] = stftResults[0].asAmpPhase();
    const numFreqBins = firstAmp.length;

    // Frequency clipping
    const maxFreqSetting = parseFloat(document.getElementById('sg-max-freq')?.value || '0');
    const minFreqSetting = parseFloat(document.getElementById('sg-min-freq')?.value || '0');
    const nyquist = sampleRate / 2;
    const displayMaxFreq = (maxFreqSetting > 0 && maxFreqSetting < nyquist) ? maxFreqSetting : nyquist;
    const displayMinFreq = (minFreqSetting > 0 && minFreqSetting < displayMaxFreq) ? minFreqSetting : 0;
    const maxBin = Math.ceil((displayMaxFreq / nyquist) * numFreqBins);
    const minBin = Math.floor((displayMinFreq / nyquist) * numFreqBins);
    const displayBins = maxBin - minBin;

    // Build magnitude matrix and find min/max for color scaling
    const magnitudes = [];
    let maxMag = -Infinity;
    let minMag = Infinity;

    for (let t = 0; t < numTimeSteps; t++) {
        const [amp] = stftResults[t].asAmpPhase();
        magnitudes[t] = [];

        for (let fi = 0; fi < displayBins; fi++) {
            const f = fi + minBin;
            const mag = 20 * Math.log10(amp[f] + 1e-10); // dB scale
            magnitudes[t][fi] = mag;
            if (mag > maxMag) maxMag = mag;
            if (mag < minMag) minMag = mag;
        }
    }

    console.log(`Magnitude range: ${minMag.toFixed(1)} to ${maxMag.toFixed(1)} dB | Display: ${displayMinFreq}-${displayMaxFreq} Hz (${displayBins}/${numFreqBins} bins)`);

    // Define margins for axes
    const margin = { top: 50, right: 120, bottom: 60, left: 70 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    // Clear canvas
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, 0, width, height);

    // Draw heatmap
    const pixelWidth = plotWidth / numTimeSteps;
    const pixelHeight = plotHeight / displayBins;

    for (let t = 0; t < numTimeSteps; t++) {
        for (let f = 0; f < displayBins; f++) {
            const mag = magnitudes[t][f];
            const normalized = (mag - minMag) / (maxMag - minMag);

            // Color scale: blue (low) -> cyan -> green -> yellow -> red (high)
            const color = getHeatmapColor(normalized);

            ctx.fillStyle = color;
            ctx.fillRect(
                margin.left + t * pixelWidth,
                margin.top + plotHeight - (f + 1) * pixelHeight, // flip y-axis
                Math.ceil(pixelWidth) + 1,
                Math.ceil(pixelHeight) + 1
            );
        }
    }

    // Draw axes and labels
    ctx.fillStyle = '#d1d5db';
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.font = '12px sans-serif';

    // Y-axis (frequency)
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotHeight);
    ctx.stroke();

    const freqTicks = 6;
    for (let i = 0; i <= freqTicks; i++) {
        const freq = displayMinFreq + ((displayMaxFreq - displayMinFreq) * i) / freqTicks;
        const y = margin.top + plotHeight - (i / freqTicks) * plotHeight;

        ctx.beginPath();
        ctx.moveTo(margin.left - 5, y);
        ctx.lineTo(margin.left, y);
        ctx.stroke();

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(freq.toFixed(1), margin.left - 10, y);
    }

    // X-axis (time)
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top + plotHeight);
    ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
    ctx.stroke();

    const timeTicks = 5;
    for (let i = 0; i <= timeTicks; i++) {
        const x = margin.left + (i / timeTicks) * plotWidth;
        const timeIdx = Math.floor((i / timeTicks) * (numTimeSteps - 1));
        const time = timeStamps[timeIdx].toFormat('HH:mm:ss');

        ctx.beginPath();
        ctx.moveTo(x, margin.top + plotHeight);
        ctx.lineTo(x, margin.top + plotHeight + 5);
        ctx.stroke();

        ctx.save();
        ctx.translate(x, margin.top + plotHeight + 20);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(time, 0, 0);
        ctx.restore();
    }

    // Axis labels
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#d1d5db';

    // Y-axis label
    ctx.save();
    ctx.translate(15, margin.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', 0, 0);
    ctx.restore();

    // X-axis label
    ctx.textAlign = 'center';
    ctx.fillText('Time (UTC)', margin.left + plotWidth / 2, height - 15);

    // Title
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#4a9eff';
    ctx.textAlign = 'center';
    ctx.fillText(`${seismogram.channelCode} - Spectrogram`, width / 2, 25);

    // Color scale legend
    const legendX = width - margin.right + 20;
    const legendY = margin.top + 50;
    const legendWidth = 20;
    const legendHeight = 200;

    // Draw legend gradient
    for (let i = 0; i < legendHeight; i++) {
        const normalized = i / legendHeight;
        ctx.fillStyle = getHeatmapColor(normalized);
        ctx.fillRect(legendX, legendY + legendHeight - i, legendWidth, 1);
    }

    // Legend border
    ctx.strokeStyle = '#9ca3af';
    ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

    // Legend labels
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#d1d5db';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const legendTicks = 5;
    for (let i = 0; i <= legendTicks; i++) {
        const value = minMag + (maxMag - minMag) * (i / legendTicks);
        const y = legendY + legendHeight - (i / legendTicks) * legendHeight;
        ctx.fillText(value.toFixed(0), legendX + legendWidth + 5, y);
    }

    // Legend title
    ctx.textAlign = 'left';
    ctx.fillText('dB', legendX, legendY - 10);

    container.appendChild(canvas);
    console.log('✅ Spectrogram heatmap rendered');
}

// Get color for heatmap (normalized value 0-1)
function getHeatmapColor(value) {
    // Clamp value
    value = Math.max(0, Math.min(1, value));

    // Color scale: dark blue -> blue -> cyan -> green -> yellow -> red
    if (value < 0.2) {
        // Dark blue to blue
        const t = value / 0.2;
        const r = 0;
        const g = 0;
        const b = Math.floor(50 + t * 150);
        return `rgb(${r}, ${g}, ${b})`;
    } else if (value < 0.4) {
        // Blue to cyan
        const t = (value - 0.2) / 0.2;
        const r = 0;
        const g = Math.floor(t * 200);
        const b = 200;
        return `rgb(${r}, ${g}, ${b})`;
    } else if (value < 0.6) {
        // Cyan to green
        const t = (value - 0.4) / 0.2;
        const r = 0;
        const g = 200;
        const b = Math.floor(200 * (1 - t));
        return `rgb(${r}, ${g}, ${b})`;
    } else if (value < 0.8) {
        // Green to yellow
        const t = (value - 0.6) / 0.2;
        const r = Math.floor(t * 255);
        const g = 200 + Math.floor(t * 55);
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        // Yellow to red
        const t = (value - 0.8) / 0.2;
        const r = 255;
        const g = Math.floor(255 * (1 - t));
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    }
}

// Station Health — single streamlined QC scan
let healthResults = [];
let healthSortCol = 'status';
let healthSortAsc = true;
let healthStatusFilter = null;

async function displayHealthSummary() {
    const panel = document.getElementById('health-panel');
    const selectStyle = 'background: var(--bg-input); color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 4px; font-size: 13px;';
    panel.innerHTML = `
        <div class="seismograph-container">
            <div class="seismograph-header">
                <div>
                    <div class="seismograph-title">Station QC Health</div>
                    <div id="health-subtitle" style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">Check data availability, gaps, and noise across all stations</div>
                </div>
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                    <input type="text" id="healthSearch" placeholder="Search stations..." style="${selectStyle} width: 180px;">
                    <select id="healthDuration" style="${selectStyle}">
                        <option value="300">5 min</option>
                        <option value="1800">30 min</option>
                        <option value="3600" selected>1 hour</option>
                        <option value="21600">6 hours</option>
                        <option value="86400">24 hours</option>
                    </select>
                    <button class="btn btn-primary" id="healthScanBtn">Scan</button>
                </div>
            </div>
            <details id="health-help" style="margin: 10px 0; padding: 10px 15px; background: var(--bg-input); border-radius: 6px; border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                <summary style="cursor: pointer; font-weight: 600; color: var(--text); font-size: 13px; margin-bottom: 4px;">How to read this table</summary>
                <div style="margin-top: 8px;">
                    <p style="margin: 0 0 8px;"><strong>Scan Window</strong> — Choose how far back to look for data. Shorter windows (5 min) scan faster and are good for checking current latency. Longer windows (6h, 24h) take more time but reveal intermittent gaps.</p>
                    <p style="margin: 0 0 8px;"><strong>What gets scanned</strong> — For each station, the vertical (Z) component is queried from the FDSNWS server. The scan checks latency, data gaps, and RMS noise level.</p>
                    <p style="margin: 0 0 10px;"><strong>Status categories:</strong></p>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
                        <tr><td style="padding: 3px 8px;"><span class="health-badge health-good">OK</span></td><td style="padding: 3px 8px;">Latency under 2 minutes, no data gaps. Station is healthy.</td></tr>
                        <tr><td style="padding: 3px 8px;"><span class="health-badge health-gappy">Gaps</span></td><td style="padding: 3px 8px;">Latency is fine but there are gaps in the data within the scan window. May indicate telemetry dropouts or buffer issues.</td></tr>
                        <tr><td style="padding: 3px 8px;"><span class="health-badge health-warn">Delayed</span></td><td style="padding: 3px 8px;">Latency between 2 and 10 minutes. Data is arriving but slower than expected.</td></tr>
                        <tr><td style="padding: 3px 8px;"><span class="health-badge health-clockoff">Clock Off</span></td><td style="padding: 3px 8px;">Data timestamps are more than 10 seconds ahead of server time. Indicates the station clock is not synchronised (GPS/NTP issue).</td></tr>
                        <tr><td style="padding: 3px 8px;"><span class="health-badge health-bad">Stale</span></td><td style="padding: 3px 8px;">Latency over 10 minutes. Station may be down or experiencing significant telemetry delays.</td></tr>
                        <tr><td style="padding: 3px 8px;"><span class="health-badge health-unknown">No Data</span></td><td style="padding: 3px 8px;">No data returned for this station within the scan window. Could be offline or not yet acquired.</td></tr>
                    </table>
                    <p style="margin: 0 0 8px;"><strong>Columns:</strong></p>
                    <ul style="margin: 0 0 8px; padding-left: 20px;">
                        <li><strong>Channel</strong> — The Z-component channel code returned (e.g. BHZ, HHZ, SHZ).</li>
                        <li><strong>Rate</strong> — Sample rate in samples per second.</li>
                        <li><strong>Latency</strong> — Time difference between now and the last sample timestamp. Measured at the moment each station is scanned. Negative values (purple) mean the station clock is ahead.</li>
                        <li><strong>Gaps</strong> — Number of data gaps (discontinuities) found in the scan window. More gaps in a short window suggests telemetry problems.</li>
                        <li><strong>RMS</strong> — Root-mean-square amplitude of the raw signal (counts). Useful for spotting dead channels (RMS near 0) or unusually noisy stations. Only computed for contiguous data.</li>
                    </ul>
                    <p style="margin: 0;"><strong>Tips:</strong> Click column headers to sort. Use the filter badges to show only a specific status. Click any station row to jump to its waveforms. The search box filters by station code, name, network, or channel.</p>
                </div>
            </details>
            <div id="health-table-container">
                <p style="color: var(--text-secondary); padding: 20px;">Select a scan window and click "Scan" to check all stations.<br>Shorter windows are faster. Longer windows reveal more gaps.</p>
            </div>
        </div>
    `;

    document.getElementById('healthScanBtn').addEventListener('click', runHealthScan);
    document.getElementById('healthSearch').addEventListener('input', (e) => {
        if (healthResults.length > 0) renderHealthTable(healthResults, e.target.value);
    });

    if (healthResults.length > 0) renderHealthTable(healthResults, '');
}

function renderHealthTable(results, searchQuery) {
    const container = document.getElementById('health-table-container');
    if (!container) return;

    // Filter by status
    let filtered = results;
    if (healthStatusFilter) {
        const filterStatuses = healthStatusFilter === 'nodata' ? ['nodata', 'error'] : [healthStatusFilter];
        filtered = filtered.filter(r => filterStatuses.includes(r.status));
    }
    // Filter by search
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(r =>
            r.station.code.toLowerCase().includes(q) ||
            r.station.siteName.toLowerCase().includes(q) ||
            r.station.network.toLowerCase().includes(q) ||
            r.channel.toLowerCase().includes(q) ||
            r.status.toLowerCase().includes(q)
        );
    }

    // Sort
    const statusOrder = { good: 0, gappy: 1, warn: 2, clockoff: 3, bad: 4, nodata: 5, error: 6 };
    const sortFn = (a, b) => {
        let va, vb;
        switch (healthSortCol) {
            case 'station': va = `${a.station.network}.${a.station.code}`; vb = `${b.station.network}.${b.station.code}`; return healthSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            case 'status': va = statusOrder[a.status] || 5; vb = statusOrder[b.status] || 5; break;
            case 'channel': va = a.channel; vb = b.channel; return healthSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            case 'sampleRate': va = a.sampleRate; vb = b.sampleRate; break;
            case 'latency': va = a.latency ?? 999999; vb = b.latency ?? 999999; break;
            case 'gaps': va = a.gaps; vb = b.gaps; break;
            case 'rms': va = a.rms; vb = b.rms; break;
            default: va = 0; vb = 0;
        }
        return healthSortAsc ? va - vb : vb - va;
    };
    filtered.sort(sortFn);

    // Count summary (from full results, not filtered)
    const counts = { good: 0, gappy: 0, warn: 0, clockoff: 0, bad: 0, nodata: 0, error: 0 };
    results.forEach(r => counts[r.status] = (counts[r.status] || 0) + 1);

    const arrow = (col) => healthSortCol === col ? (healthSortAsc ? ' ▲' : ' ▼') : '';
    const activeStyle = (status) => healthStatusFilter === status ? 'outline: 2px solid var(--accent); outline-offset: 1px;' : 'cursor: pointer; opacity: 0.8;';
    const allActive = !healthStatusFilter ? 'outline: 2px solid var(--accent); outline-offset: 1px;' : 'cursor: pointer; opacity: 0.8;';

    // Show scan window label
    const durationSelect = document.getElementById('healthDuration');
    const durLabels = { 300: '5 min', 1800: '30 min', 3600: '1 hour', 21600: '6 hours', 86400: '24 hours' };
    const scanLabel = durationSelect ? (durLabels[durationSelect.value] || durationSelect.value + 's') : '';

    container.innerHTML = `
        <div style="margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
            <span class="health-badge" data-filter="" style="${allActive} cursor: pointer; background: rgba(107,114,128,0.15); color: var(--text);">${results.length} All</span>
            <span class="health-badge health-good" data-filter="good" style="${activeStyle('good')} cursor: pointer;">${counts.good} OK</span>
            <span class="health-badge health-gappy" data-filter="gappy" style="${activeStyle('gappy')} cursor: pointer;">${counts.gappy} Gaps</span>
            <span class="health-badge health-warn" data-filter="warn" style="${activeStyle('warn')} cursor: pointer;">${counts.warn} Delayed</span>
            <span class="health-badge health-clockoff" data-filter="clockoff" style="${activeStyle('clockoff')} cursor: pointer;">${counts.clockoff} Clock Off</span>
            <span class="health-badge health-bad" data-filter="bad" style="${activeStyle('bad')} cursor: pointer;">${counts.bad} Stale</span>
            <span class="health-badge health-unknown" data-filter="nodata" style="${activeStyle('nodata')} cursor: pointer;">${counts.nodata + counts.error} No Data</span>
            <span style="color: var(--text-secondary); font-size: 12px; margin-left: 10px;">${filtered.length}/${results.length} stations | Window: ${scanLabel}</span>
        </div>
        <div style="max-height: 550px; overflow-y: auto;">
        <table class="health-table">
            <thead>
                <tr>
                    <th data-sort="station">Station${arrow('station')}</th>
                    <th data-sort="status">Status${arrow('status')}</th>
                    <th data-sort="channel">Channel${arrow('channel')}</th>
                    <th data-sort="sampleRate">Rate${arrow('sampleRate')}</th>
                    <th data-sort="latency">Latency${arrow('latency')}</th>
                    <th data-sort="gaps">Gaps${arrow('gaps')}</th>
                    <th data-sort="rms">RMS${arrow('rms')}</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(r => {
                    const stKey = `${r.station.network}.${r.station.code}`;
                    const statusLabels = { good: 'OK', gappy: 'Gaps', warn: 'Delayed', clockoff: 'Clock Off', bad: 'Stale', nodata: 'No Data', error: 'Error' };
                    const statusClasses = { good: 'health-good', gappy: 'health-gappy', warn: 'health-warn', clockoff: 'health-clockoff', bad: 'health-bad', nodata: 'health-unknown', error: 'health-bad' };
                    const statusLabel = statusLabels[r.status] || 'Unknown';
                    const statusClass = statusClasses[r.status] || 'health-unknown';
                    let latStr = '-';
                    if (r.latency !== null) {
                        const absLat = Math.abs(r.latency);
                        latStr = absLat < 60 ? `${absLat.toFixed(0)}s` : absLat < 3600 ? `${(absLat / 60).toFixed(1)}m` : `${(absLat / 3600).toFixed(1)}h`;
                        if (r.latency < 0) latStr = `-${latStr}`;
                    }
                    const latColor = r.latency !== null && r.latency < 0 ? 'color: #a78bfa;' : '';
                    const rmsStr = r.rms > 0 ? r.rms.toFixed(1) : '-';
                    const gapStr = r.gaps > 0 ? `<span style="color:#ff9800;">${r.gaps}</span>` : '0';
                    return `<tr class="clickable-row" data-station="${stKey}">
                        <td><strong>${stKey}</strong><br><span style="font-size:11px;color:var(--text-secondary);">${r.station.siteName}</span></td>
                        <td><span class="health-badge ${statusClass}">${statusLabel}</span></td>
                        <td>${r.channel}</td>
                        <td>${r.sampleRate > 0 ? r.sampleRate + ' sps' : '-'}</td>
                        <td style="${latColor}">${latStr}</td>
                        <td>${gapStr}</td>
                        <td>${rmsStr}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        </div>
    `;

    // Status filter badges
    container.querySelectorAll('.health-badge[data-filter]').forEach(badge => {
        badge.addEventListener('click', () => {
            healthStatusFilter = badge.dataset.filter || null;
            const searchInput = document.getElementById('healthSearch');
            renderHealthTable(healthResults, searchInput ? searchInput.value : '');
        });
    });

    // Sort on header click
    container.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (healthSortCol === col) { healthSortAsc = !healthSortAsc; }
            else { healthSortCol = col; healthSortAsc = true; }
            const searchInput = document.getElementById('healthSearch');
            renderHealthTable(healthResults, searchInput ? searchInput.value : '');
        });
    });

    // Click row to navigate to station waveforms
    container.querySelectorAll('.clickable-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
            const stCode = row.dataset.station;
            if (stCode) {
                const waveTab = document.querySelector('[data-view="waveforms"]');
                if (waveTab) waveTab.click();
                selectStation(stCode);
            }
        });
    });
}

// Single streamlined QC scan
async function runHealthScan() {
    const container = document.getElementById('health-table-container');
    const btn = document.getElementById('healthScanBtn');
    const durationSelect = document.getElementById('healthDuration');
    const duration = parseInt(durationSelect?.value || '3600');
    const durLabels = { 300: '5 min', 1800: '30 min', 3600: '1 hr', 21600: '6 hr', 86400: '24 hr' };
    const label = durLabels[duration] || `${duration}s`;

    btn.disabled = true;
    btn.textContent = 'Scanning...';

    container.innerHTML = `
        <div class="health-scanning">
            <div class="spinner"></div>
            <p>Scanning ${state.stations.length} stations (${label} window)...</p>
        </div>
    `;

    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: duration });
    healthResults = [];

    // Adaptive batch size: shorter windows can handle more parallel requests
    const batchSize = duration <= 1800 ? 10 : duration <= 21600 ? 5 : 2;

    for (let i = 0; i < state.stations.length; i += batchSize) {
        const batch = state.stations.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (station) => {
            try {
                const dsQuery = configureQuery(new sp.fdsndataselect.DataSelectQuery())
                    .networkCode(station.network)
                    .stationCode(station.code)
                    .channelCode('??Z')
                    .startTime(startTime)
                    .endTime(endTime)
                    .nodata(404);

                const records = await dsQuery.queryDataRecords();
                if (!records || records.length === 0) {
                    return { station, status: 'nodata', latency: null, gaps: 0, rms: 0, channel: '-', sampleRate: 0 };
                }

                const seismograms = sp.miniseed.seismogramPerChannel(records);
                if (seismograms.length === 0) {
                    return { station, status: 'nodata', latency: null, gaps: 0, rms: 0, channel: '-', sampleRate: 0 };
                }

                const zSeis = seismograms[0];
                // Use current time (not query endTime) for accurate latency
                const nowMs = sp.luxon.DateTime.utc().toMillis();
                const latencySec = (nowMs - zSeis.endTime.toMillis()) / 1000;
                const gaps = zSeis.segments ? zSeis.segments.length - 1 : 0;

                let rms = 0;
                try {
                    if (zSeis.isContiguous && zSeis.isContiguous()) {
                        const y = zSeis.y, n = y.length;
                        if (n > 0) {
                            let sum = 0, sumSq = 0;
                            for (let j = 0; j < n; j++) sum += y[j];
                            const mean = sum / n;
                            for (let j = 0; j < n; j++) sumSq += (y[j] - mean) ** 2;
                            rms = Math.sqrt(sumSq / n);
                        }
                    }
                } catch (e) { /* ignore */ }

                let status;
                if (latencySec < -10) {
                    // Significantly negative = station clock ahead of server
                    status = 'clockoff';
                } else if (latencySec >= 600) {
                    status = 'bad';
                } else if (latencySec >= 120) {
                    status = 'warn';
                } else if (gaps > 0) {
                    status = 'gappy';
                } else {
                    status = 'good';
                }
                return { station, status, latency: latencySec, gaps, rms, channel: zSeis.channelCode, sampleRate: zSeis.sampleRate };
            } catch (err) {
                return { station, status: 'error', latency: null, gaps: 0, rms: 0, channel: '-', sampleRate: 0 };
            }
        }));
        healthResults.push(...batchResults);

        const progress = Math.min(100, Math.round((i + batchSize) / state.stations.length * 100));
        const scanningEl = container.querySelector('.health-scanning p');
        if (scanningEl) scanningEl.textContent = `Scanning... ${progress}% (${Math.min(i + batchSize, state.stations.length)}/${state.stations.length})`;
    }

    healthSortCol = 'status';
    healthSortAsc = true;
    renderHealthTable(healthResults, '');

    btn.disabled = false;
    btn.textContent = 'Scan';
    console.log(`Health scan complete: ${healthResults.length} stations, ${label} window`);
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
        case 'spectrogram':
            fetchSpectrogramData();
            break;
    }
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
