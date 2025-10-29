import './style.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Feature } from 'ol';
import { Point, LineString } from 'ol/geom';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Icon, Stroke, Fill, Text } from 'ol/style';

// Configuration
let API_BASE = import.meta.env.VITE_API_BASE;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

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

// Map setup with CartoDB Dark Matter (dark background for better contrast)
const map = new Map({
    target: 'map',
    layers: [new TileLayer({ 
        source: new XYZ({
            url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            attributions: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>'
        })
    })],
    view: new View({ center: fromLonLat([0, 0]), zoom: 2 })
});

// Vector sources for different layers
const pathsSource = new VectorSource();
const unmatchedPathsSource = new VectorSource();
const arrowsSource = new VectorSource();
const currentPositionsSource = new VectorSource();
const userLocationSource = new VectorSource();
const searchResultSource = new VectorSource();

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
    source: arrowsSource,
    zIndex: 1.5,
    style: createArrowStyleWithFilter
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

map.addLayer(new VectorLayer({
    source: searchResultSource,
    zIndex: 4,
    style: (feature) => {
        const name = feature.get('name') || 'Search Result';
        return new Style({
            image: new Icon({
                anchor: [0.5, 1],
                src: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
                scale: 1.5
            }),
            text: new Text({
                text: name,
                offsetY: -60,
                fill: new Fill({ color: '#000' }),
                stroke: new Stroke({ color: '#fff', width: 3 }),
                font: 'bold 13px Arial'
            })
        });
    }
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

// Calculate bearing between two points (in degrees)
function calculateBearing(coord1, coord2) {
    const dx = coord2[0] - coord1[0];
    const dy = coord2[1] - coord1[1];
    return Math.atan2(dx, dy);
}

// Create a chevron (">") geometry at a point with rotation
function createChevronGeometry(point, bearing, size = 8) {
    const angle = bearing;
    
    // Chevron points (two lines forming ">")
    const armLength = size;
    const armAngle = Math.PI / 5; // Slightly wider angle for better visibility
    
    // Upper arm
    const upperArm = new LineString([
        point,
        [
            point[0] + armLength * Math.sin(angle - armAngle),
            point[1] + armLength * Math.cos(angle - armAngle)
        ]
    ]);
    
    // Lower arm
    const lowerArm = new LineString([
        point,
        [
            point[0] + armLength * Math.sin(angle + armAngle),
            point[1] + armLength * Math.cos(angle + armAngle)
        ]
    ]);
    
    return [upperArm, lowerArm];
}

// Style for direction arrows
function createArrowStyle(feature) {
    const timestamp = feature.get('timestamp');
    const color = timestamp ? getColorByAge(timestamp) : '#0066cc';
    
    return new Style({
        stroke: new Stroke({
            color: color,
            width: 2
        })
    });
}

// Generate arrow features for a line segment
function generateArrowsForSegment(segment, zoom) {
    // Only show arrows at zoom 14+
    if (zoom < 14) return [];
    
    const geometry = segment.getGeometry();
    const coords = geometry.getCoordinates();
    
    if (coords.length < 2) return [];
    
    const timestamp = segment.get('timestamp');
    const polylineEndTime = segment.get('polylineEndTime');
    const device = segment.get('device');
    
    // Arrow size scales INVERSELY with zoom (larger when zoomed OUT for visibility)
    // At zoom 14 (far): size 30, at zoom 18 (close): size 18, at zoom 22+: size 10
    const arrowSize = Math.max(10, 30 - (zoom - 14) * 2);
    
    const bearing = calculateBearing(coords[0], coords[1]);
    
    // Place exactly 1 arrow at midpoint (50% along segment)
    const point = [
        coords[0][0] + 0.5 * (coords[1][0] - coords[0][0]),
        coords[0][1] + 0.5 * (coords[1][1] - coords[0][1])
    ];
    
    const chevronLines = createChevronGeometry(point, bearing, arrowSize);
    
    // Create two separate features for each arm of the chevron
    const upperArmFeature = new Feature({
        geometry: chevronLines[0],
        timestamp: timestamp,
        polylineEndTime: polylineEndTime,
        device: device
    });
    
    const lowerArmFeature = new Feature({
        geometry: chevronLines[1],
        timestamp: timestamp,
        polylineEndTime: polylineEndTime,
        device: device
    });
    
    return [upperArmFeature, lowerArmFeature];
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

// Regenerate arrows for all visible segments at current zoom level
let arrowRegenerationTimeout = null;
let isRegeneratingArrows = false; // Prevent recursion

function regenerateArrows() {
    // Prevent recursive calls
    if (isRegeneratingArrows) {
        console.log('⚠️ Arrow regeneration already in progress, skipping');
        return;
    }
    
    // Debounce arrow regeneration to avoid excessive calls during zoom
    if (arrowRegenerationTimeout) {
        clearTimeout(arrowRegenerationTimeout);
    }
    
    arrowRegenerationTimeout = setTimeout(() => {
        isRegeneratingArrows = true; // Set flag before starting
        
        const zoom = map.getView().getZoom();
        
        // Clear existing arrows
        arrowsSource.clear();
        
        // Only generate arrows at zoom 14+
        if (zoom < 14) {
            isRegeneratingArrows = false;
            return;
        }
        
        const allSegments = pathsSource.getFeatures();
        const allArrows = [];
        
        console.log(`🎯 Regenerating arrows for ${allSegments.length} segments at zoom ${zoom.toFixed(1)}`);
        
        // Only generate arrows for every 3rd segment
        for (let i = 0; i < allSegments.length; i += 3) {
            const segment = allSegments[i];
            const arrows = generateArrowsForSegment(segment, zoom);
            allArrows.push(...arrows);
        }
        
        console.log(`➡️ Generated ${allArrows.length} arrow features`);
        
        // Add all arrows at once
        if (allArrows.length > 0) {
            arrowsSource.addFeatures(allArrows);
        }
        
        isRegeneratingArrows = false; // Clear flag after completion
    }, 150); // 150ms debounce
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
        arrowsSource.clear();
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

            // Don't add current position marker - removed per user request
            // Device position markers are hidden
        }

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total load time: ${totalTime.toFixed(0)}ms`);

        // Generate arrows for initial zoom level
        regenerateArrows();

        // Fit map to show paths from initial time range (24 hours)
        // The style filter will hide older features
        isSliderDragging = true; // Enable filtering
        pathsSource.changed();
        unmatchedPathsSource.changed();
        arrowsSource.changed();
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
        arrowsSource.clear();
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

            // Don't add current position marker - removed per user request
        }

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total render time: ${totalTime.toFixed(0)}ms`);

        // Generate arrows for current zoom level
        regenerateArrows();

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

function createArrowStyleWithFilter(feature) {    
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
    
    return createArrowStyle(feature);
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

    // Control panel (top-right) - back to original design
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
            </div>
        </div>
    `;
    document.body.appendChild(controlsDiv);

    // Zoom level indicator (bottom-right, temporary for debugging)
    const zoomDiv = document.createElement('div');
    zoomDiv.id = 'zoom-indicator';
    zoomDiv.style.cssText = 'position: absolute; bottom: 20px; right: 20px; background: rgba(0,0,0,0.7); color: white; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 14px; z-index: 1000;';
    zoomDiv.innerHTML = 'Zoom: <span id="zoomLevel">--</span>';
    document.body.appendChild(zoomDiv);

    setupTimeSlider();
    setupAddressSearch();
    setupZoomIndicator();
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
        arrowsSource.changed();
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

// Setup zoom level indicator
function setupZoomIndicator() {
    const updateZoom = () => {
        const zoom = map.getView().getZoom();
        const zoomLevel = document.getElementById('zoomLevel');
        if (zoomLevel) {
            zoomLevel.textContent = zoom.toFixed(2);
        }
    };
    
    // Update on zoom change
    map.getView().on('change:resolution', updateZoom);
    
    // Initial update
    updateZoom();
}

// Setup address search functionality
function setupAddressSearch() {
    const searchInput = document.getElementById('addressSearch');
    const searchResults = document.getElementById('searchResults');

    // Search on Enter key
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchInput.value.trim();
            if (query) {
                performAddressSearch(query);
            }
        }
    });

    // Also trigger search as user types (debounced)
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

// Perform geocoding search using Mapbox Geocoding API
async function performAddressSearch(query) {
    const searchResults = document.getElementById('searchResults');
    searchResults.innerHTML = '<div class="search-loading">Searching...</div>';

    try {
        // Get current map center to bias results toward visible area
        const view = map.getView();
        const center = view.getCenter();
        const centerLonLat = toLonLat(center);
        
        // Mapbox Geocoding API with proximity bias
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
            `access_token=${MAPBOX_TOKEN}&` +
            `proximity=${centerLonLat[0]},${centerLonLat[1]}&` +
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

        // Display results
        searchResults.innerHTML = results.map((result, index) => `
            <div class="search-result-item" data-index="${index}">
                <div class="result-name">${result.place_name}</div>
            </div>
        `).join('');

        // Add click handlers to results
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

// Show the selected search result on the map
function showSearchResult(result) {
    // Mapbox returns coordinates as [lon, lat]
    const lon = result.center[0];
    const lat = result.center[1];

    // Parse address components for label: street, town, state
    const addressParts = result.place_name.split(',').map(s => s.trim());
    let displayAddress = '';
    
    if (addressParts.length >= 3) {
        // Format: "Street, Town, State"
        displayAddress = `${addressParts[0]}, ${addressParts[1]}, ${addressParts[2]}`;
    } else {
        // Fallback to first part
        displayAddress = addressParts[0];
    }

    // Clear previous search result
    searchResultSource.clear();

    // Add marker at the search result location
    const feature = new Feature({
        geometry: new Point(fromLonLat([lon, lat])),
        name: displayAddress
    });

    searchResultSource.addFeature(feature);

    // Update search input with full address
    const searchInput = document.getElementById('addressSearch');
    if (searchInput) {
        searchInput.value = result.place_name;
    }

    // Zoom to the location
    map.getView().animate({
        center: fromLonLat([lon, lat]),
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

// User geolocation (no marker, just functionality)
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition((pos) => {
        // Geolocation obtained but no marker displayed
        const coords = [pos.coords.longitude, pos.coords.latitude];
        console.log('User location:', coords);
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

// Add zoom change listener to regenerate arrows
map.getView().on('change:resolution', () => {
    regenerateArrows();
});

// Initialize
console.log('🗺️ Initializing MudMaps (OPTIMIZED with 7-day preload)...');
createUI();
updateGradientLabels(currentTimeHours); // Set initial gradient labels
loadAllData();
