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
const unmatchedPathsSource = new VectorSource();  // NEW: Separate layer for unmatched segments
const currentPositionsSource = new VectorSource();
const userLocationSource = new VectorSource();

// Add layers to map (order matters for display)
map.addLayer(new VectorLayer({
    source: pathsSource,
    zIndex: 1,
    style: createPathStyle
}));

// NEW: Unmatched paths layer with different styling
map.addLayer(new VectorLayer({
    source: unmatchedPathsSource,
    zIndex: 0,
    style: createUnmatchedPathStyle
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

// NEW: Style for unmatched path segments (dashed, thinner, more transparent)
function createUnmatchedPathStyle(feature) {
    const timestamp = feature.get('timestamp');
    const baseColor = timestamp ? getColorByAge(timestamp) : '#0066cc';

    // Make it semi-transparent
    const colorWithAlpha = baseColor + '80'; // Add 50% opacity

    return new Style({
        stroke: new Stroke({
            color: colorWithAlpha,
            width: 2,
            lineDash: [5, 5]  // Dashed line to indicate unmatched
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
function createPathSegments(coordinates, minuteMarkers, deviceName, isMatched = true) {
    const segments = [];

    if (coordinates.length < 2) return segments;

    // Create segments between consecutive points
    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];

        // Skip if coordinates are invalid
        if (!start || !end || start.length !== 2 || end.length !== 2) continue;

        // NEW: For unmatched segments, filter out large gaps (likely GPS jumps)
        if (!isMatched) {
            const distance = Math.sqrt(
                Math.pow(end[0] - start[0], 2) +
                Math.pow(end[1] - start[1], 2)
            );

            // Skip segments longer than ~0.01 degrees (~1km)
            // These are likely GPS jumps, not actual travel
            if (distance > 0.01) {
                console.log(`Skipping large gap: ${distance.toFixed(4)} degrees`);
                continue;
            }
        }

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
            segmentIndex: i,
            isMatched: isMatched
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

// IMPROVED: Function to load and display paths with batch support
async function loadAndDisplayPaths() {
    try {
        console.log('Loading path data...');

        // Clear existing features
        pathsSource.clear();
        unmatchedPathsSource.clear();
        currentPositionsSource.clear();

        // Get path data from our new endpoint using current time range
        const data = await fetchJSON(`${API_BASE}/paths/encoded?hours=${currentTimeHours}`);

        if (!data.devices || data.devices.length === 0) {
            showStatus('No devices found in selected time range');
            return;
        }

        console.log(`Received data for ${data.devices.length} device(s)`);

        let totalMatchedSegments = 0;
        let totalUnmatchedSegments = 0;

        data.devices.forEach(device => {
            console.log(`\n=== Processing device: ${device.device} ===`);
            console.log(`Coordinates: ${device.coordinate_count}, Time: ${device.start_time} to ${device.end_time}`);

            // NEW: Handle batched results
            if (device.batches) {
                console.log(`Device has ${device.total_batches} batches (${device.matched_batches} matched, ${device.coverage} coverage)`);

                device.batches.forEach((batch, batchIndex) => {
                    let coordinates = null;
                    let isMatched = batch.success;

                    if (batch.success && batch.encoded_polyline) {
                        // Successfully matched batch
                        try {
                            coordinates = decodePolyline(batch.encoded_polyline);
                            console.log(`✅ Batch ${batchIndex + 1}: Decoded ${coordinates.length} matched points`);
                        } catch (err) {
                            console.error(`Failed to decode batch ${batchIndex + 1}:`, err);
                            coordinates = batch.raw_coordinates;
                            isMatched = false;
                        }
                    } else if (batch.raw_coordinates) {
                        // Unmatched batch - use raw coordinates
                        coordinates = batch.raw_coordinates;
                        console.log(`⚠️  Batch ${batchIndex + 1}: Using ${coordinates.length} raw points (unmatched)`);
                    }

                    if (coordinates && coordinates.length > 0) {
                        // Create segments for this batch
                        const segments = createPathSegments(
                            coordinates,
                            device.minute_markers,
                            device.device,
                            isMatched
                        );

                        // Add to appropriate layer
                        const targetSource = isMatched ? pathsSource : unmatchedPathsSource;
                        segments.forEach(segment => targetSource.addFeature(segment));

                        if (isMatched) {
                            totalMatchedSegments += segments.length;
                        } else {
                            totalUnmatchedSegments += segments.length;
                        }

                        console.log(`Added ${segments.length} ${isMatched ? 'matched' : 'unmatched'} segments from batch ${batchIndex + 1}`);
                    }
                });
            }
            // Handle single encoded path (legacy support)
            else if (device.encoded_path) {
                try {
                    const coordinates = decodePolyline(device.encoded_path);
                    console.log(`✅ Decoded polyline: ${coordinates.length} points`);

                    const simplified = simplifyCoordinates(coordinates, 0.000001);
                    const segments = createPathSegments(simplified, device.minute_markers, device.device, true);

                    segments.forEach(segment => pathsSource.addFeature(segment));
                    totalMatchedSegments += segments.length;

                    console.log(`Added ${segments.length} matched segments`);
                } catch (err) {
                    console.error('Failed to decode polyline:', err);
                }
            }
            // Handle raw coordinates fallback
            else if (device.raw_coordinates) {
                console.log(`⚠️  Using ${device.raw_coordinates.length} raw coordinates (OSRM failed: ${device.osrm_error})`);

                const segments = createPathSegments(
                    device.raw_coordinates,
                    device.minute_markers,
                    device.device,
                    false  // Mark as unmatched
                );

                segments.forEach(segment => unmatchedPathsSource.addFeature(segment));
                totalUnmatchedSegments += segments.length;

                console.log(`Added ${segments.length} unmatched segments`);
            }

            // Add current position marker (using last coordinate from any available source)
            let lastCoord = null;
            if (device.batches) {
                // Find last coordinate from last successful batch
                for (let i = device.batches.length - 1; i >= 0; i--) {
                    const batch = device.batches[i];
                    if (batch.encoded_polyline) {
                        const coords = decodePolyline(batch.encoded_polyline);
                        lastCoord = coords[coords.length - 1];
                        break;
                    } else if (batch.raw_coordinates) {
                        lastCoord = batch.raw_coordinates[batch.raw_coordinates.length - 1];
                        break;
                    }
                }
            } else if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                lastCoord = coords[coords.length - 1];
            } else if (device.raw_coordinates) {
                lastCoord = device.raw_coordinates[device.raw_coordinates.length - 1];
            }

            if (lastCoord && lastCoord.length === 2) {
                const currentPosFeature = new Feature({
                    geometry: new Point(fromLonLat(lastCoord)),
                    device: device.device,
                    timestamp: device.end_time,
                    type: 'current_position'
                });

                currentPositionsSource.addFeature(currentPosFeature);
            }
        });

        const totalSegments = totalMatchedSegments + totalUnmatchedSegments;
        console.log(`\n=== Summary ===`);
        console.log(`Total segments: ${totalSegments} (${totalMatchedSegments} matched, ${totalUnmatchedSegments} unmatched)`);

        // Fit map to show all paths
        const allFeatures = [
            ...pathsSource.getFeatures(),
            ...unmatchedPathsSource.getFeatures()
        ];

        if (allFeatures.length > 0) {
            const extent = pathsSource.getExtent();
            map.getView().fit(extent, {
                padding: [50, 50, 50, 50],
                maxZoom: 16,
                duration: 1000
            });
        }

        showStatus(`Loaded ${data.devices.length} device(s): ${totalMatchedSegments} matched, ${totalUnmatchedSegments} unmatched segments`);

    } catch (err) {
        console.error('Failed to load paths:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// Global variable to store current time range
let currentTimeHours = 24;

// Create simple UI
function createUI() {
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'controls';
    controlsDiv.innerHTML = `
        <div class="control-panel">
            <h3>MudMaps - Path View</h3>
            
            <div class="control-group">
                <button onclick="window.refreshPaths()">Refresh Now</button>
                <button onclick="window.fitAllPaths()">Fit All Paths</button>
            </div>
            
            <div class="control-group">
                <label for="timeRange">Time Range:</label>
                <input type="range" id="timeRange" min="1" max="168" value="24" step="1">
                <div class="time-display">
                    <span id="timeValue">Last 24 hours</span>
                </div>
                <div class="time-presets">
                    <button onclick="setTimeRange(1)">1h</button>
                    <button onclick="setTimeRange(6)">6h</button>
                    <button onclick="setTimeRange(24)">1d</button>
                    <button onclick="setTimeRange(72)">3d</button>
                    <button onclick="setTimeRange(168)">1w</button>
                </div>
            </div>
            
            <div class="legend">
                <div class="legend-title">Path Age Colors:</div>
                <div class="legend-item"><span class="color-box" style="background: #ff0000;"></span> < 5 min</div>
                <div class="legend-item"><span class="color-box" style="background: #ff4500;"></span> < 30 min</div>
                <div class="legend-item"><span class="color-box" style="background: #ffa500;"></span> < 1 hour</div>
                <div class="legend-item"><span class="color-box" style="background: #ffff00;"></span> < 2 hours</div>
                <div class="legend-item"><span class="color-box" style="background: #90ee90;"></span> < 6 hours</div>
                <div class="legend-item"><span class="color-box" style="background: #808080;"></span> > 6 hours</div>
                <div class="legend-separator"></div>
                <div class="legend-item"><span class="line-solid"></span> Road-matched</div>
                <div class="legend-item"><span class="line-dashed"></span> GPS direct (gaps filtered)</div>
            </div>
            
            <div class="status" id="status">
                Loading...
            </div>
        </div>
    `;

    document.body.appendChild(controlsDiv);

    // Set up slider event listeners
    setupTimeSlider();
}

function setupTimeSlider() {
    const slider = document.getElementById('timeRange');
    const timeValue = document.getElementById('timeValue');

    // Update display when slider moves
    slider.addEventListener('input', (e) => {
        const hours = parseInt(e.target.value);
        updateTimeDisplay(hours);
    });

    // Load new data when slider is released
    slider.addEventListener('change', (e) => {
        const hours = parseInt(e.target.value);
        currentTimeHours = hours;
        loadAndDisplayPaths();
    });
}

function updateTimeDisplay(hours) {
    const timeValue = document.getElementById('timeValue');

    if (hours < 24) {
        timeValue.textContent = `Last ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours < 168) {
        const days = Math.round(hours / 24 * 10) / 10;
        timeValue.textContent = `Last ${days} day${days !== 1 ? 's' : ''}`;
    } else {
        const weeks = Math.round(hours / 168 * 10) / 10;
        timeValue.textContent = `Last ${weeks} week${weeks !== 1 ? 's' : ''}`;
    }
}

function setTimeRange(hours) {
    const slider = document.getElementById('timeRange');
    slider.value = hours;
    updateTimeDisplay(hours);
    currentTimeHours = hours;
    loadAndDisplayPaths();
}

function showStatus(message) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
        statusDiv.textContent = message;
    }
    console.log('Status:', message);
}

function fitAllPaths() {
    const allFeatures = [
        ...pathsSource.getFeatures(),
        ...unmatchedPathsSource.getFeatures()
    ];

    if (allFeatures.length > 0) {
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
window.setTimeRange = setTimeRange;

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
        const isMatched = feature.get('isMatched');

        console.log('Clicked feature:', {
            device,
            timestamp,
            segmentIndex,
            isMatched,
            type: feature.get('type')
        });

        if (device) {
            const matchStatus = isMatched !== undefined ? (isMatched ? ' (matched)' : ' (unmatched)') : '';
            showStatus(`Device: ${device}${matchStatus}, Time: ${timestamp ? new Date(timestamp).toLocaleString() : 'Unknown'}`);
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