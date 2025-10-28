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

// ✨ OPTIMIZED: Polyline cache to avoid re-decoding
// Using a plain object instead of Map to avoid potential issues
const polylineCache = {};

// ✨ OPTIMIZED: Simple polyline decoder with caching
function decodePolyline(str, precision = 5) {
    // Check cache first
    if (polylineCache[str]) {
        return polylineCache[str];
    }

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

    // Cache the result
    polylineCache[str] = coordinates;

    return coordinates;
}

function clearPolylineCache() {
    // Clear all cache entries
    for (const key in polylineCache) {
        delete polylineCache[key];
    }
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
const unmatchedPathsSource = new VectorSource();
const currentPositionsSource = new VectorSource();
const userLocationSource = new VectorSource();

// Add layers to map (order matters for display)
map.addLayer(new VectorLayer({
    source: pathsSource,
    zIndex: 1,
    style: createPathStyle
}));

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

    if (ageMinutes < 5) return '#ff0000';
    if (ageMinutes < 30) return '#ff4500';
    if (ageMinutes < 60) return '#ffa500';
    if (ageMinutes < 120) return '#ffff00';
    if (ageMinutes < 360) return '#90ee90';
    return '#808080';
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

// Style for unmatched path segments (dashed, thinner, more transparent)
function createUnmatchedPathStyle(feature) {
    const timestamp = feature.get('timestamp');
    const baseColor = timestamp ? getColorByAge(timestamp) : '#0066cc';
    const colorWithAlpha = baseColor + '80';

    return new Style({
        stroke: new Stroke({
            color: colorWithAlpha,
            width: 2,
            lineDash: [5, 5]
        })
    });
}

// Style for current position markers
function createCurrentPositionStyle(feature) {
    const device = feature.get('device');
    const timestamp = feature.get('timestamp');
    const isVeryRecent = timestamp && (Date.now() - new Date(timestamp).getTime()) < 300000;

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

    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];

        if (!start || !end || start.length !== 2 || end.length !== 2) continue;

        // Filter out large gaps for unmatched segments
        if (!isMatched) {
            const distance = Math.sqrt(
                Math.pow(end[0] - start[0], 2) +
                Math.pow(end[1] - start[1], 2)
            );

            if (distance > 0.01) continue;
        }

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

    const simplified = [coordinates[0]];
    let lastAdded = coordinates[0];

    for (let i = 1; i < coordinates.length - 1; i++) {
        const current = coordinates[i];
        const distance = Math.sqrt(
            Math.pow(current[0] - lastAdded[0], 2) +
            Math.pow(current[1] - lastAdded[1], 2)
        );

        if (distance > tolerance) {
            simplified.push(current);
            lastAdded = current;
        }
    }

    simplified.push(coordinates[coordinates.length - 1]);
    return simplified;
}

// ✨ OPTIMIZED: Process batches in chunks to avoid blocking UI
async function processBatchesInChunks(batches, minuteMarkers, deviceName) {
    const CHUNK_SIZE = 10;
    const allSegments = { matched: [], unmatched: [] };

    for (let i = 0; i < batches.length; i += CHUNK_SIZE) {
        const chunk = batches.slice(i, i + CHUNK_SIZE);

        // Process this chunk
        chunk.forEach(batch => {
            if (batch.encoded_polyline) {
                const coords = decodePolyline(batch.encoded_polyline);
                const simplified = simplifyCoordinates(coords, 0.0001);
                const segments = createPathSegments(simplified, minuteMarkers, deviceName, true);
                allSegments.matched.push(...segments);
            } else if (batch.raw_coordinates) {
                const simplified = simplifyCoordinates(batch.raw_coordinates, 0.0001);
                const segments = createPathSegments(simplified, minuteMarkers, deviceName, false);
                allSegments.unmatched.push(...segments);
            }
        });

        // Yield to browser between chunks (keeps UI responsive)
        if (i + CHUNK_SIZE < batches.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return allSegments;
}

// Store all loaded polyline data
let allPolylinesData = null;

// ✨ OPTIMIZED: Load all data once (7 days worth)
async function loadAllPolylines() {
    try {
        showStatus('Loading all paths (7 days)...');
        const startTime = performance.now();

        // Load ALL data (default 7 days) - no hours parameter for full preload
        const url = `${API_BASE}/paths/encoded`;
        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Preloaded all data in ${fetchTime.toFixed(0)}ms`);
        console.log('📦 Response data:', JSON.stringify(data, null, 2));
        
        // Store data in memory
        allPolylinesData = data;
        return data;
    } catch (err) {
        console.error('Failed to load polylines:', err);
        showStatus(`Error: ${err.message}`);
        throw err;
    }
}

// ✨ NEW: Display paths from cached data based on time filter
async function displayFilteredPaths() {
    try {
        if (!allPolylinesData) {
            showStatus('No data loaded yet');
            return;
        }

        showStatus('Filtering paths...');
        const startTime = performance.now();
        
        const data = allPolylinesData;
        console.log('📦 Filtering from cached data:', JSON.stringify(data, null, 2));

        if (!data.devices || data.devices.length === 0) {
            showStatus('No devices found');
            console.log('⚠️ No devices in response');
            return;
        }

        // Calculate cutoff time based on current slider value
        const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
        
        console.log(`📱 Processing ${data.devices.length} device(s)`);
        console.log(`🕒 Filter: Show polylines newer than ${new Date(cutoffTime).toISOString()}`);
        
        for (const device of data.devices) {
            if (device.polylines) {
                console.log(`  Device ${device.device}: ${device.polylines.length} polylines, ${device.total_points} points`);
                console.log(`  Time range: ${device.start_time} to ${device.end_time}`);
            }
        }

        // Clear existing features
        pathsSource.clear();
        unmatchedPathsSource.clear();
        currentPositionsSource.clear();

        let totalMatchedSegments = 0;
        let totalUnmatchedSegments = 0;

        // ✨ OPTIMIZED: Process each device
        for (const device of data.devices) {
            const minuteMarkers = device.minute_markers || [];

            // NEW: Handle polylines array from cached_polylines table
            if (device.polylines && device.polylines.length > 0) {
                for (const polyline of device.polylines) {
                    // Filter: only show polylines within the selected time range
                    const polylineEndTime = new Date(polyline.end_time).getTime();
                    if (polylineEndTime < cutoffTime) {
                        continue; // Skip polylines older than cutoff
                    }
                    
                    if (polyline.encoded_polyline) {
                        const coords = decodePolyline(polyline.encoded_polyline);
                        const simplified = simplifyCoordinates(coords, 0.0001);
                        const segments = createPathSegments(simplified, minuteMarkers, device.device, true);
                        pathsSource.addFeatures(segments);
                        totalMatchedSegments += segments.length;
                    }
                }
            }
            // OLD: Keep backwards compatibility with batches format
            else if (device.batches && device.batches.length > 0) {
                const segments = await processBatchesInChunks(device.batches, minuteMarkers, device.device);

                pathsSource.addFeatures(segments.matched);
                unmatchedPathsSource.addFeatures(segments.unmatched);

                totalMatchedSegments += segments.matched.length;
                totalUnmatchedSegments += segments.unmatched.length;

            } else if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                const simplified = simplifyCoordinates(coords, 0.0001);
                const segments = createPathSegments(simplified, minuteMarkers, device.device, true);

                pathsSource.addFeatures(segments);
                totalMatchedSegments += segments.length;
            } else if (device.raw_coordinates) {
                const simplified = simplifyCoordinates(device.raw_coordinates, 0.0001);
                const segments = createPathSegments(simplified, minuteMarkers, device.device, false);

                unmatchedPathsSource.addFeatures(segments);
                totalUnmatchedSegments += segments.length;
            }

            // Add current position marker
            let lastCoord = null;
            if (device.polylines && device.polylines.length > 0) {
                // Get last coordinate from last polyline
                const lastPolyline = device.polylines[device.polylines.length - 1];
                if (lastPolyline.encoded_polyline) {
                    const coords = decodePolyline(lastPolyline.encoded_polyline);
                    lastCoord = coords[coords.length - 1];
                }
            } else if (device.batches && device.batches.length > 0) {
                for (let j = device.batches.length - 1; j >= 0; j--) {
                    const batch = device.batches[j];
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
        }

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total render time: ${totalTime.toFixed(0)}ms`);

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
    setupTimeSlider();
}

function setupTimeSlider() {
    const slider = document.getElementById('timeRange');

    slider.addEventListener('input', (e) => {
        updateTimeDisplay(parseInt(e.target.value));
    });

    slider.addEventListener('change', (e) => {
        currentTimeHours = parseInt(e.target.value);
        // No need to clear cache - we're filtering client-side now
        displayFilteredPaths();
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
    // Filter client-side, no reload needed
    displayFilteredPaths();
}

function showStatus(message) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) statusDiv.textContent = message;
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

// Refresh function - reload all data from server
async function refreshPaths() {
    await loadAllPolylines();
    await displayFilteredPaths();
}

// Make functions available globally
window.refreshPaths = refreshPaths;
window.fitAllPaths = fitAllPaths;
window.setTimeRange = setTimeRange;

// User geolocation
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition((pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        userLocationSource.clear();
        userLocationSource.addFeature(new Feature({ geometry: new Point(fromLonLat(coords)) }));
    }, () => {}, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
}

// Map click handler
map.on('click', (event) => {
    const features = map.getFeaturesAtPixel(event.pixel);
    if (features.length > 0) {
        const feature = features[0];
        const device = feature.get('device');
        const timestamp = feature.get('timestamp');
        const isMatched = feature.get('isMatched');

        if (device) {
            const matchStatus = isMatched !== undefined ? (isMatched ? ' (matched)' : ' (unmatched)') : '';
            showStatus(`Device: ${device}${matchStatus}, Time: ${timestamp ? new Date(timestamp).toLocaleString() : 'Unknown'}`);
        }
    }
});

// Initialize
console.log('🗺️ Initializing MudMaps (OPTIMIZED with preload)...');
createUI();

// Load all data on startup, then display with initial filter
(async () => {
    await loadAllPolylines();
    await displayFilteredPaths();
})();

// Auto-refresh every 2 minutes - reload all data from server
setInterval(async () => {
    await loadAllPolylines();
    await displayFilteredPaths();
}, 120000);