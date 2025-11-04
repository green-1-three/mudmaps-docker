import './dev.css';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Import modules
import {
    decodePolyline,
    fetchJSON,
    interpolateColor,
    getColorByAge,
    formatTimeLabel,
    updateTimeDisplay,
    updateGradientLabels,
    showStatus,
    formatTimestamp,
    calculateDuration,
    abbreviateStreetName
} from './dev-common.js';
import { initStatistics, updateStatistics } from './dev-stats.js';
import { initUIControls, setStyleCreators } from './dev-ui-controls.js';
import { initDatabaseTab, highlightTableRow } from './dev-database.js';
import { initLogsTab } from './dev-logs.js';
import { initFrontendLogger } from './dev-frontend-logger.js';

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

// Helper function to convert hex color to rgba with opacity
function hexToRgba(hex, opacity) {
    let r, g, b;

    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    }

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Helper function to calculate bearing between two points
function calculateBearing(lon1, lat1, lon2, lat2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;

    return (bearing + 360) % 360;
}

// Helper function to calculate destination point given distance and bearing
function calculateDestination(lon, lat, distanceMeters, bearing) {
    const R = 6378137; // Earth's radius in meters
    const bearingRad = bearing * Math.PI / 180;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    const lat2Rad = Math.asin(
        Math.sin(latRad) * Math.cos(distanceMeters / R) +
        Math.cos(latRad) * Math.sin(distanceMeters / R) * Math.cos(bearingRad)
    );

    const lon2Rad = lonRad + Math.atan2(
        Math.sin(bearingRad) * Math.sin(distanceMeters / R) * Math.cos(latRad),
        Math.cos(distanceMeters / R) - Math.sin(latRad) * Math.sin(lat2Rad)
    );

    return [lon2Rad * 180 / Math.PI, lat2Rad * 180 / Math.PI];
}

// Helper function to create perpendicular line at a point
function createPerpendicularLine(point, bearing, widthMeters) {
    const perpBearing1 = (bearing + 90) % 360;
    const perpBearing2 = (bearing - 90 + 360) % 360;

    const halfWidth = widthMeters / 2;
    const point1 = calculateDestination(point[0], point[1], halfWidth, perpBearing1);
    const point2 = calculateDestination(point[0], point[1], halfWidth, perpBearing2);

    return [point1, point2];
}

// Helper function to find closest point on a line segment to a given point
function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return [ax, ay]; // a and b are the same point

    // Calculate projection parameter t
    let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t)); // Clamp to [0, 1]

    // Calculate closest point
    return [ax + t * dx, ay + t * dy];
}

// Helper function to calculate distance between two points in pixels
function distanceInPixels(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

// Helper function to find the closest segment and snap point
function findClosestSegment(mousePoint, features, snapRadius = 20) {
    let closestSegment = null;
    let closestDistance = Infinity;
    let snapPoint = null;

    for (const feature of features) {
        if (!feature.geometry || feature.geometry.type !== 'LineString') continue;

        const coords = feature.geometry.coordinates;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = map.project(coords[i]);
            const p2 = map.project(coords[i + 1]);

            const closest = closestPointOnSegment(
                mousePoint.x, mousePoint.y,
                p1.x, p1.y,
                p2.x, p2.y
            );

            const dist = distanceInPixels(mousePoint.x, mousePoint.y, closest[0], closest[1]);

            if (dist < closestDistance && dist <= snapRadius) {
                closestDistance = dist;
                closestSegment = feature;
                snapPoint = map.unproject(closest);
            }
        }
    }

    return { segment: closestSegment, snapPoint, distance: closestDistance };
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
    searchResult: { type: 'FeatureCollection', features: [] },
    segmentEndpoints: { type: 'FeatureCollection', features: [] },
    polylineEndpoints: { type: 'FeatureCollection', features: [] },
    snapIndicator: { type: 'FeatureCollection', features: [] },
    allSegmentsLabels: { type: 'FeatureCollection', features: [] } // For showing all road names
};

// Layer references for module access
const layers = {
    polylinesLayer: null,
    segmentsLayer: null,
    forwardOffsetLayer: null,
    reverseOffsetLayer: null
};

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
    map.addSource('boundary', { type: 'geojson', data: geojsonData.boundary });
    map.addSource('polylines', { type: 'geojson', data: geojsonData.polylines });
    map.addSource('segments', {
        type: 'geojson',
        data: geojsonData.segments,
        promoteId: 'segment_id'  // Use segment_id as feature ID for feature-state
    });
    map.addSource('forward-offsets', { type: 'geojson', data: geojsonData.forwardOffsets });
    map.addSource('reverse-offsets', { type: 'geojson', data: geojsonData.reverseOffsets });
    map.addSource('search-result', { type: 'geojson', data: geojsonData.searchResult });
    map.addSource('segment-endpoints', { type: 'geojson', data: geojsonData.segmentEndpoints });
    map.addSource('polyline-endpoints', { type: 'geojson', data: geojsonData.polylineEndpoints });
    map.addSource('snap-indicator', { type: 'geojson', data: geojsonData.snapIndicator });
    map.addSource('all-segments-labels', { type: 'geojson', data: geojsonData.allSegmentsLabels });

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
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': ['coalesce', ['get', 'opacity'], 1]
        }
    });

    // Polyline endpoint markers for debugging - perpendicular lines at endpoints
    map.addLayer({
        id: 'polyline-borders',
        type: 'line',
        source: 'polyline-endpoints',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': '#ffffff',
            'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13, 1,   // At zoom 13, width is 1px
                14, 2,   // At zoom 14, width is 2px
                16, 3,   // At zoom 16, width is 3px
                18, 4    // At zoom 18, width is 4px
            ]
        }
    });

    // Add segments layer with hover and selection effects
    map.addLayer({
        id: 'segments',
        type: 'line',
        source: 'segments',
        layout: {
            'line-cap': 'round',
            'line-join': 'round'
        },
        paint: {
            'line-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                '#00ffff',  // Cyan when selected
                ['get', 'color']  // Normal color
            ],
            'line-width': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                8,  // Extra wide when selected
                ['boolean', ['feature-state', 'hover'], false],
                7,  // Width when hovered
                4   // Normal width
            ],
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'selected'], false],
                1,  // Fully opaque when selected
                ['boolean', ['feature-state', 'hover'], false],
                1,  // Fully opaque when hovered
                ['coalesce', ['get', 'opacity'], 1]  // Normal opacity
            ]
        }
    });

    // Add segment street name labels (offset to the side) - uses all segments for complete road coverage
    map.addLayer({
        id: 'segment-labels',
        type: 'symbol',
        source: 'all-segments-labels',
        layout: {
            'text-field': ['get', 'street_name'],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
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

    // Add forward offset layer
    map.addLayer({
        id: 'forward-offsets',
        type: 'line',
        source: 'forward-offsets',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': ['coalesce', ['get', 'opacity'], 1]
        }
    });

    // Add reverse offset layer
    map.addLayer({
        id: 'reverse-offsets',
        type: 'line',
        source: 'reverse-offsets',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': ['coalesce', ['get', 'opacity'], 1]
        }
    });

    // Segment endpoint markers for debugging - perpendicular lines at endpoints
    map.addLayer({
        id: 'segment-borders',
        type: 'line',
        source: 'segment-endpoints',
        layout: {
            'visibility': 'none' // Hidden by default
        },
        paint: {
            'line-color': '#ffffff',
            'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13, 1,   // At zoom 13, width is 1px
                14, 2,   // At zoom 14, width is 2px
                16, 3,   // At zoom 16, width is 3px
                18, 4    // At zoom 18, width is 4px
            ]
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

    // Add snap indicator layer - shows where cursor snaps to segment
    map.addLayer({
        id: 'snap-indicator',
        type: 'circle',
        source: 'snap-indicator',
        paint: {
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#00ff00',
            'circle-opacity': 0.9
        }
    });

    // Store layer references for modules
    layers.polylinesLayer = 'polylines';
    layers.segmentsLayer = 'segments';
    layers.forwardOffsetLayer = 'forward-offsets';
    layers.reverseOffsetLayer = 'reverse-offsets';

    // Initialize modules after map loads
    initializeModules();

    // Load data after map is ready
    loadAllData();
});

// Track zoom state for endpoint regeneration
let lastZoomRange = map.getZoom() >= 14 ? 'high' : (map.getZoom() >= 12 ? 'mid' : 'low');

// Update zoom level display and regenerate endpoints if crossing zoom thresholds
map.on('zoom', () => {
    const zoomLevel = map.getZoom();
    const zoomDisplay = document.getElementById('zoom-display');
    if (zoomDisplay) {
        zoomDisplay.textContent = `Zoom: ${zoomLevel.toFixed(1)}`;
    }

    // Check if we crossed zoom 12 or 14 thresholds
    const currentZoomRange = zoomLevel >= 14 ? 'high' : (zoomLevel >= 12 ? 'mid' : 'low');
    if (currentZoomRange !== lastZoomRange) {
        lastZoomRange = currentZoomRange;
        // Regenerate endpoints with new length
        console.log(`🔄 Zoom crossed threshold (now ${currentZoomRange}), regenerating endpoints...`);

        // Only regenerate if data is already loaded
        if (geojsonData.segments.features.length > 0) {
            loadSegments();
        }
        if (geojsonData.polylines.features.length > 0) {
            loadPolylines();
        }
    }
});

// Track selected segment for highlighting
let selectedSegmentId = null;

// Function to highlight features on map when clicked in database
window.highlightMapFeature = function(tableName, rowData) {
    console.log(`🗺️ Highlighting map feature from database: ${tableName}, ID: ${rowData.id}`);

    if (tableName === 'road_segments') {
        // Clear previous selection
        if (selectedSegmentId !== null) {
            map.setFeatureState(
                { source: 'segments', id: selectedSegmentId },
                { selected: false }
            );
        }

        // Set new selection
        selectedSegmentId = rowData.id;
        map.setFeatureState(
            { source: 'segments', id: selectedSegmentId },
            { selected: true }
        );

        // Zoom to the segment if geometry exists
        if (rowData.geometry && rowData.geometry.coordinates) {
            const coords = rowData.geometry.coordinates;
            const bounds = new mapboxgl.LngLatBounds();
            coords.forEach(coord => bounds.extend(coord));
            map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 1000 });
        }
    } else if (tableName === 'cached_polylines') {
        // Zoom to the polyline if geometry exists
        if (rowData.geometry && rowData.geometry.coordinates) {
            const coords = rowData.geometry.coordinates;
            const bounds = new mapboxgl.LngLatBounds();
            coords.forEach(coord => bounds.extend(coord));
            map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 1000 });
        }
    }
};

// Click handlers
map.on('click', 'segments', (e) => {
    if (e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const segmentId = props.segment_id;
        const lastPlowed = props.last_plowed ? new Date(props.last_plowed).toLocaleString() : 'Unknown';
        const info = `SEGMENT: ${props.street_name || 'Unknown'} - Last plowed: ${lastPlowed} (Device: ${props.device_id || 'Unknown'}, Total: ${props.plow_count_total || 0}x)`;
        showStatus(info);
        console.log('📍 Segment clicked:', info);

        // Clear previous selection
        if (selectedSegmentId !== null) {
            map.setFeatureState(
                { source: 'segments', id: selectedSegmentId },
                { selected: false }
            );
        }

        // Set new selection
        selectedSegmentId = segmentId;
        map.setFeatureState(
            { source: 'segments', id: selectedSegmentId },
            { selected: true }
        );

        // Highlight in database inspector
        highlightTableRow('road_segments', segmentId);
    }
});

map.on('click', 'polylines', (e) => {
    if (e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const polylineId = props.polyline_id;
        const startText = props.start_time ? new Date(props.start_time).toLocaleString() : 'Unknown';
        const endText = props.end_time ? new Date(props.end_time).toLocaleString() : 'Unknown';
        const info = `POLYLINE #${polylineId || 'Unknown'} - Device: ${props.device || 'Unknown'}, Start: ${startText}, End: ${endText}`;
        showStatus(info);
        console.log('📍 Polyline clicked:', info);

        // Highlight in database inspector
        highlightTableRow('cached_polylines', polylineId);
    }
});

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
                        type: 'polyline',
                        color: '#4444ff',
                        opacity: 1
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
                                type: 'polyline',
                                color: '#4444ff',
                                opacity: 1
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
                        raw: true,
                        color: '#4444ff',
                        opacity: 1
                    }
                });
            }
        }

        // Extract polyline endpoints for debugging borders - perpendicular lines
        const polylineEndpointFeatures = [];
        const currentZoom = map.getZoom();
        let zoomMultiplier = 1;
        if (currentZoom < 12) {
            zoomMultiplier = 4; // 4x at zoom < 12
        } else if (currentZoom < 14) {
            zoomMultiplier = 2; // 2x at zoom 12-14
        }
        const polylineWidthMeters = 7.5 * zoomMultiplier;

        features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates && feature.geometry.coordinates.length >= 2) {
                const coords = feature.geometry.coordinates;

                // Start point - calculate bearing from first to second point
                const startPoint = coords[0];
                const secondPoint = coords[1];
                const startBearing = calculateBearing(
                    startPoint[0], startPoint[1],
                    secondPoint[0], secondPoint[1]
                );
                const startLine = createPerpendicularLine(startPoint, startBearing, polylineWidthMeters);

                polylineEndpointFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: startLine
                    },
                    properties: {
                        polyline_id: feature.properties.polyline_id,
                        device: feature.properties.device,
                        endpoint_type: 'start'
                    }
                });

                // End point - calculate bearing from second-to-last to last point
                const endPoint = coords[coords.length - 1];
                const penultimatePoint = coords[coords.length - 2];
                const endBearing = calculateBearing(
                    penultimatePoint[0], penultimatePoint[1],
                    endPoint[0], endPoint[1]
                );
                const endLine = createPerpendicularLine(endPoint, endBearing, polylineWidthMeters);

                polylineEndpointFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: endLine
                    },
                    properties: {
                        polyline_id: feature.properties.polyline_id,
                        device: feature.properties.device,
                        endpoint_type: 'end'
                    }
                });
            }
        });

        geojsonData.polylines.features = features;
        geojsonData.polylineEndpoints.features = polylineEndpointFeatures;

        if (map.getSource('polylines')) {
            map.getSource('polylines').setData(geojsonData.polylines);
        }
        if (map.getSource('polyline-endpoints')) {
            map.getSource('polyline-endpoints').setData(geojsonData.polylineEndpoints);
        }

        console.log(`📊 Loaded ${features.length} polylines`);
        console.log(`📊 Polyline endpoint markers: ${polylineEndpointFeatures.length} total (${features.length * 2} expected)`);
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
        const allSegmentsLabelFeatures = [];

        let totalSegments = 0;
        let activatedSegments = 0;
        let forwardOffsetCount = 0;
        let reverseOffsetCount = 0;

        // Get UI state for transparency and filtering
        const uiState = window.uiControls?.getState();
        const segmentTransparent = uiState?.segmentTransparent ?? false;
        const offsetTransparent = uiState?.offsetTransparent ?? false;
        const showActiveSegments = uiState?.showActiveSegments ?? true;
        const showInactiveSegments = uiState?.showInactiveSegments ?? true;
        const segmentOpacity = segmentTransparent ? 0.01 : 1;
        const offsetOpacity = offsetTransparent ? 0.01 : 1;

        data.features.forEach(segment => {
            if (!segment.geometry || !segment.geometry.coordinates) {
                console.warn('⚠️ Segment missing geometry:', segment);
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

            totalSegments++;

            if (isActivated) {
                activatedSegments++;
            }

            // Filter based on toggle states
            if (isActivated && !showActiveSegments) return;
            if (!isActivated && !showInactiveSegments) return;

            // Check time filter
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            const withinTimeRange = lastPlowed > 0 && lastPlowed >= cutoffTime;
            const isInactive = !isActivated;

            // Determine color based on time range
            let color;
            if (isInactive) {
                color = '#ff0000'; // Red for never plowed
            } else if (!withinTimeRange) {
                color = '#808080'; // Gray for out of range
            } else {
                color = getColorByAge(lastPlowedISO, currentTimeHours);
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
                    color: color,
                    opacity: isInactive ? 1 : segmentOpacity // Never transparent for inactive
                }
            });

            // Add forward offset
            if (segment.vertices_forward && segment.vertices_forward.coordinates && segment.properties.last_plowed_forward) {
                const fwdTime = new Date(segment.properties.last_plowed_forward).getTime();
                const fwdWithinRange = fwdTime >= cutoffTime;
                const fwdColor = fwdWithinRange
                    ? getColorByAge(segment.properties.last_plowed_forward, currentTimeHours)
                    : '#808080';

                forwardOffsetFeatures.push({
                    type: 'Feature',
                    geometry: segment.vertices_forward,
                    properties: {
                        segment_id: segment.id,
                        street_name: segment.properties.street_name,
                        last_plowed_forward: segment.properties.last_plowed_forward,
                        type: 'offset_forward',
                        color: fwdColor,
                        opacity: offsetOpacity
                    }
                });
                forwardOffsetCount++;
            }

            // Add reverse offset
            if (segment.vertices_reverse && segment.vertices_reverse.coordinates && segment.properties.last_plowed_reverse) {
                const revTime = new Date(segment.properties.last_plowed_reverse).getTime();
                const revWithinRange = revTime >= cutoffTime;
                const revColor = revWithinRange
                    ? getColorByAge(segment.properties.last_plowed_reverse, currentTimeHours)
                    : '#808080';

                reverseOffsetFeatures.push({
                    type: 'Feature',
                    geometry: segment.vertices_reverse,
                    properties: {
                        segment_id: segment.id,
                        street_name: segment.properties.street_name,
                        last_plowed_reverse: segment.properties.last_plowed_reverse,
                        type: 'offset_reverse',
                        color: revColor,
                        opacity: offsetOpacity
                    }
                });
                reverseOffsetCount++;
            }
        });

        // Extract segment endpoints for debugging borders - perpendicular lines
        const segmentEndpointFeatures = [];
        const currentZoom = map.getZoom();
        let zoomMultiplier = 1;
        if (currentZoom < 12) {
            zoomMultiplier = 4; // 4x at zoom < 12
        } else if (currentZoom < 14) {
            zoomMultiplier = 2; // 2x at zoom 12-14
        }
        const segmentWidthMeters = 15 * zoomMultiplier;

        segmentFeatures.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates && feature.geometry.coordinates.length >= 2) {
                const coords = feature.geometry.coordinates;

                // Start point - calculate bearing from first to second point
                const startPoint = coords[0];
                const secondPoint = coords[1];
                const startBearing = calculateBearing(
                    startPoint[0], startPoint[1],
                    secondPoint[0], secondPoint[1]
                );
                const startLine = createPerpendicularLine(startPoint, startBearing, segmentWidthMeters);

                segmentEndpointFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: startLine
                    },
                    properties: {
                        segment_id: feature.properties.segment_id,
                        street_name: feature.properties.street_name,
                        endpoint_type: 'start'
                    }
                });

                // End point - calculate bearing from second-to-last to last point
                const endPoint = coords[coords.length - 1];
                const penultimatePoint = coords[coords.length - 2];
                const endBearing = calculateBearing(
                    penultimatePoint[0], penultimatePoint[1],
                    endPoint[0], endPoint[1]
                );
                const endLine = createPerpendicularLine(endPoint, endBearing, segmentWidthMeters);

                segmentEndpointFeatures.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: endLine
                    },
                    properties: {
                        segment_id: feature.properties.segment_id,
                        street_name: feature.properties.street_name,
                        endpoint_type: 'end'
                    }
                });
            }
        });

        geojsonData.segments.features = segmentFeatures;
        geojsonData.forwardOffsets.features = forwardOffsetFeatures;
        geojsonData.reverseOffsets.features = reverseOffsetFeatures;
        geojsonData.segmentEndpoints.features = segmentEndpointFeatures;
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
        if (map.getSource('segment-endpoints')) {
            map.getSource('segment-endpoints').setData(geojsonData.segmentEndpoints);
        }
        if (map.getSource('all-segments-labels')) {
            map.getSource('all-segments-labels').setData(geojsonData.allSegmentsLabels);
        }

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total segment load time: ${totalTime.toFixed(0)}ms`);
        console.log(`📊 Segments: ${totalSegments} total, ${activatedSegments} activated, ${totalSegments - activatedSegments} unactivated`);
        console.log(`📊 Road labels: ${allSegmentsLabelFeatures.length} total`);
        console.log(`📊 Offset geometries: ${forwardOffsetCount} forward, ${reverseOffsetCount} reverse`);
        console.log(`📊 Segment endpoint markers: ${segmentEndpointFeatures.length} total (${segmentFeatures.length * 2} expected)`);

        showStatus(`Loaded ${totalSegments} segments (${activatedSegments} activated, ${totalSegments - activatedSegments} unactivated, ${forwardOffsetCount} offset geometries)`);

        // Update statistics
        updateStatistics();
    } catch (err) {
        console.error('Failed to load segments:', err);
        showStatus(`Error: ${err.message}`);
    }
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

        // Fit map to show all features
        if (geojsonData.segments.features.length > 0 || geojsonData.polylines.features.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();

            [...geojsonData.segments.features, ...geojsonData.polylines.features].forEach(feature => {
                if (feature.geometry.type === 'LineString') {
                    feature.geometry.coordinates.forEach(coord => bounds.extend(coord));
                }
            });

            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, { padding: 50, maxZoom: 16 });
            }
        }

        const polylineCount = geojsonData.polylines.features.length;
        const segmentCount = geojsonData.segments.features.length;
        showStatus(`Loaded ${polylineCount} polylines, ${segmentCount} segments`);
    } catch (err) {
        console.error('Failed to load data:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// Create UI overlay on map (time slider, search)
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

// Time slider setup
function setupTimeSlider() {
    const slider = document.getElementById('timeRange');

    slider.addEventListener('input', (e) => {
        const index = parseInt(e.target.value);
        const hours = TIME_INTERVALS[index];
        updateTimeDisplay(hours);
        currentTimeHours = hours;

        // Update time range and reload segments
        if (window.updateStatsWithTimeRange) {
            window.updateStatsWithTimeRange(hours);
        }

        loadSegments();
    });
}

// Developer Panel Functionality
function initDevPanel() {
    const panel = document.getElementById('dev-panel');
    const resizeHandle = document.querySelector('.dev-panel-resize-handle');
    const collapseBtn = document.querySelector('.dev-panel-collapse');

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    // Resize functionality
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = startX - e.clientX;
        const newWidth = Math.max(200, Math.min(window.innerWidth - 50, startWidth + deltaX));
        panel.style.width = newWidth + 'px';

        // Update map right margin to match panel width
        const mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.style.right = newWidth + 'px';
        }

        // Update controls position to match panel width
        const controlsElement = document.getElementById('controls');
        if (controlsElement) {
            controlsElement.style.right = (newWidth + 10) + 'px';
        }

        // Update map size while dragging
        map.resize();
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            // Final map size update
            map.resize();
        }
    });

    // Collapse functionality
    collapseBtn.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        const isCollapsed = panel.classList.contains('collapsed');

        collapseBtn.innerHTML = isCollapsed ? '&larr;' : '&rarr;';
        collapseBtn.title = isCollapsed ? 'Expand Panel' : 'Collapse Panel';

        // When collapsed, move button outside panel so it's visible
        if (isCollapsed) {
            collapseBtn.classList.add('floating');
            document.body.appendChild(collapseBtn);
        } else {
            collapseBtn.classList.remove('floating');
            document.querySelector('.dev-panel-header').appendChild(collapseBtn);
        }

        // Update map right margin - when collapsed, map fills entire screen
        const mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.style.right = isCollapsed ? '0px' : panel.offsetWidth + 'px';
        }

        // Update controls position
        const controlsElement = document.getElementById('controls');
        if (controlsElement) {
            controlsElement.style.right = isCollapsed ? '10px' : (panel.offsetWidth + 10) + 'px';
        }

        // Update map size after collapse/expand animation
        setTimeout(() => {
            map.resize();
        }, 300);
    });
}

// Initialize all modules
function initializeModules() {
    // Initialize statistics module
    const statsModule = initStatistics({
        polylinesSource: geojsonData.polylines,
        segmentsSource: geojsonData.segments
    });

    // Make stats update function available globally
    window.updateStatsWithTimeRange = (hours) => {
        statsModule.setTimeRange(hours);
    };

    // Initialize UI controls module - Mapbox layers don't need special style creators
    const uiControls = initUIControls(
        {
            polylinesLayer: layers.polylinesLayer,
            segmentsLayer: layers.segmentsLayer,
            forwardOffsetLayer: layers.forwardOffsetLayer,
            reverseOffsetLayer: layers.reverseOffsetLayer
        },
        updateStatistics
    );
    window.uiControls = uiControls;

    // Set up layer visibility toggles for Mapbox
    setupMapboxLayerToggles();

    // Initialize database tab
    const databaseTab = initDatabaseTab(API_BASE, {
        polylinesSource: geojsonData.polylines,
        segmentsSource: geojsonData.segments
    }, loadPolylines, loadSegments);

    // Initialize logs tab
    const logsTab = initLogsTab(API_BASE);

    // Initialize frontend logger
    initFrontendLogger(API_BASE);

    // Set up dev panel tab switching (AFTER tabs are created)
    setupDevPanelTabs();

    // Create UI overlay (time slider, search bar)
    createUI();

    // Initialize dev panel (drag, collapse)
    initDevPanel();

    // Update gradient labels
    updateGradientLabels(currentTimeHours);
}

// Setup dev panel tabs
function setupDevPanelTabs() {
    const tabs = document.querySelectorAll('.dev-tab');
    const tabContents = document.querySelectorAll('.dev-tab-content');

    console.log(`📑 Setting up ${tabs.length} tabs with ${tabContents.length} tab contents`);

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            console.log(`🔄 Switching to tab: ${targetTab}`);

            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const targetContent = document.querySelector(`[data-tab-content="${targetTab}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
                console.log(`✅ Activated tab content: ${targetTab}`);
            } else {
                console.warn(`⚠️ Tab content not found for: ${targetTab}`);
            }
        });
    });
}

// Setup Mapbox layer toggles
function setupMapboxLayerToggles() {
    // Polyline visibility toggle
    const togglePolylines = document.getElementById('toggle-polylines');
    if (togglePolylines) {
        togglePolylines.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ showPolylines: e.target.checked });
            }
            map.setLayoutProperty('polylines', 'visibility', e.target.checked ? 'visible' : 'none');
        });
    }

    // Polyline borders toggle (debug)
    const togglePolylineBorders = document.getElementById('toggle-polyline-borders');
    if (togglePolylineBorders) {
        togglePolylineBorders.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ showPolylineBorders: e.target.checked });
            }
            map.setLayoutProperty('polyline-borders', 'visibility', e.target.checked ? 'visible' : 'none');
        });
    }

    // Active segments toggle
    const toggleActiveSegments = document.getElementById('toggle-active-segments');
    if (toggleActiveSegments) {
        toggleActiveSegments.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ showActiveSegments: e.target.checked });
            }
            // Reload with new filtering
            loadSegments();
        });
    }

    // Inactive segments toggle
    const toggleInactiveSegments = document.getElementById('toggle-inactive-segments');
    if (toggleInactiveSegments) {
        toggleInactiveSegments.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ showInactiveSegments: e.target.checked });
            }
            // Reload with new filtering
            loadSegments();
        });
    }

    // Segment borders toggle (debug)
    const toggleSegmentBorders = document.getElementById('toggle-segment-borders');
    if (toggleSegmentBorders) {
        toggleSegmentBorders.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ showSegmentBorders: e.target.checked });
            }
            map.setLayoutProperty('segment-borders', 'visibility', e.target.checked ? 'visible' : 'none');
        });
    }

    // Transparency toggles
    const toggleSegmentTransparency = document.getElementById('toggle-segment-transparency');
    if (toggleSegmentTransparency) {
        toggleSegmentTransparency.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ segmentTransparent: e.target.checked });
            }
            // Reload with new opacity
            loadSegments();
        });
    }

    const toggleOffsetTransparency = document.getElementById('toggle-offset-transparency');
    if (toggleOffsetTransparency) {
        toggleOffsetTransparency.addEventListener('change', (e) => {
            // Update UI state
            if (window.uiControls) {
                window.uiControls.setState({ offsetTransparent: e.target.checked });
            }
            // Reload with new opacity
            loadSegments();
        });
    }
}

// Address search setup
function setupAddressSearch() {
    const searchInput = document.getElementById('addressSearch');
    const searchResults = document.getElementById('searchResults');

    if (!searchInput || !searchResults) return;

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
    if (!searchResults) return;

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

// Hover functionality
let hoverPopup = null;
let hoveredSegmentId = null;

// Create hover popup element
function createHoverPopup() {
    const popup = document.createElement('div');
    popup.id = 'feature-hover-popup';
    popup.style.cssText = `
        position: fixed;
        display: none;
        pointer-events: none;
        z-index: 10000;
        gap: 10px;
    `;
    document.body.appendChild(popup);
    return popup;
}

hoverPopup = createHoverPopup();

// Map hover handler - detects segments with proximity snapping
map.on('mousemove', (e) => {
    // Query features with a buffer for proximity detection
    const snapRadius = 20; // pixels
    const bbox = [
        [e.point.x - snapRadius, e.point.y - snapRadius],
        [e.point.x + snapRadius, e.point.y + snapRadius]
    ];

    const segmentFeatures = map.queryRenderedFeatures(bbox, {
        layers: ['segments']
    });

    // Find closest segment and snap point
    const { segment: closestSegment, snapPoint, distance } = findClosestSegment(e.point, segmentFeatures, snapRadius);

    // Also check for direct polyline hits (no snapping for polylines)
    const polylineFeatures = map.queryRenderedFeatures(e.point, {
        layers: ['polylines']
    });

    if (closestSegment || polylineFeatures.length > 0) {
        map.getCanvas().style.cursor = 'pointer';

        // Handle segment hover state with snapping
        if (closestSegment) {
            // Update snap indicator
            geojsonData.snapIndicator.features = [{
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [snapPoint.lng, snapPoint.lat]
                },
                properties: {}
            }];
            if (map.getSource('snap-indicator')) {
                map.getSource('snap-indicator').setData(geojsonData.snapIndicator);
            }

            // If hovering a different segment, clear previous hover state
            if (hoveredSegmentId !== null && hoveredSegmentId !== closestSegment.id) {
                map.setFeatureState(
                    { source: 'segments', id: hoveredSegmentId },
                    { hover: false }
                );
            }

            // Set hover state for closest segment
            hoveredSegmentId = closestSegment.id;
            map.setFeatureState(
                { source: 'segments', id: hoveredSegmentId },
                { hover: true }
            );
        } else if (hoveredSegmentId !== null) {
            // Clear hover state if no longer near a segment
            map.setFeatureState(
                { source: 'segments', id: hoveredSegmentId },
                { hover: false }
            );
            hoveredSegmentId = null;

            // Clear snap indicator
            geojsonData.snapIndicator.features = [];
            if (map.getSource('snap-indicator')) {
                map.getSource('snap-indicator').setData(geojsonData.snapIndicator);
            }
        }

        // Use either segment or polyline for popup
        const segment = closestSegment;
        const polyline = polylineFeatures.find(f => f.layer.id === 'polylines');

        // Build popup content
        let popupHTML = '<div style="display: flex; flex-direction: column; gap: 10px;">';

        // Show segment if present (already declared above at line 1315)
        if (segment) {
            const props = segment.properties;
            const lastPlowed = props.last_plowed ? new Date(props.last_plowed).toLocaleString() : 'Never';
            const lastPlowedFwd = props.last_plowed_forward ? new Date(props.last_plowed_forward).toLocaleString() : 'Never';
            const lastPlowedRev = props.last_plowed_reverse ? new Date(props.last_plowed_reverse).toLocaleString() : 'Never';

            popupHTML += `
                <div style="background: rgba(0, 0, 0, 0.9); color: white; padding: 12px; border-radius: 6px; font-size: 12px; font-family: monospace; line-height: 1.4; min-width: 300px;">
                    <div style="color: #00ff88; font-weight: bold; margin-bottom: 6px;">🛣️ SEGMENT #${props.segment_id}</div>
                    <div><span style="color: #888;">Street:</span> ${props.street_name || 'Unknown'}</div>
                    <div><span style="color: #888;">Classification:</span> ${props.road_classification || 'Unknown'}</div>
                    <div><span style="color: #888;">Bearing:</span> ${props.bearing !== null && props.bearing !== undefined ? props.bearing + '°' : 'Unknown'}</div>
                    <div><span style="color: #888;">Length:</span> ${props.segment_length ? props.segment_length.toFixed(1) + 'm' : 'Unknown'}</div>
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #444;">
                        <span style="color: #888;">Status:</span> ${props.is_activated ? '<span style="color: #00ff00;">✓ Activated</span>' : '<span style="color: #ff4444;">✗ Not Activated</span>'}
                    </div>
                    <div><span style="color: #888;">Last Plowed:</span> ${lastPlowed}</div>
                    <div style="font-size: 10px; color: #666; margin-left: 12px;">Forward: ${lastPlowedFwd}</div>
                    <div style="font-size: 10px; color: #666; margin-left: 12px;">Reverse: ${lastPlowedRev}</div>
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #444;">
                        <span style="color: #888;">Device ID:</span> ${props.device_id || 'Unknown'}
                    </div>
                    <div><span style="color: #888;">Plow Count Today:</span> ${props.plow_count_today || 0}</div>
                    <div><span style="color: #888;">Plow Count Total:</span> ${props.plow_count_total || 0}</div>
                </div>
            `;
        }

        // Show polyline if present
        if (polyline) {
            const props = polyline.properties;
            const polylineId = props.polyline_id || 'Unknown';
            const device = props.device || 'Unknown';
            const bearing = props.bearing ? `${Math.round(props.bearing)}°` : 'Unknown';
            const confidence = props.confidence ? `${(props.confidence * 100).toFixed(1)}%` : 'Unknown';
            const startTime = props.start_time ? new Date(props.start_time).toLocaleString() : 'Unknown';
            const endTime = props.end_time ? new Date(props.end_time).toLocaleString() : 'Unknown';
            const duration = calculateDuration(props.start_time, props.end_time) || 'Unknown';
            const isRaw = props.raw ? ' (Unmatched GPS points)' : '';

            popupHTML += `
                <div style="background: rgba(0, 0, 0, 0.9); color: white; padding: 12px; border-radius: 6px; font-size: 12px; font-family: monospace; line-height: 1.4; min-width: 300px;">
                    <div style="color: #6688ff; font-weight: bold; margin-bottom: 6px;">📍 POLYLINE #${polylineId}${isRaw}</div>
                    <div><span style="color: #888;">Device:</span> ${device}</div>
                    <div><span style="color: #888;">Bearing:</span> ${bearing}</div>
                    <div><span style="color: #888;">Confidence:</span> ${confidence}</div>
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #444;">
                        <span style="color: #888;">Start Time:</span><br>
                        <span style="margin-left: 12px; font-size: 12px;">${startTime}</span>
                    </div>
                    <div style="margin-top: 6px;">
                        <span style="color: #888;">End Time:</span><br>
                        <span style="margin-left: 12px; font-size: 12px;">${endTime}</span>
                    </div>
                    <div style="margin-top: 6px;">
                        <span style="color: #888;">Duration:</span> ${duration} minutes
                    </div>
                    ${isRaw ? '<div style="margin-top: 6px; color: #ff8844;">⚠️ OSRM matching failed for this path</div>' : ''}
                </div>
            `;
        }

        popupHTML += '</div>';
        hoverPopup.innerHTML = popupHTML;

        // Position popup near cursor
        setTimeout(() => {
            const popupHeight = hoverPopup.offsetHeight;
            const verticalOffset = -popupHeight / 2;

            hoverPopup.style.left = (e.point.x + 20) + 'px';
            hoverPopup.style.top = (e.point.y + verticalOffset) + 'px';
        }, 0);

        hoverPopup.style.display = 'flex';
    } else {
        map.getCanvas().style.cursor = '';
        hoverPopup.style.display = 'none';

        // Clear hover state when not hovering any features
        if (hoveredSegmentId !== null) {
            map.setFeatureState(
                { source: 'segments', id: hoveredSegmentId },
                { hover: false }
            );
            hoveredSegmentId = null;
        }

        // Clear snap indicator
        geojsonData.snapIndicator.features = [];
        if (map.getSource('snap-indicator')) {
            map.getSource('snap-indicator').setData(geojsonData.snapIndicator);
        }
    }
});

// Clear hover state when mouse leaves the map
map.on('mouseleave', () => {
    if (hoveredSegmentId !== null) {
        map.setFeatureState(
            { source: 'segments', id: hoveredSegmentId },
            { hover: false }
        );
        hoveredSegmentId = null;
    }
    hoverPopup.style.display = 'none';

    // Clear snap indicator
    geojsonData.snapIndicator.features = [];
    if (map.getSource('snap-indicator')) {
        map.getSource('snap-indicator').setData(geojsonData.snapIndicator);
    }
});

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

// Export for debugging
window.devState = {
    map,
    sources: {
        polylinesSource: geojsonData.polylines,
        segmentsSource: geojsonData.segments,
        forwardOffsetSource: geojsonData.forwardOffsets,
        reverseOffsetSource: geojsonData.reverseOffsets,
        boundarySource: geojsonData.boundary,
        searchResultSource: geojsonData.searchResult
    },
    layers: layers,
    currentTimeHours: () => currentTimeHours,
    reload: loadAllData
};

console.log('✅ Dev environment ready with Mapbox GL! Access state via window.devState');
