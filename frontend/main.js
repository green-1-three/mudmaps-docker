import './style.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
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

// Discrete time intervals mapping: index -> hours
const TIME_INTERVALS = [1, 2, 4, 8, 24, 72, 168]; // 1h, 2h, 4h, 8h, 1d, 3d, 7d

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

// Map setup with CartoDB Positron (light, minimal basemap)
const map = new Map({
    target: 'map',
    layers: [new TileLayer({ 
        source: new XYZ({
            url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            attributions: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
        })
    })],
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
    style: createPathStyleWithFilter
}));

map.addLayer(new VectorLayer({
    source: unmatchedPathsSource,
    zIndex: 0,
    style: createUnmatchedPathStyleWithFilter
}));

map.addLayer(new VectorLayer({
    source: currentPositionsSource,
    zIndex: 2,
    style: createCurrentPositionStyleWithFilter
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

// Helper function to interpolate between two colors
function interpolateColor(color1, color2, factor) {
    // Parse hex colors
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);
    
    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);
    
    // Interpolate
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Function to get color based on time recency with smooth gradient
// Gradient dynamically scales to the selected time range
function getColorByAge(timestamp, maxHours = currentTimeHours) {
    const now = Date.now();
    const recordTime = new Date(timestamp).getTime();
    const ageMinutes = (now - recordTime) / (1000 * 60);
    const maxMinutes = maxHours * 60;
    
    // If older than the selected range, return gray
    if (ageMinutes >= maxMinutes) return '#808080';
    
    // Calculate position in the range (0 = now, 1 = max age)
    const position = ageMinutes / maxMinutes;
    
    // Color stops that scale to the selected range:
    // 0% = bright green, 50% = yellow, 75% = orange, 100% = gray
    const stops = [
        { position: 0.00, color: '#00ff00' },   // Now: Bright green
        { position: 0.50, color: '#ffff00' },   // Midpoint: Yellow
        { position: 0.75, color: '#ff8800' },   // 75%: Orange
        { position: 1.00, color: '#808080' }    // Max age: Gray
    ];
    
    // Find which two stops we're between
    for (let i = 0; i < stops.length - 1; i++) {
        if (position >= stops[i].position && position <= stops[i + 1].position) {
            const rangeDuration = stops[i + 1].position - stops[i].position;
            const positionInRange = position - stops[i].position;
            const factor = positionInRange / rangeDuration;
            
            return interpolateColor(stops[i].color, stops[i + 1].color, factor);
        }
    }
    
    // Default to bright green for brand new data
    return '#00ff00';
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
function createPathSegments(coordinates, deviceName, polylineEndTime, isMatched = true) {
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

        const segmentCoords = [
            fromLonLat(start),
            fromLonLat(end)
        ];

        const segmentFeature = new Feature({
            geometry: new LineString(segmentCoords),
            device: deviceName,
            timestamp: polylineEndTime,
            polylineEndTime: polylineEndTime, // Store for filtering
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
                const segments = createPathSegments(simplified, deviceName, Date.now(), true);
                allSegments.matched.push(...segments);
            } else if (batch.raw_coordinates) {
                const simplified = simplifyCoordinates(batch.raw_coordinates, 0.0001);
                const segments = createPathSegments(simplified, deviceName, Date.now(), false);
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

// ✨ OPTIMIZED: Load all data once on startup (7 days)
async function loadAllData() {
    try {
        showStatus('Loading all paths (7 days)...');
        const startTime = performance.now();

        // Load 7 days of data (168 hours)
        const url = `${API_BASE}/paths/encoded?hours=168`;
        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Preloaded 7 days in ${fetchTime.toFixed(0)}ms`);
        console.log('📦 Response data:', JSON.stringify(data, null, 2));

        if (!data.devices || data.devices.length === 0) {
            showStatus('No devices found');
            console.log('⚠️ No devices in response');
            return;
        }

        console.log(`📱 Processing ${data.devices.length} device(s)`);
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

        // Process each device and create ALL features (7 days worth)
        for (const device of data.devices) {
            // Handle polylines array from cached_polylines table
            if (device.polylines && device.polylines.length > 0) {
                for (const polyline of device.polylines) {
                    if (polyline.encoded_polyline) {
                        const coords = decodePolyline(polyline.encoded_polyline);
                        const simplified = simplifyCoordinates(coords, 0.0001);
                        const polylineEndTime = new Date(polyline.end_time).getTime();
                        const segments = createPathSegments(simplified, device.device, polylineEndTime, true);
                        pathsSource.addFeatures(segments);
                        totalMatchedSegments += segments.length;
                    }
                }
            }

            // Add current position marker
            if (device.polylines && device.polylines.length > 0) {
                const lastPolyline = device.polylines[device.polylines.length - 1];
                if (lastPolyline.encoded_polyline) {
                    const coords = decodePolyline(lastPolyline.encoded_polyline);
                    const lastCoord = coords[coords.length - 1];
                    const lastPolylineEndTime = new Date(lastPolyline.end_time).getTime();
                    
                    if (lastCoord && lastCoord.length === 2) {
                        const currentPosFeature = new Feature({
                            geometry: new Point(fromLonLat(lastCoord)),
                            device: device.device,
                            timestamp: device.end_time,
                            polylineEndTime: lastPolylineEndTime,
                            type: 'current_position'
                        });
                        currentPositionsSource.addFeature(currentPosFeature);
                    }
                }
            }
        }

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total load time: ${totalTime.toFixed(0)}ms`);

        // Fit map to show paths from initial time range (24 hours)
        // The style filter will hide older features
        isSliderDragging = true; // Enable filtering
        pathsSource.changed();
        unmatchedPathsSource.changed();
        currentPositionsSource.changed();
        isSliderDragging = false; // Disable filtering (features are already filtered)

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

        showStatus(`Loaded 7 days: ${data.devices.length} device(s), ${totalMatchedSegments} segments`);

    } catch (err) {
        console.error('Failed to load paths:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// Load and display paths for a specific time range (used after slider change)
async function loadAndDisplayPaths() {
    try {
        showStatus('Loading paths...');
        const startTime = performance.now();

        const url = `${API_BASE}/paths/encoded?hours=${currentTimeHours}`;
        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ API response in ${fetchTime.toFixed(0)}ms`);
        console.log('📦 Response data:', JSON.stringify(data, null, 2));

        if (!data.devices || data.devices.length === 0) {
            showStatus('No devices found');
            console.log('⚠️ No devices in response');
            return;
        }

        console.log(`📱 Processing ${data.devices.length} device(s)`);
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
            // Handle polylines array from cached_polylines table
            if (device.polylines && device.polylines.length > 0) {
                for (const polyline of device.polylines) {
                    if (polyline.encoded_polyline) {
                        const coords = decodePolyline(polyline.encoded_polyline);
                        const simplified = simplifyCoordinates(coords, 0.0001);
                        const polylineEndTime = new Date(polyline.end_time).getTime();
                        const segments = createPathSegments(simplified, device.device, polylineEndTime, true);
                        pathsSource.addFeatures(segments);
                        totalMatchedSegments += segments.length;
                    }
                }
            }
            // OLD: Keep backwards compatibility with batches format
            else if (device.batches && device.batches.length > 0) {
                // For batches, we need to process them (this path shouldn't be hit with cached_polylines)
                for (const batch of device.batches) {
                    if (batch.encoded_polyline) {
                        const coords = decodePolyline(batch.encoded_polyline);
                        const simplified = simplifyCoordinates(coords, 0.0001);
                        const segments = createPathSegments(simplified, device.device, Date.now(), true);
                        pathsSource.addFeatures(segments);
                        totalMatchedSegments += segments.length;
                    } else if (batch.raw_coordinates) {
                        const simplified = simplifyCoordinates(batch.raw_coordinates, 0.0001);
                        const segments = createPathSegments(simplified, device.device, Date.now(), false);
                        unmatchedPathsSource.addFeatures(segments);
                        totalUnmatchedSegments += segments.length;
                    }
                }
            } else if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                const simplified = simplifyCoordinates(coords, 0.0001);
                const segments = createPathSegments(simplified, device.device, Date.now(), true);

                pathsSource.addFeatures(segments);
                totalMatchedSegments += segments.length;
            } else if (device.raw_coordinates) {
                const simplified = simplifyCoordinates(device.raw_coordinates, 0.0001);
                const segments = createPathSegments(simplified, device.device, Date.now(), false);

                unmatchedPathsSource.addFeatures(segments);
                totalUnmatchedSegments += segments.length;
            }

            // Add current position marker
            let lastCoord = null;
            let lastPolylineEndTime = null;
            if (device.polylines && device.polylines.length > 0) {
                // Get last coordinate from last polyline
                const lastPolyline = device.polylines[device.polylines.length - 1];
                if (lastPolyline.encoded_polyline) {
                    const coords = decodePolyline(lastPolyline.encoded_polyline);
                    lastCoord = coords[coords.length - 1];
                    lastPolylineEndTime = new Date(lastPolyline.end_time).getTime();
                }
            } else if (device.batches && device.batches.length > 0) {
                for (let j = device.batches.length - 1; j >= 0; j--) {
                    const batch = device.batches[j];
                    if (batch.encoded_polyline) {
                        const coords = decodePolyline(batch.encoded_polyline);
                        lastCoord = coords[coords.length - 1];
                        lastPolylineEndTime = Date.now();
                        break;
                    } else if (batch.raw_coordinates) {
                        lastCoord = batch.raw_coordinates[batch.raw_coordinates.length - 1];
                        lastPolylineEndTime = Date.now();
                        break;
                    }
                }
            } else if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                lastCoord = coords[coords.length - 1];
                lastPolylineEndTime = Date.now();
            } else if (device.raw_coordinates) {
                lastCoord = device.raw_coordinates[device.raw_coordinates.length - 1];
                lastPolylineEndTime = Date.now();
            }

            if (lastCoord && lastCoord.length === 2) {
                const currentPosFeature = new Feature({
                    geometry: new Point(fromLonLat(lastCoord)),
                    device: device.device,
                    timestamp: device.end_time,
                    polylineEndTime: lastPolylineEndTime,
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
let isSliderDragging = false; // Track if slider is being dragged

// Enhanced style functions that can filter based on time while dragging
function createPathStyleWithFilter(feature) {
    // If dragging, check if feature should be visible based on time
    if (isSliderDragging) {
        const polylineEndTime = feature.get('polylineEndTime');
        if (polylineEndTime) {
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            if (polylineEndTime < cutoffTime) {
                return null; // Hide feature
            }
        }
    }
    
    // Normal style
    const timestamp = feature.get('timestamp');
    const color = timestamp ? getColorByAge(timestamp) : '#0066cc';
    return new Style({
        stroke: new Stroke({
            color: color,
            width: 3
        })
    });
}

function createUnmatchedPathStyleWithFilter(feature) {
    // If dragging, check if feature should be visible based on time
    if (isSliderDragging) {
        const polylineEndTime = feature.get('polylineEndTime');
        if (polylineEndTime) {
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            if (polylineEndTime < cutoffTime) {
                return null; // Hide feature
            }
        }
    }
    
    // Normal style
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

function createCurrentPositionStyleWithFilter(feature) {
    // If dragging, check if feature should be visible based on time
    if (isSliderDragging) {
        const polylineEndTime = feature.get('polylineEndTime');
        if (polylineEndTime) {
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            if (polylineEndTime < cutoffTime) {
                return null; // Hide feature
            }
        }
    }
    
    // Normal style
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

// Create simple UI
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
                <div class="legend-title">Path Age:</div>
                <div class="gradient-bar"></div>
                <div class="gradient-labels">
                    <span id="gradientLeft">Now</span>
                    <span id="gradientCenter">12 hours</span>
                    <span id="gradientRight">1 day</span>
                </div>
                <div class="legend-separator"></div>
                <div class="legend-item"><span class="line-solid"></span> Road-matched</div>
                <div class="legend-item"><span class="line-dashed"></span> GPS direct (gaps filtered)</div>
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
        
        // Set dragging flag and force style recalculation for instant visual feedback
        isSliderDragging = true;
        pathsSource.changed();
        unmatchedPathsSource.changed();
        currentPositionsSource.changed();
    });

    slider.addEventListener('change', (e) => {
        // Clear dragging flag
        isSliderDragging = false;
        
        // Actually rebuild features with correct time range
        const index = parseInt(e.target.value);
        currentTimeHours = TIME_INTERVALS[index];
        clearPolylineCache();
        loadAndDisplayPaths();
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
    
    // Center is 50% of range
    const centerMinutes = (hours * 60) / 2;
    if (centerLabel) centerLabel.textContent = formatTimeLabel(centerMinutes);
    
    // Right is 100% of range
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
    
    // Update gradient labels
    updateGradientLabels(hours);
}

function setTimeRangeByIndex(index) {
    const slider = document.getElementById('timeRange');
    slider.value = index;
    const hours = TIME_INTERVALS[index];
    updateTimeDisplay(hours);
    currentTimeHours = hours;
    clearPolylineCache();
    loadAndDisplayPaths();
}

function showStatus(message) {
    // Status div removed - log to console instead
    console.log(message);
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

// Make functions available globally (keeping for compatibility)
window.fitAllPaths = fitAllPaths;

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
console.log('🗺️ Initializing MudMaps (OPTIMIZED with 7-day preload)...');
createUI();
updateGradientLabels(currentTimeHours); // Set initial gradient labels
loadAllData();
