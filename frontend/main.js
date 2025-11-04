import './style.css';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Configuration
let API_BASE = import.meta.env.VITE_API_BASE;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

if (!API_BASE) {
    API_BASE = (window.location.hostname === 'localhost')
        ? 'http://localhost:3001'
        : '/api';
}

console.log('Using API_BASE:', API_BASE);

mapboxgl.accessToken = MAPBOX_TOKEN;

// Discrete time intervals mapping: index -> hours
const TIME_INTERVALS = [1, 2, 4, 8, 24, 72, 168]; // 1h, 2h, 4h, 8h, 1d, 3d, 7d

// Global variable to store current time range
let currentTimeHours = 24;

// Polyline decoder with caching
const polylineCache = {};

function decodePolyline(str, precision = 5) {
    if (polylineCache[str]) {
        return polylineCache[str];
    }

    let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null;
    const factor = Math.pow(10, precision);

    while (index < str.length) {
        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));

        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));

        coordinates.push([lng / factor, lat / factor]);
    }

    polylineCache[str] = coordinates;
    return coordinates;
}

async function fetchJSON(url) {
    const r = await fetch(url);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok || !ct.includes('application/json')) {
        const head = await r.text().then(t => t.slice(0, 120)).catch(() => '');
        throw new Error(`Non-JSON from ${url} (${r.status}): ${head}`);
    }
    return r.json();
}

// Helper function to interpolate between two colors
function interpolateColor(color1, color2, factor) {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Function to get color based on time recency with smooth gradient
function getColorByAge(timestamp, maxHours = currentTimeHours) {
    const now = Date.now();
    const recordTime = new Date(timestamp).getTime();
    const ageMinutes = (now - recordTime) / (1000 * 60);
    const maxMinutes = maxHours * 60;

    if (ageMinutes >= maxMinutes) return '#808080';

    const position = ageMinutes / maxMinutes;

    const stops = [
        { position: 0.00, color: '#00ff00' },
        { position: 0.50, color: '#ffff00' },
        { position: 0.75, color: '#ff8800' },
        { position: 1.00, color: '#808080' }
    ];

    for (let i = 0; i < stops.length - 1; i++) {
        if (position >= stops[i].position && position <= stops[i + 1].position) {
            const rangeDuration = stops[i + 1].position - stops[i].position;
            const positionInRange = position - stops[i].position;
            const factor = positionInRange / rangeDuration;

            return interpolateColor(stops[i].color, stops[i + 1].color, factor);
        }
    }

    return '#00ff00';
}

// Initialize map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [0, 0],
    zoom: 2
});

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'top-left');

// GeoJSON data stores
const geojsonData = {
    boundary: { type: 'FeatureCollection', features: [] },
    polylines: { type: 'FeatureCollection', features: [] },
    segments: { type: 'FeatureCollection', features: [] },
    forwardOffsets: { type: 'FeatureCollection', features: [] },
    reverseOffsets: { type: 'FeatureCollection', features: [] },
    searchResult: { type: 'FeatureCollection', features: [] }
};

// Map load event - add sources and layers
map.on('load', () => {
    // Add sources
    map.addSource('boundary', { type: 'geojson', data: geojsonData.boundary });
    map.addSource('polylines', { type: 'geojson', data: geojsonData.polylines });
    map.addSource('segments', { type: 'geojson', data: geojsonData.segments });
    map.addSource('forward-offsets', { type: 'geojson', data: geojsonData.forwardOffsets });
    map.addSource('reverse-offsets', { type: 'geojson', data: geojsonData.reverseOffsets });
    map.addSource('search-result', { type: 'geojson', data: geojsonData.searchResult });

    // Add boundary layer
    map.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary',
        paint: {
            'fill-color': 'rgba(255, 255, 255, 0.02)',
            'fill-opacity': 1
        }
    });

    map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: {
            'line-color': 'rgba(255, 255, 255, 0.4)',
            'line-width': 2,
            'line-dasharray': [5, 5]
        }
    });

    // Add polylines layer
    map.addLayer({
        id: 'polylines',
        type: 'line',
        source: 'polylines',
        paint: {
            'line-color': '#4444ff',
            'line-width': 2
        }
    });

    // Add forward offset layer
    map.addLayer({
        id: 'forward-offsets',
        type: 'line',
        source: 'forward-offsets',
        paint: {
            'line-color': '#00ff00', // Will be updated dynamically
            'line-width': 3
        }
    });

    // Add reverse offset layer
    map.addLayer({
        id: 'reverse-offsets',
        type: 'line',
        source: 'reverse-offsets',
        paint: {
            'line-color': '#00ff00', // Will be updated dynamically
            'line-width': 3
        }
    });

    // Add segments layer
    map.addLayer({
        id: 'segments',
        type: 'line',
        source: 'segments',
        paint: {
            'line-color': '#00ff00', // Will be updated dynamically
            'line-width': 4
        }
    });

    // Add search result marker layer
    map.addLayer({
        id: 'search-result',
        type: 'circle',
        source: 'search-result',
        paint: {
            'circle-radius': 8,
            'circle-color': '#4264fb'
        }
    });

    // Load data after map is ready
    loadAllData();
});

// Click handlers
map.on('click', 'segments', (e) => {
    if (e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const lastPlowed = props.last_plowed ? new Date(props.last_plowed).toLocaleString() : 'Unknown';
        const info = `SEGMENT: ${props.street_name} - Last plowed: ${lastPlowed} (Device: ${props.device_id || 'Unknown'}, Total: ${props.plow_count_total || 0}x)`;
        showStatus(info);
        console.log('📍 Segment clicked:', info);
    }
});

map.on('click', 'polylines', (e) => {
    if (e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const startText = props.start_time ? new Date(props.start_time).toLocaleString() : 'Unknown';
        const endText = props.end_time ? new Date(props.end_time).toLocaleString() : 'Unknown';
        const info = `POLYLINE #${props.polyline_id || 'Unknown'} - Device: ${props.device || 'Unknown'}, Start: ${startText}, End: ${endText}`;
        showStatus(info);
        console.log('📍 Polyline clicked:', info);
    }
});

// Change cursor on hover
map.on('mouseenter', 'segments', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'segments', () => { map.getCanvas().style.cursor = ''; });
map.on('mouseenter', 'polylines', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'polylines', () => { map.getCanvas().style.cursor = ''; });

// Load boundary
async function loadBoundary() {
    try {
        showStatus('Loading boundary...');
        const url = `${API_BASE}/boundary?municipality=pomfret-vt`;
        console.log(`🗺️  Fetching boundary from: ${url}`);

        const data = await fetchJSON(url);
        console.log('✅ Boundary loaded:', data);

        if (!data.geometry || !data.geometry.coordinates) {
            console.warn('⚠️ Boundary missing geometry');
            return;
        }

        geojsonData.boundary.features = [{
            type: 'Feature',
            geometry: data.geometry,
            properties: data.properties
        }];

        if (map.getSource('boundary')) {
            map.getSource('boundary').setData(geojsonData.boundary);
        }

        console.log(`🗺️  Boundary loaded for ${data.properties.name}, ${data.properties.state}`);
    } catch (err) {
        console.error('Failed to load boundary:', err);
    }
}

// Load polylines
async function loadPolylines() {
    try {
        showStatus('Loading polylines...');
        const startTime = performance.now();

        const url = `${API_BASE}/paths/encoded?hours=168`;
        console.log(`🛣️  Fetching polylines from: ${url}`);

        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Polylines loaded in ${fetchTime.toFixed(0)}ms`);

        if (!data.devices || data.devices.length === 0) {
            console.log('⚠️ No devices/polylines in response');
            return;
        }

        const features = [];

        for (const device of data.devices) {
            if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: coords
                    },
                    properties: {
                        device: device.device,
                        start_time: device.start_time,
                        end_time: device.end_time,
                        type: 'polyline'
                    }
                });
            }

            if (device.batches && device.batches.length > 0) {
                for (const batch of device.batches) {
                    if (batch.success && batch.encoded_polyline) {
                        const coords = decodePolyline(batch.encoded_polyline);
                        features.push({
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                                coordinates: coords
                            },
                            properties: {
                                polyline_id: batch.id,
                                device: device.device,
                                start_time: batch.start_time,
                                end_time: batch.end_time,
                                bearing: batch.bearing,
                                confidence: batch.confidence,
                                type: 'polyline'
                            }
                        });
                    }
                }
            }

            if (device.raw_coordinates && device.raw_coordinates.length > 0) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: device.raw_coordinates
                    },
                    properties: {
                        device: device.device,
                        start_time: device.start_time,
                        end_time: device.end_time,
                        type: 'polyline',
                        raw: true
                    }
                });
            }
        }

        geojsonData.polylines.features = features;

        if (map.getSource('polylines')) {
            map.getSource('polylines').setData(geojsonData.polylines);
        }

        console.log(`📊 Loaded ${features.length} polylines`);
        showStatus(`Loaded ${features.length} polylines`);
    } catch (err) {
        console.error('Failed to load polylines:', err);
    }
}

// Load segments
async function loadSegments() {
    try {
        showStatus('Loading road segments...');
        const startTime = performance.now();

        const url = `${API_BASE}/segments?municipality=pomfret-vt&all=true`;
        console.log(`🛣️  Fetching segments from: ${url}`);

        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Segments loaded in ${fetchTime.toFixed(0)}ms`);

        if (!data.features || data.features.length === 0) {
            showStatus('No segments found');
            console.log('⚠️ No segments in response');
            return;
        }

        const segmentFeatures = [];
        const forwardOffsetFeatures = [];
        const reverseOffsetFeatures = [];

        data.features.forEach(segment => {
            if (!segment.geometry || !segment.geometry.coordinates) {
                console.warn('⚠️ Segment missing geometry:', segment);
                return;
            }

            const forwardTime = segment.properties.last_plowed_forward
                ? new Date(segment.properties.last_plowed_forward).getTime()
                : 0;
            const reverseTime = segment.properties.last_plowed_reverse
                ? new Date(segment.properties.last_plowed_reverse).getTime()
                : 0;
            const lastPlowed = Math.max(forwardTime, reverseTime);
            const lastPlowedISO = lastPlowed > 0 ? new Date(lastPlowed).toISOString() : null;
            const isActivated = lastPlowed > 0;

            // Skip inactive segments
            if (!isActivated) {
                return;
            }

            // Add segment
            segmentFeatures.push({
                type: 'Feature',
                geometry: segment.geometry,
                properties: {
                    segment_id: segment.id,
                    street_name: segment.properties.street_name,
                    road_classification: segment.properties.road_classification,
                    bearing: segment.properties.bearing,
                    last_plowed: lastPlowedISO,
                    last_plowed_forward: segment.properties.last_plowed_forward,
                    last_plowed_reverse: segment.properties.last_plowed_reverse,
                    device_id: segment.properties.device_id,
                    plow_count_today: segment.properties.plow_count_today,
                    plow_count_total: segment.properties.plow_count_total,
                    segment_length: segment.properties.segment_length,
                    is_activated: isActivated,
                    type: 'segment',
                    color: getColorByAge(lastPlowedISO)
                }
            });

            // Add forward offset
            if (segment.vertices_forward && segment.vertices_forward.coordinates) {
                forwardOffsetFeatures.push({
                    type: 'Feature',
                    geometry: segment.vertices_forward,
                    properties: {
                        segment_id: segment.id,
                        street_name: segment.properties.street_name,
                        last_plowed_forward: segment.properties.last_plowed_forward,
                        type: 'offset_forward',
                        color: segment.properties.last_plowed_forward
                            ? getColorByAge(segment.properties.last_plowed_forward)
                            : '#808080'
                    }
                });
            }

            // Add reverse offset
            if (segment.vertices_reverse && segment.vertices_reverse.coordinates) {
                reverseOffsetFeatures.push({
                    type: 'Feature',
                    geometry: segment.vertices_reverse,
                    properties: {
                        segment_id: segment.id,
                        street_name: segment.properties.street_name,
                        last_plowed_reverse: segment.properties.last_plowed_reverse,
                        type: 'offset_reverse',
                        color: segment.properties.last_plowed_reverse
                            ? getColorByAge(segment.properties.last_plowed_reverse)
                            : '#808080'
                    }
                });
            }
        });

        geojsonData.segments.features = segmentFeatures;
        geojsonData.forwardOffsets.features = forwardOffsetFeatures;
        geojsonData.reverseOffsets.features = reverseOffsetFeatures;

        if (map.getSource('segments')) {
            map.getSource('segments').setData(geojsonData.segments);
        }
        if (map.getSource('forward-offsets')) {
            map.getSource('forward-offsets').setData(geojsonData.forwardOffsets);
        }
        if (map.getSource('reverse-offsets')) {
            map.getSource('reverse-offsets').setData(geojsonData.reverseOffsets);
        }

        // Update layer colors using data-driven styling
        updateLayerColors();

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total segment load time: ${totalTime.toFixed(0)}ms`);
        console.log(`📊 Segments: ${segmentFeatures.length} total`);
        console.log(`📊 Offset geometries: ${forwardOffsetFeatures.length} forward, ${reverseOffsetFeatures.length} reverse`);

        showStatus(`Loaded ${segmentFeatures.length} segments (${forwardOffsetFeatures.length} offset geometries)`);
    } catch (err) {
        console.error('Failed to load segments:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// Update layer colors with data-driven styling
function updateLayerColors() {
    // Segments color
    map.setPaintProperty('segments', 'line-color', ['get', 'color']);

    // Forward offsets color
    map.setPaintProperty('forward-offsets', 'line-color', ['get', 'color']);

    // Reverse offsets color
    map.setPaintProperty('reverse-offsets', 'line-color', ['get', 'color']);
}

// Load all data
async function loadAllData() {
    try {
        showStatus('Loading map data...');

        await Promise.all([
            loadBoundary(),
            loadPolylines(),
            loadSegments()
        ]);

        // Fit to bounds if we have features
        if (geojsonData.segments.features.length > 0 || geojsonData.polylines.features.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();

            [...geojsonData.segments.features, ...geojsonData.polylines.features].forEach(feature => {
                if (feature.geometry.type === 'LineString') {
                    feature.geometry.coordinates.forEach(coord => bounds.extend(coord));
                }
            });

            map.fitBounds(bounds, { padding: 50, maxZoom: 16 });
        }

        const polylineCount = geojsonData.polylines.features.length;
        const segmentCount = geojsonData.segments.features.length;
        showStatus(`Loaded ${polylineCount} polylines, ${segmentCount} segments`);
    } catch (err) {
        console.error('Failed to load data:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// UI Functions
function createUI() {
    // Search bar (top-left)
    const searchDiv = document.createElement('div');
    searchDiv.id = 'search-bar';
    searchDiv.innerHTML = `
        <div class="search-input-wrapper">
            <span class="search-icon">🔍</span>
            <input type="text" id="addressSearch" placeholder="Search address...">
        </div>
        <div id="searchResults" class="search-results"></div>
    `;
    document.body.appendChild(searchDiv);

    // Control panel (top-right)
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'controls';
    controlsDiv.innerHTML = `
        <div class="control-panel">
            <h3>Latest Snowplow Activity</h3>

            <div class="control-group">
                <label for="timeRange">Time Range:</label>
                <input type="range" id="timeRange" min="0" max="6" value="4" step="1">
                <div class="time-display">
                    <span id="timeValue">Last 1 day</span>
                </div>
            </div>

            <div class="legend">
                <div class="legend-title">Segment Age:</div>
                <div class="gradient-bar"></div>
                <div class="gradient-labels">
                    <span id="gradientLeft">Now</span>
                    <span id="gradientCenter">12 hours</span>
                    <span id="gradientRight">1 day</span>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(controlsDiv);

    setupTimeSlider();
    setupAddressSearch();
}

function setupTimeSlider() {
    const slider = document.getElementById('timeRange');

    slider.addEventListener('input', (e) => {
        const index = parseInt(e.target.value);
        const hours = TIME_INTERVALS[index];
        updateTimeDisplay(hours);
        currentTimeHours = hours;

        // Reload and update colors
        loadSegments();
    });
}

function setupAddressSearch() {
    const searchInput = document.getElementById('addressSearch');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
                performAddressSearch(query);
            }
        }
    });

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();

        if (query.length < 1) {
            searchResults.innerHTML = '';
            return;
        }

        searchTimeout = setTimeout(() => {
            performAddressSearch(query);
        }, 200);
    });
}

async function performAddressSearch(query) {
    const searchResults = document.getElementById('searchResults');
    searchResults.innerHTML = '<div class="search-loading">Searching...</div>';

    try {
        const center = map.getCenter();

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
            `access_token=${MAPBOX_TOKEN}&` +
            `proximity=${center.lng},${center.lat}&` +
            `country=US&` +
            `limit=5&` +
            `autocomplete=true`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Search failed');
        }

        const data = await response.json();
        const results = data.features || [];

        if (results.length === 0) {
            searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
            return;
        }

        searchResults.innerHTML = results.map((result, index) => `
            <div class="search-result-item" data-index="${index}">
                <div class="result-name">${result.place_name}</div>
            </div>
        `).join('');

        searchResults.querySelectorAll('.search-result-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                const result = results[index];
                showSearchResult(result);
                searchResults.innerHTML = '';
            });
        });

    } catch (err) {
        console.error('Address search failed:', err);
        searchResults.innerHTML = '<div class="search-error">Search failed. Please try again.</div>';
    }
}

function showSearchResult(result) {
    const [lng, lat] = result.center;

    geojsonData.searchResult.features = [{
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [lng, lat]
        },
        properties: {
            name: result.place_name
        }
    }];

    if (map.getSource('search-result')) {
        map.getSource('search-result').setData(geojsonData.searchResult);
    }

    const searchInput = document.getElementById('addressSearch');
    if (searchInput) {
        searchInput.value = result.place_name;
    }

    map.flyTo({
        center: [lng, lat],
        zoom: 16,
        duration: 1000
    });

    console.log(`📍 Searched location: ${result.place_name}`);
}

function formatTimeLabel(minutes) {
    if (minutes < 60) {
        return `${minutes} min`;
    } else if (minutes < 1440) {
        const hours = Math.round(minutes / 60);
        return hours === 1 ? '1 hour' : `${hours} hours`;
    } else {
        const days = Math.round(minutes / 1440);
        return days === 1 ? '1 day' : `${days} days`;
    }
}

function updateGradientLabels(hours) {
    const leftLabel = document.getElementById('gradientLeft');
    const centerLabel = document.getElementById('gradientCenter');
    const rightLabel = document.getElementById('gradientRight');

    if (leftLabel) leftLabel.textContent = 'Now';

    const centerMinutes = (hours * 60) / 2;
    if (centerLabel) centerLabel.textContent = formatTimeLabel(centerMinutes);

    const rightMinutes = hours * 60;
    if (rightLabel) rightLabel.textContent = formatTimeLabel(rightMinutes);
}

function updateTimeDisplay(hours) {
    const timeValue = document.getElementById('timeValue');

    if (hours === 1) {
        timeValue.textContent = 'Last 1 hour';
    } else if (hours === 2) {
        timeValue.textContent = 'Last 2 hours';
    } else if (hours === 4) {
        timeValue.textContent = 'Last 4 hours';
    } else if (hours === 8) {
        timeValue.textContent = 'Last 8 hours';
    } else if (hours === 24) {
        timeValue.textContent = 'Last 1 day';
    } else if (hours === 72) {
        timeValue.textContent = 'Last 3 days';
    } else if (hours === 168) {
        timeValue.textContent = 'Last 7 days';
    }

    updateGradientLabels(hours);
}

function showStatus(message) {
    console.log(message);
}

// User geolocation
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition((pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        console.log('User location:', coords);

        map.setCenter(coords);
        map.setZoom(13);
    }, (error) => {
        console.warn('Geolocation error:', error.message);
    }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
}

// Initialize
console.log('🗺️ Initializing MudMaps with Mapbox GL...');
createUI();
updateGradientLabels(currentTimeHours);
