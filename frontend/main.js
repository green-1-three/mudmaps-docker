import './style.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';
import { Feature } from 'ol';
import { Point, LineString } from 'ol/geom';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Icon, Stroke, Fill, Text } from 'ol/style';

// Configuration
let API_BASE = import.meta.env.VITE_API_BASE;

if (!API_BASE) {
    API_BASE = (window.location.hostname === 'localhost')
        ? 'http://localhost:3001'
        : '/api';
}

console.log('Using API_BASE:', API_BASE);

// Simple polyline decoder (Google's algorithm)
function decodePolyline(str, precision = 5) {
    let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null;
    const factor = Math.pow(10, precision);

    while (index < str.length) {
        // Decode latitude
        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += ((result & 1) ? ~(result >> 1) : (result >> 1));

        // Decode longitude
        byte = null; shift = 0; result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += ((result & 1) ? ~(result >> 1) : (result >> 1));

        coordinates.push([lng / factor, lat / factor]);
    }
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

// Map setup
const map = new Map({
    target: 'map',
    layers: [new TileLayer({ source: new OSM() })],
    view: new View({ center: fromLonLat([0, 0]), zoom: 2 })
});

// Vector sources for different layers
const pathsSource = new VectorSource();
const currentPositionsSource = new VectorSource();
const userLocationSource = new VectorSource();

// Add layers to map (order matters for display)
map.addLayer(new VectorLayer({
    source: pathsSource,
    zIndex: 1,
    style: createPathStyle
}));

map.addLayer(new VectorLayer({
    source: currentPositionsSource,
    zIndex: 2,
    style: createCurrentPositionStyle
}));

map.addLayer(new VectorLayer({
    source: userLocationSource,
    zIndex: 3,
    style: new Style({
        image: new Icon({
            anchor: [0.5, 1],
            src: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
            scale: 1.2
        })
    })
}));

// Function to get color based on time recency
function getColorByAge(timestamp) {
    const now = Date.now();
    const recordTime = new Date(timestamp).getTime();
    const ageMinutes = (now - recordTime) / (1000 * 60);

    if (ageMinutes < 5) return '#ff0000';     // Very recent - bright red
    if (ageMinutes < 30) return '#ff4500';   // Recent - orange red
    if (ageMinutes < 60) return '#ffa500';   // Somewhat recent - orange
    if (ageMinutes < 120) return '#ffff00';  // Old - yellow
    if (ageMinutes < 360) return '#90ee90';  // Older - light green
    return '#808080';                        // Very old - gray
}

// Style function for path segments
function createPathStyle(feature) {
    const timestamp = feature.get('timestamp');
    const color = timestamp ? getColorByAge(timestamp) : '#0066cc';

    return new Style({
        stroke: new Stroke({
            color: color,
            width: 3
        })
    });
}

// Style for current position markers
function createCurrentPositionStyle(feature) {
    const device = feature.get('device');
    const timestamp = feature.get('timestamp');
    const isVeryRecent = timestamp && (Date.now() - new Date(timestamp).getTime()) < 300000; // 5 minutes

    return new Style({
        image: new Icon({
            anchor: [0.5, 1],
            src: isVeryRecent
                ? 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
                : 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png',
            scale: 1.0
        }),
        text: new Text({
            text: device ? device.substring(0, 8) + '...' : 'Device',
            offsetY: -40,
            fill: new Fill({ color: 'black' }),
            stroke: new Stroke({ color: 'white', width: 2 }),
            font: '12px Arial'
        })
    });
}

// Function to create path segments from coordinate array
function createPathSegments(coordinates, minuteMarkers, deviceName) {
    const segments = [];

    if (coordinates.length < 2) return segments;

    // Create segments between consecutive points
    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];

        // Skip if coordinates are invalid
        if (!start || !end || start.length !== 2 || end.length !== 2) continue;

        // Find the timestamp for this segment (from minute markers)
        let segmentTimestamp = null;
        for (const marker of minuteMarkers) {
            if (marker.coord_index <= i + 1) {
                segmentTimestamp = marker.timestamp;
            } else {
                break;
            }
        }

        const segmentCoords = [
            fromLonLat(start),
            fromLonLat(end)
        ];

        const segmentFeature = new Feature({
            geometry: new LineString(segmentCoords),
            device: deviceName,
            timestamp: segmentTimestamp,
            segmentIndex: i
        });

        segments.push(segmentFeature);
    }

    return segments;
}

// Function to create simplified path (reduce coordinate density)
function simplifyCoordinates(coordinates, tolerance = 0.0001) {
    if (coordinates.length <= 2) return coordinates;

    const simplified = [coordinates[0]]; // Always keep first point

    for (let i = 1; i < coordinates.length - 1; i++) {
        const prev = coordinates[i - 1];
        const curr = coordinates[i];
        const next = coordinates[i + 1];

        // Calculate distance from current point to previous
        const dist = Math.sqrt(
            Math.pow(curr[0] - prev[0], 2) +
            Math.pow(curr[1] - prev[1], 2)
        );

        // Keep point if it's far enough from previous or if it's a direction change
        if (dist > tolerance || isDirectionChange(prev, curr, next)) {
            simplified.push(curr);
        }
    }

    simplified.push(coordinates[coordinates.length - 1]); // Always keep last point
    return simplified;
}

function isDirectionChange(prev, curr, next, threshold = 0.0001) {
    // Simple direction change detection
    const vec1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const vec2 = [next[0] - curr[0], next[1] - curr[1]];

    // Cross product to detect direction change
    const cross = vec1[0] * vec2[1] - vec1[1] * vec2[0];
    return Math.abs(cross) > threshold;
}

// Function to load and display paths
async function loadAndDisplayPaths() {
    try {
        console.log('Loading path data...');

        // Get path data from our new endpoint
        const data = await fetchJSON(`${API_BASE}/paths/encoded?hours=24`);

        console.log('Received data:', data);

        if (!data.devices || data.devices.length === 0) {
            console.log('No devices found');
            showStatus('No recent tracking data found');
            return;
        }

        // Clear existing features
        pathsSource.clear();
        currentPositionsSource.clear();

        let totalSegments = 0;

        data.devices.forEach(device => {
            console.log(`Processing device: ${device.device}`);
            console.log(`Coordinate count: ${device.coordinate_count}`);
            console.log(`Minute markers: ${device.minute_markers.length}`);
            console.log(`Has encoded_path: ${!!device.encoded_path}`);
            console.log(`Has raw_coordinates: ${!!device.raw_coordinates}`);

            let coordinates = null;

            // Try to use encoded_path first (from OSRM), then fall back to raw_coordinates
            if (device.encoded_path) {
                try {
                    coordinates = decodePolyline(device.encoded_path);
                    console.log(`✅ Decoded polyline: ${coordinates.length} points`);
                } catch (err) {
                    console.error('Failed to decode polyline:', err);
                }
            }

            // Fall back to raw coordinates if no encoded path or decoding failed
            if (!coordinates && device.raw_coordinates) {
                coordinates = device.raw_coordinates;
                console.log(`📍 Using raw coordinates: ${coordinates.length} points`);
            }

            if (coordinates && coordinates.length > 0) {
                // Simplify coordinates to reduce clutter (less aggressive for short trips)
                const simplified = simplifyCoordinates(coordinates, 0.000001); // More sensitive
                console.log(`Simplified from ${coordinates.length} to ${simplified.length} coordinates`);

                // Create path segments
                const segments = createPathSegments(simplified, device.minute_markers, device.device);
                console.log(`Created ${segments.length} path segments`);

                // Add segments to map
                segments.forEach(segment => {
                    pathsSource.addFeature(segment);
                });

                totalSegments += segments.length;

                // Add current position marker (last coordinate)
                const lastCoord = coordinates[coordinates.length - 1];
                if (lastCoord && lastCoord.length === 2) {
                    const currentPosFeature = new Feature({
                        geometry: new Point(fromLonLat(lastCoord)),
                        device: device.device,
                        timestamp: device.end_time,
                        type: 'current_position'
                    });

                    currentPositionsSource.addFeature(currentPosFeature);
                }
            } else {
                console.log(`❌ No usable coordinates for device ${device.device}`);
            }
        });

        console.log(`Total segments added to map: ${totalSegments}`);

        // Fit map to show all paths
        if (pathsSource.getFeatures().length > 0) {
            const extent = pathsSource.getExtent();
            map.getView().fit(extent, {
                padding: [50, 50, 50, 50],
                maxZoom: 16,
                duration: 1000
            });
        }

        showStatus(`Loaded ${data.devices.length} device(s) with ${totalSegments} path segments`);

    } catch (err) {
        console.error('Failed to load paths:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// Create simple UI
function createUI() {
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'controls';
    controlsDiv.innerHTML = `
        <div class="control-panel">
            <h3>MudMaps - Path View</h3>
            
            <div class="control-group">
                <button onclick="window.refreshPaths()">Refresh Paths</button>
                <button onclick="window.fitAllPaths()">Fit All Paths</button>
            </div>
            
            <div class="legend">
                <div class="legend-title">Path Age Colors:</div>
                <div class="legend-item"><span class="color-box" style="background: #ff0000;"></span> < 5 min</div>
                <div class="legend-item"><span class="color-box" style="background: #ff4500;"></span> < 30 min</div>
                <div class="legend-item"><span class="color-box" style="background: #ffa500;"></span> < 1 hour</div>
                <div class="legend-item"><span class="color-box" style="background: #ffff00;"></span> < 2 hours</div>
                <div class="legend-item"><span class="color-box" style="background: #90ee90;"></span> < 6 hours</div>
                <div class="legend-item"><span class="color-box" style="background: #808080;"></span> > 6 hours</div>
            </div>
            
            <div class="status" id="status">
                Loading...
            </div>
        </div>
    `;

    document.body.appendChild(controlsDiv);
}

function showStatus(message) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.textContent = message;
    }
    console.log('Status:', message);
}

function fitAllPaths() {
    if (pathsSource.getFeatures().length > 0) {
        const extent = pathsSource.getExtent();
        map.getView().fit(extent, {
            padding: [50, 50, 50, 50],
            maxZoom: 16,
            duration: 1000
        });
    }
}

// Make functions available globally for button clicks
window.refreshPaths = loadAndDisplayPaths;
window.fitAllPaths = fitAllPaths;

// User geolocation (optional)
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition((pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        const projected = fromLonLat(coords);

        userLocationSource.clear();
        const user = new Feature({ geometry: new Point(projected) });
        userLocationSource.addFeature(user);

        console.log('User location added to map');
    }, (err) => {
        console.log('Geolocation not available:', err.message);
    }, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 300000
    });
}

// Map click handler for debugging
map.on('click', (event) => {
    const features = map.getFeaturesAtPixel(event.pixel);
    if (features.length > 0) {
        const feature = features[0];
        const device = feature.get('device');
        const timestamp = feature.get('timestamp');
        const segmentIndex = feature.get('segmentIndex');

        console.log('Clicked feature:', {
            device,
            timestamp,
            segmentIndex,
            type: feature.get('type')
        });

        if (device) {
            showStatus(`Device: ${device}, Time: ${timestamp ? new Date(timestamp).toLocaleString() : 'Unknown'}`);
        }
    }
});

// Initialize
console.log('🗺️ Initializing MudMaps Path View...');
createUI();
loadAndDisplayPaths();

// Auto-refresh every 2 minutes
setInterval(() => {
    console.log('Auto-refreshing paths...');
    loadAndDisplayPaths();
}, 120000);