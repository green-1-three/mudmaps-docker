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
    segments: { type: 'FeatureCollection', features: [] },
    forwardOffsets: { type: 'FeatureCollection', features: [] },
    reverseOffsets: { type: 'FeatureCollection', features: [] }
};

// Map load event - add sources and layers
map.on('load', () => {
    // Add sources
    map.addSource('segments', { type: 'geojson', data: geojsonData.segments });
    map.addSource('forward-offsets', { type: 'geojson', data: geojsonData.forwardOffsets });
    map.addSource('reverse-offsets', { type: 'geojson', data: geojsonData.reverseOffsets });

    // Add forward offset layer
    map.addLayer({
        id: 'forward-offsets',
        type: 'line',
        source: 'forward-offsets',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 3
        }
    });

    // Add reverse offset layer
    map.addLayer({
        id: 'reverse-offsets',
        type: 'line',
        source: 'reverse-offsets',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 3
        }
    });

    // Add segments layer (on top)
    map.addLayer({
        id: 'segments',
        type: 'line',
        source: 'segments',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 4
        }
    });

    // Load data after map is ready
    loadAllData();
});

// Load segments
async function loadSegments() {
    try {
        const url = `${API_BASE}/segments?municipality=pomfret-vt&all=true`;
        console.log(`🛣️  Fetching segments from: ${url}`);

        const data = await fetchJSON(url);
        console.log(`✅ Segments loaded`);

        if (!data.features || data.features.length === 0) {
            console.log('⚠️ No segments in response');
            return;
        }

        const segmentFeatures = [];
        const forwardOffsetFeatures = [];
        const reverseOffsetFeatures = [];

        data.features.forEach(segment => {
            if (!segment.geometry || !segment.geometry.coordinates) {
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

            // Filter by time range
            if (lastPlowedISO) {
                const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
                const plowTime = new Date(lastPlowedISO).getTime();
                if (plowTime < cutoffTime) {
                    return;
                }
            }

            // Add segment
            segmentFeatures.push({
                type: 'Feature',
                geometry: segment.geometry,
                properties: {
                    color: getColorByAge(lastPlowedISO)
                }
            });

            // Add forward offset
            if (segment.vertices_forward && segment.vertices_forward.coordinates && segment.properties.last_plowed_forward) {
                const fwdCutoff = Date.now() - (currentTimeHours * 60 * 60 * 1000);
                const fwdTime = new Date(segment.properties.last_plowed_forward).getTime();

                if (fwdTime >= fwdCutoff) {
                    forwardOffsetFeatures.push({
                        type: 'Feature',
                        geometry: segment.vertices_forward,
                        properties: {
                            color: getColorByAge(segment.properties.last_plowed_forward)
                        }
                    });
                }
            }

            // Add reverse offset
            if (segment.vertices_reverse && segment.vertices_reverse.coordinates && segment.properties.last_plowed_reverse) {
                const revCutoff = Date.now() - (currentTimeHours * 60 * 60 * 1000);
                const revTime = new Date(segment.properties.last_plowed_reverse).getTime();

                if (revTime >= revCutoff) {
                    reverseOffsetFeatures.push({
                        type: 'Feature',
                        geometry: segment.vertices_reverse,
                        properties: {
                            color: getColorByAge(segment.properties.last_plowed_reverse)
                        }
                    });
                }
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

        console.log(`📊 Segments: ${segmentFeatures.length} total`);
        console.log(`📊 Offset geometries: ${forwardOffsetFeatures.length} forward, ${reverseOffsetFeatures.length} reverse`);
    } catch (err) {
        console.error('Failed to load segments:', err);
    }
}

// Load all data
async function loadAllData() {
    try {
        await loadSegments();

        // Fit to bounds if we have features
        if (geojsonData.segments.features.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();

            geojsonData.segments.features.forEach(feature => {
                if (feature.geometry.type === 'LineString') {
                    feature.geometry.coordinates.forEach(coord => bounds.extend(coord));
                }
            });

            map.fitBounds(bounds, { padding: 50, maxZoom: 16 });
        }
    } catch (err) {
        console.error('Failed to load data:', err);
    }
}

// Create simple time slider UI
function createUI() {
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
