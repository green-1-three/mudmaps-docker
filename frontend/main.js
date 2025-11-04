import './style.css';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { updateTimeDisplay, updateGradientLabels } from './dev-common.js';

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

// Function to abbreviate street names for labels
function abbreviateStreetName(name) {
    if (!name) return name;

    return name
        .replace(/\bRoad\b/gi, 'Rd')
        .replace(/\bStreet\b/gi, 'St')
        .replace(/\bAvenue\b/gi, 'Ave')
        .replace(/\bBoulevard\b/gi, 'Blvd')
        .replace(/\bDrive\b/gi, 'Dr')
        .replace(/\bLane\b/gi, 'Ln')
        .replace(/\bCourt\b/gi, 'Ct')
        .replace(/\bCircle\b/gi, 'Cir')
        .replace(/\bPlace\b/gi, 'Pl')
        .replace(/\bTerrace\b/gi, 'Ter')
        .replace(/\bParkway\b/gi, 'Pkwy')
        .replace(/\bHighway\b/gi, 'Hwy')
        .replace(/\bNorth\b/gi, 'N')
        .replace(/\bSouth\b/gi, 'S')
        .replace(/\bEast\b/gi, 'E')
        .replace(/\bWest\b/gi, 'W');
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
    reverseOffsets: { type: 'FeatureCollection', features: [] },
    allSegmentsLabels: { type: 'FeatureCollection', features: [] } // For showing all road names
};

// Update zoom level display
map.on('zoom', () => {
    const zoomLevel = map.getZoom().toFixed(1);
    const zoomDisplay = document.getElementById('zoom-display');
    if (zoomDisplay) {
        zoomDisplay.textContent = `Zoom: ${zoomLevel}`;
    }
});

// Map load event - add sources and layers
map.on('load', () => {
    // Hide all label layers from the base map
    const style = map.getStyle();
    style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
    });

    // Add sources
    map.addSource('segments', { type: 'geojson', data: geojsonData.segments });
    map.addSource('forward-offsets', { type: 'geojson', data: geojsonData.forwardOffsets });
    map.addSource('reverse-offsets', { type: 'geojson', data: geojsonData.reverseOffsets });
    map.addSource('all-segments-labels', { type: 'geojson', data: geojsonData.allSegmentsLabels });

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

    // Add segment street name labels (offset to the side) - uses all segments for complete road coverage
    map.addLayer({
        id: 'segment-labels',
        type: 'symbol',
        source: 'all-segments-labels',
        layout: {
            'text-field': ['get', 'street_name'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
            'text-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 7,   // At zoom 10, size is 7px
                12, 7,   // At zoom 12, size is 7px
                13, 8,   // At zoom 13, size is 8px
                15, 12,  // At zoom 15, size is 12px
                16, 14,  // At zoom 16, size is 14px
                18, 16   // At zoom 18, size is 16px
            ],
            'symbol-placement': 'line',
            'text-rotation-alignment': 'map',
            'text-pitch-alignment': 'viewport',
            'text-offset': [0, 1], // Offset 1 em to the side
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-max-angle': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 25,  // At low zoom, allow 25 degrees
                13, 30,  // At zoom 13, allow 30 degrees (most permissive)
                14, 20   // At zoom 14+, restrict to 20 degrees
            ],
            'text-keep-upright': true, // Prevent upside-down labels
            'symbol-spacing': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 100,  // At low zoom, 100px spacing (more labels)
                13, 100,  // At zoom 13, still 100px
                14, 150   // At zoom 14+, 150px spacing
            ],
            'text-padding': 10 // Add padding around labels to prevent overlap
        },
        paint: {
            'text-color': '#333333',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
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
        const allSegmentsLabelFeatures = [];

        data.features.forEach(segment => {
            if (!segment.geometry || !segment.geometry.coordinates) {
                return;
            }

            // Add ALL segments to labels collection (for showing all road names)
            if (segment.properties.street_name) {
                allSegmentsLabelFeatures.push({
                    type: 'Feature',
                    geometry: segment.geometry,
                    properties: {
                        street_name: abbreviateStreetName(segment.properties.street_name)
                    }
                });
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

            // Skip inactive segments for display (but not for labels - already added above)
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
        geojsonData.allSegmentsLabels.features = allSegmentsLabelFeatures;

        if (map.getSource('segments')) {
            map.getSource('segments').setData(geojsonData.segments);
        }
        if (map.getSource('forward-offsets')) {
            map.getSource('forward-offsets').setData(geojsonData.forwardOffsets);
        }
        if (map.getSource('reverse-offsets')) {
            map.getSource('reverse-offsets').setData(geojsonData.reverseOffsets);
        }
        if (map.getSource('all-segments-labels')) {
            map.getSource('all-segments-labels').setData(geojsonData.allSegmentsLabels);
        }

        console.log(`📊 Segments: ${segmentFeatures.length} total`);
        console.log(`📊 Road labels: ${allSegmentsLabelFeatures.length} total`);
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
