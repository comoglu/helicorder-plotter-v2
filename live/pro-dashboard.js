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
    enabled: urlParams.has('events') ? urlParams.get('events') === 'true' : false,
    minMagnitude: parseFloat(urlParams.get('minmag') || '3.0'),
    maxRadius: parseFloat(urlParams.get('maxradius') || '20'), // degrees
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

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'eventToggleBtn';
    toggleBtn.className = 'status-badge';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.border = 'none';
    toggleBtn.innerHTML = `
        <span style="font-size: 14px;">Events</span>
        <span id="event-count-badge" style="background: #ef4444; color: white; border-radius: 10px; padding: 1px 6px; font-size: 11px; display: none;"></span>
    `;

    if (EVENT_CONFIG.enabled) {
        toggleBtn.style.background = 'rgba(74, 158, 255, 0.3)';
    }

    toggleBtn.addEventListener('click', async () => {
        EVENT_CONFIG.enabled = !EVENT_CONFIG.enabled;
        toggleBtn.style.background = EVENT_CONFIG.enabled
            ? 'rgba(74, 158, 255, 0.3)'
            : 'rgba(255,255,255,0.1)';

        if (EVENT_CONFIG.enabled && state.events.length === 0) {
            await fetchEvents();
        }

        // Refresh current view to show/hide markers
        if (state.isMonitoring && state.selectedStation) {
            fetchDataForCurrentView();
        }
    });

    // Insert before the start button
    const startBtn = document.getElementById('startBtn');
    headerControls.insertBefore(toggleBtn, startBtn);
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

        // Update subtitle with sample rate and channel info
        const subtitle = document.getElementById('waveform-subtitle');
        if (subtitle) {
            const info = validSeismograms.map(s => `${s.channelCode} ${s.sampleRate} sps`).join(', ');
            subtitle.textContent = `${station.siteName} | ${info} (linked zoom/pan)`;
        }

        // Convert to SeismogramDisplayData and apply filters
        const displayDataList = validSeismograms.map(seis => {
            let sdd = sp.seismogram.SeismogramDisplayData.fromSeismogram(seis);
            sdd = applyFilter(sdd);
            return sdd;
        });

        // If events enabled, attach quakes and travel time markers
        // If events enabled, attach quakes and travel time markers
        if (EVENT_CONFIG.enabled && state.events.length > 0 && station.latitude && station.longitude) {
            for (const sdd of displayDataList) {
                sdd.addQuake(state.events);
            }
            // Fetch travel times for each event (in parallel)
            const ttPromises = state.events.map(async (quake) => {
                try {
                    if (!quake.hasPreferredOrigin()) return;
                    const distDeg = sp.distaz.distaz(
                        station.latitude, station.longitude,
                        quake.latitude, quake.longitude
                    ).delta;
                    const ttQuery = new sp.traveltime.TraveltimeQuery()
                        .distdeg(distDeg)
                        .evdepth(quake.depthKm || 10)
                        .phases('P,S,p,s,Pn,Sn');
                    const ttResult = await ttQuery.queryJson();
                    if (ttResult && ttResult.arrivals) {
                        // Use seisplotjs marker helpers
                        const markers = sp.seismographmarker.createMarkersForTravelTimes(quake, ttResult);
                        for (const sdd of displayDataList) {
                            for (const marker of markers) {
                                if (sdd.timeRange.contains(marker.time)) {
                                    sdd.markerList.push(marker);
                                }
                            }
                        }
                    }
                } catch (ttErr) {
                    console.warn('Travel time query failed:', ttErr.message);
                }
            });
            await Promise.all(ttPromises);
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

        console.log(`✅ Helicorder displayed for ${hours} hours`);

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
        const spectraPlot = new sp.spectraplot.SpectraPlot(fftResults);
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

    const duration = state.spectrogramDuration || 600;
    const endTime = sp.luxon.DateTime.utc();
    const startTime = endTime.minus({ seconds: duration });
    const channelCode = state.spectrogramChannel || '??Z';

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

    // Max frequency clipping
    const maxFreqSetting = parseFloat(document.getElementById('sg-max-freq')?.value || '0');
    const nyquist = sampleRate / 2;
    const displayMaxFreq = (maxFreqSetting > 0 && maxFreqSetting < nyquist) ? maxFreqSetting : nyquist;
    const displayBins = Math.ceil((displayMaxFreq / nyquist) * numFreqBins);

    // Build magnitude matrix and find min/max for color scaling
    const magnitudes = [];
    let maxMag = -Infinity;
    let minMag = Infinity;

    for (let t = 0; t < numTimeSteps; t++) {
        const [amp] = stftResults[t].asAmpPhase();
        magnitudes[t] = [];

        for (let f = 0; f < displayBins; f++) {
            const mag = 20 * Math.log10(amp[f] + 1e-10); // dB scale
            magnitudes[t][f] = mag;
            if (mag > maxMag) maxMag = mag;
            if (mag < minMag) minMag = mag;
        }
    }

    console.log(`Magnitude range: ${minMag.toFixed(1)} to ${maxMag.toFixed(1)} dB | Display: 0-${displayMaxFreq} Hz (${displayBins}/${numFreqBins} bins)`);

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

    const maxFreq = displayMaxFreq;
    const freqTicks = 6;
    for (let i = 0; i <= freqTicks; i++) {
        const freq = (maxFreq * i) / freqTicks;
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

// Draw color scale legend
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
