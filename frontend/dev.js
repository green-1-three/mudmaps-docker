import './dev.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Feature } from 'ol';
import { Point, LineString, Polygon } from 'ol/geom';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Icon, Stroke, Fill, Text } from 'ol/style';

// Import modules
import { 
    decodePolyline, 
    fetchJSON, 
    interpolateColor, 
    getColorByAge,
    formatTimeLabel,
    showStatus,
    formatTimestamp,
    calculateDuration
} from './dev-common.js';
import { initStatistics, updateStatistics } from './dev-stats.js';
import { initUIControls, setStyleCreators } from './dev-ui-controls.js';
import { initDatabaseTab, highlightTableRow } from './dev-database.js';

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

// Create crosshatch pattern for out-of-range segments (created once, reused for all segments)
let crosshatchPattern = null;

function createCrosshatchPattern() {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = 8 * pixelRatio;
    canvas.height = 8 * pixelRatio;
    context.scale(pixelRatio, pixelRatio);
    
    // Draw crosshatch pattern
    context.strokeStyle = '#999';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(8, 8);
    context.moveTo(8, 0);
    context.lineTo(0, 8);
    context.stroke();
    
    crosshatchPattern = context.createPattern(canvas, 'repeat');
}

// Create crosshatch pattern on load
createCrosshatchPattern();

// Map setup with OpenStreetMap
const map = new Map({
    target: 'map',
    layers: [new TileLayer({ 
        source: new XYZ({
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            attributions: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        })
    })],
    view: new View({ center: fromLonLat([0, 0]), zoom: 2 })
});

// Vector sources for different layers
const boundarySource = new VectorSource();
const polylinesSource = new VectorSource();
const segmentsSource = new VectorSource();
const userLocationSource = new VectorSource();
const searchResultSource = new VectorSource();

// Layer references for toggling
let polylinesLayer;
let segmentsLayer;

// Global variable to store current time range
let currentTimeHours = 168;

// Add layers to map (order matters for display)
// Boundary at bottom (zIndex: 0.1)
map.addLayer(new VectorLayer({
    source: boundarySource,
    zIndex: 0.1,
    style: new Style({
        stroke: new Stroke({
            color: 'rgba(255, 255, 255, 0.4)',
            width: 2,
            lineDash: [5, 5]
        }),
        fill: new Fill({
            color: 'rgba(255, 255, 255, 0.02)'
        })
    })
}));

// Polylines behind (zIndex: 0.5)
polylinesLayer = new VectorLayer({
    source: polylinesSource,
    zIndex: 0.5,
    style: createPolylineStyleWithFilter
});
map.addLayer(polylinesLayer);

// Segments on top (zIndex: 1)
segmentsLayer = new VectorLayer({
    source: segmentsSource,
    zIndex: 1,
    style: createSegmentStyleWithFilter
});
map.addLayer(segmentsLayer);

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

// Style for polylines - blue, thin, behind segments
function createPolylineStyleWithFilter(feature) {
    const endTime = feature.get('end_time');
    if (endTime) {
        const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
        const polylineTime = new Date(endTime).getTime();
        if (polylineTime < cutoffTime) {
            return null;
        }
    }
    
    return new Style({
        stroke: new Stroke({
            color: '#4444ff',  // Blue
            width: 2
        })
    });
}

// Style for segments - gradient colors for activated, red for unactivated, gray crosshatch for out-of-range
function createSegmentStyleWithFilter(feature) {
    const isActivated = feature.get('is_activated');
    
    // Unactivated segments: always show in red
    if (!isActivated) {
        return new Style({
            stroke: new Stroke({
                color: '#ff0000',  // Red
                width: 3
            })
        });
    }
    
    // Activated segments: check if within time range
    const lastPlowed = feature.get('last_plowed');
    if (lastPlowed) {
        const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
        const plowTime = new Date(lastPlowed).getTime();
        
        // Out of range: show in gray with crosshatch pattern (reuse pre-created pattern)
        if (plowTime < cutoffTime) {
            return new Style({
                stroke: new Stroke({
                    color: crosshatchPattern,
                    width: 4
                })
            });
        }
    }
    
    const color = lastPlowed ? getColorByAge(lastPlowed, currentTimeHours) : '#0066cc';
    
    return new Style({
        stroke: new Stroke({
            color: color,
            width: 4
        })
    });
}

// Helper function to create polyline style with optional borders
function createPolylineStyleWithBorders(feature) {
    const baseStyle = createPolylineStyleWithFilter(feature);
    const uiState = window.uiControls?.getState();
    
    if (!baseStyle || !uiState?.showPolylineBorders) {
        return baseStyle;
    }
    
    // Add a white border around polylines when borders are enabled
    return [
        // White border (drawn first, underneath)
        new Style({
            stroke: new Stroke({
                color: '#ffffff',
                width: 4
            })
        }),
        // Original blue stroke on top
        baseStyle
    ];
}

// Helper function to create segment style with optional borders
function createSegmentStyleWithBorders(feature) {
    const baseStyle = createSegmentStyleWithFilter(feature);
    const uiState = window.uiControls?.getState();
    
    if (!baseStyle || !uiState?.showSegmentBorders) {
        return baseStyle;
    }
    
    // Add a white border around segments when borders are enabled
    const isActivated = feature.get('is_activated');
    const baseColor = isActivated 
        ? (feature.get('last_plowed') ? getColorByAge(feature.get('last_plowed'), currentTimeHours) : '#0066cc')
        : '#ff0000';
    
    return [
        // White border (drawn first, underneath)
        new Style({
            stroke: new Stroke({
                color: '#ffffff',
                width: isActivated ? 6 : 5
            })
        }),
        // Original colored stroke on top
        baseStyle
    ];
}

// Load polylines from backend
async function loadPolylines() {
    try {
        showStatus('Loading polylines...');
        const startTime = performance.now();

        const url = `${API_BASE}/paths/encoded?hours=168`;
        console.log(`🛣️  Fetching polylines from: ${url}`);
        
        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Polylines loaded in ${fetchTime.toFixed(0)}ms`);
        console.log('📦 Polyline response:', data);

        if (!data.devices || data.devices.length === 0) {
            console.log('⚠️ No devices/polylines in response');
            return;
        }

        polylinesSource.clear();

        let totalPolylines = 0;

        for (const device of data.devices) {
            // Handle batched paths (these have IDs from database)
            if (device.batches && device.batches.length > 0) {
                for (const batch of device.batches) {
                    if (batch.success && batch.encoded_polyline) {
                        const coords = decodePolyline(batch.encoded_polyline);
                        const projectedCoords = coords.map(coord => fromLonLat(coord));
                        
                        const feature = new Feature({
                            geometry: new LineString(projectedCoords),
                            device: device.device,
                            start_time: batch.start_time,
                            end_time: batch.end_time,
                            bearing: batch.bearing,
                            confidence: batch.confidence,
                            type: 'polyline',
                            polyline_id: batch.id
                        });
                        
                        polylinesSource.addFeature(feature);
                        totalPolylines++;
                    }
                }
            }
            // Handle single encoded path (fallback - no database ID available)
            else if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                const projectedCoords = coords.map(coord => fromLonLat(coord));
                
                const feature = new Feature({
                    geometry: new LineString(projectedCoords),
                    device: device.device,
                    start_time: device.start_time,
                    end_time: device.end_time,
                    type: 'polyline',
                    polyline_id: null  // No database ID for single encoded paths
                });
                
                polylinesSource.addFeature(feature);
                totalPolylines++;
            }
            // Handle raw coordinates fallback (when OSRM fails - no database ID)
            else if (device.raw_coordinates && device.raw_coordinates.length > 0) {
                const projectedCoords = device.raw_coordinates.map(coord => fromLonLat(coord));
                
                const feature = new Feature({
                    geometry: new LineString(projectedCoords),
                    device: device.device,
                    start_time: device.start_time,
                    end_time: device.end_time,
                    type: 'polyline',
                    raw: true,  // Mark as unmatched
                    polyline_id: null  // No database ID for raw coordinates
                });
                
                polylinesSource.addFeature(feature);
                totalPolylines++;
            }
        }

        console.log(`📊 Loaded ${totalPolylines} polylines`);
        showStatus(`Loaded ${totalPolylines} polylines`);
        
        // Update statistics
        updateStatistics();

    } catch (err) {
        console.error('Failed to load polylines:', err);
    }
}

// Load municipality boundary
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

        boundarySource.clear();

        // Handle MultiPolygon geometry
        if (data.geometry.type === 'MultiPolygon') {
            data.geometry.coordinates.forEach(polygonCoords => {
                // Each polygon is an array of rings (first is outer, rest are holes)
                const rings = polygonCoords.map(ring => 
                    ring.map(coord => fromLonLat(coord))
                );
                
                const feature = new Feature({
                    geometry: new Polygon(rings),
                    name: data.properties.name,
                    state: data.properties.state,
                    type: 'boundary'
                });
                
                boundarySource.addFeature(feature);
            });
        } else if (data.geometry.type === 'Polygon') {
            const rings = data.geometry.coordinates.map(ring => 
                ring.map(coord => fromLonLat(coord))
            );
            
            const feature = new Feature({
                geometry: new Polygon(rings),
                name: data.properties.name,
                state: data.properties.state,
                type: 'boundary'
            });
            
            boundarySource.addFeature(feature);
        }

        console.log(`🗺️  Boundary loaded for ${data.properties.name}, ${data.properties.state}`);

    } catch (err) {
        console.error('Failed to load boundary:', err);
        // Don't show error to user - boundary is optional
    }
}

// Load and display road segments
async function loadSegments() {
    try {
        showStatus('Loading road segments...');
        const startTime = performance.now();

        const url = `${API_BASE}/segments?municipality=pomfret-vt&all=true`;
        console.log(`🛣️  Fetching segments from: ${url}`);
        
        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Segments loaded in ${fetchTime.toFixed(0)}ms`);
        console.log('📦 Segment response:', data);

        if (!data.features || data.features.length === 0) {
            showStatus('No segments found');
            console.log('⚠️ No segments in response');
            return;
        }

        console.log(`🛣️  Processing ${data.features.length} segment(s)`);

        segmentsSource.clear();

        let totalSegments = 0;
        let activatedSegments = 0;
        let segmentsWithinTimeRange = 0;

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

            if (isActivated) {
                activatedSegments++;
                const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
                if (lastPlowed >= cutoffTime) {
                    segmentsWithinTimeRange++;
                }
            }

            const coordinates = segment.geometry.coordinates.map(coord => fromLonLat(coord));

            const feature = new Feature({
                geometry: new LineString(coordinates),
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
                type: 'segment'
            });

            segmentsSource.addFeature(feature);
            totalSegments++;
        });

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total segment load time: ${totalTime.toFixed(0)}ms`);
        console.log(`📊 Segments: ${totalSegments} total, ${activatedSegments} activated, ${totalSegments - activatedSegments} unactivated, ${segmentsWithinTimeRange} within ${currentTimeHours}h range`);

        showStatus(`Loaded ${totalSegments} segments (${activatedSegments} activated, ${totalSegments - activatedSegments} unactivated)`);
        
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
        
        // Load in parallel
        await Promise.all([
            loadBoundary(),
            loadPolylines(),
            loadSegments()
        ]);

        // Fit map to show all features
        polylinesSource.changed();
        segmentsSource.changed();

        const allFeatures = [
            ...polylinesSource.getFeatures(),
            ...segmentsSource.getFeatures()
        ];

        if (allFeatures.length > 0) {
            const extent = segmentsSource.getFeatures().length > 0 
                ? segmentsSource.getExtent() 
                : polylinesSource.getExtent();
                
            map.getView().fit(extent, {
                padding: [50, 50, 50, 50],
                maxZoom: 16,
                duration: 1000
            });
        }

        const polylineCount = polylinesSource.getFeatures().length;
        const segmentCount = segmentsSource.getFeatures().length;
        showStatus(`Loaded ${polylineCount} polylines, ${segmentCount} segments`);

    } catch (err) {
        console.error('Failed to load data:', err);
        showStatus(`Error: ${err.message}`);
    }
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

    // Control panel (top-right)
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'controls';
    controlsDiv.innerHTML = `
        <div class="control-panel">
            <h3>Latest Snowplow Activity</h3>
            
            <div class="control-group">
                <label for="timeRange">Time Range:</label>
                <input type="range" id="timeRange" min="0" max="6" value="6" step="1">
                <div class="time-display">
                    <span id="timeValue">Last 7 days</span>
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

    // Zoom level indicator (bottom-right)
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
        
        // Trigger re-render of layers
        polylinesSource.changed();
        segmentsSource.changed();
        
        // Update statistics when time range changes
        if (window.updateStatsWithTimeRange) {
            window.updateStatsWithTimeRange(hours);
        }
    });

    slider.addEventListener('change', (e) => {
        const index = parseInt(e.target.value);
        currentTimeHours = TIME_INTERVALS[index];
        
        // Final re-render
        polylinesSource.changed();
        segmentsSource.changed();
        
        const visibleSegments = segmentsSource.getFeatures().filter(f => {
            const lastPlowed = f.get('last_plowed');
            if (!lastPlowed) return false;
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            return new Date(lastPlowed).getTime() >= cutoffTime;
        }).length;
        
        const visiblePolylines = polylinesSource.getFeatures().filter(f => {
            const endTime = f.get('end_time');
            if (!endTime) return false;
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            return new Date(endTime).getTime() >= cutoffTime;
        }).length;
        
        showStatus(`Showing ${visiblePolylines} polylines, ${visibleSegments} segments`);
        
        // Update statistics after time range change
        if (window.updateStatsWithTimeRange) {
            window.updateStatsWithTimeRange(currentTimeHours);
        }
    });
}

function setupZoomIndicator() {
    const updateZoom = () => {
        const zoom = map.getView().getZoom();
        const zoomLevel = document.getElementById('zoomLevel');
        if (zoomLevel) {
            zoomLevel.textContent = zoom.toFixed(2);
        }
    };
    
    map.getView().on('change:resolution', updateZoom);
    updateZoom();
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
        const view = map.getView();
        const center = view.getCenter();
        const centerLonLat = toLonLat(center);
        
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
    const lon = result.center[0];
    const lat = result.center[1];

    const addressParts = result.place_name.split(',').map(s => s.trim());
    let displayAddress = '';
    
    if (addressParts.length >= 3) {
        displayAddress = `${addressParts[0]}, ${addressParts[1]}, ${addressParts[2]}`;
    } else {
        displayAddress = addressParts[0];
    }

    searchResultSource.clear();

    const feature = new Feature({
        geometry: new Point(fromLonLat([lon, lat])),
        name: displayAddress
    });

    searchResultSource.addFeature(feature);

    const searchInput = document.getElementById('addressSearch');
    if (searchInput) {
        searchInput.value = result.place_name;
    }

    map.getView().animate({
        center: fromLonLat([lon, lat]),
        zoom: 16,
        duration: 1000
    });

    console.log(`📍 Searched location: ${result.place_name}`);
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

// Hover functionality for segments and polylines
let hoveredFeatures = [];
let hoverPopup = null;

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

// Hover style for features - makes them "pop"
function createHoverStyle(feature) {
    const featureType = feature.get('type');
    
    if (featureType === 'segment') {
        const isActivated = feature.get('is_activated');
        const lastPlowed = feature.get('last_plowed');
        const color = isActivated && lastPlowed ? getColorByAge(lastPlowed, currentTimeHours) : (isActivated ? '#0066cc' : '#ff0000');
        
        return [
            // Glow effect (underneath)
            new Style({
                stroke: new Stroke({
                    color: 'rgba(255, 255, 255, 0.8)',
                    width: 10
                })
            }),
            // Main stroke (on top, thicker)
            new Style({
                stroke: new Stroke({
                    color: color,
                    width: 6
                })
            })
        ];
    } else if (featureType === 'polyline') {
        return [
            // Glow effect (underneath)
            new Style({
                stroke: new Stroke({
                    color: 'rgba(255, 255, 255, 0.8)',
                    width: 8
                })
            }),
            // Main stroke (on top, thicker)
            new Style({
                stroke: new Stroke({
                    color: '#4444ff',
                    width: 4
                })
            })
        ];
    }
    
    return null;
}

// Map hover handler - detects both segments and polylines
map.on('pointermove', (event) => {
    // Get all features at pixel (both segments and polylines)
    const segmentFeatures = map.getFeaturesAtPixel(event.pixel, {
        layerFilter: (layer) => layer === segmentsLayer
    });
    
    const polylineFeatures = map.getFeaturesAtPixel(event.pixel, {
        layerFilter: (layer) => layer === polylinesLayer
    });
    
    const allFeatures = [...segmentFeatures, ...polylineFeatures];
    
    if (allFeatures.length > 0) {
        // Check if features have changed
        const featuresChanged = hoveredFeatures.length !== allFeatures.length || 
            !hoveredFeatures.every((f, i) => f === allFeatures[i]);
        
        if (featuresChanged) {
            // Reset previous hovered features
            hoveredFeatures.forEach(f => f.setStyle(undefined));
            
            // Set new hovered features
            hoveredFeatures = allFeatures;
            hoveredFeatures.forEach(f => f.setStyle(createHoverStyle(f)));
            
            // Build popup content with boxes stacked vertically
            let popupHTML = '<div style="display: flex; flex-direction: column; gap: 10px;">';
            
            // Segment box (left)
            const segment = segmentFeatures[0];
            if (segment) {
                const props = segment.getProperties();
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
            
            // Polyline box (right)
            const polyline = polylineFeatures[0];
            if (polyline) {
                const props = polyline.getProperties();
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
        }
        
        // Position popup near cursor
        // Calculate total height to center vertically around cursor
        // Wait for next frame to get accurate dimensions after content is set
        setTimeout(() => {
            const popupHeight = hoverPopup.offsetHeight;
            const verticalOffset = -popupHeight / 2;
            
            hoverPopup.style.left = (event.pixel[0] + 20) + 'px';
            hoverPopup.style.top = (event.pixel[1] + verticalOffset) + 'px';
        }, 0);
        
        hoverPopup.style.display = 'flex';
        
        // Change cursor
        map.getTargetElement().style.cursor = 'pointer';
    } else {
        // Reset when not hovering over any feature
        if (hoveredFeatures.length > 0) {
            hoveredFeatures.forEach(f => f.setStyle(undefined));
            hoveredFeatures = [];
        }
        hoverPopup.style.display = 'none';
        map.getTargetElement().style.cursor = '';
    }
});

// Helper function to switch to database tab
function switchToDatabaseTab() {
    // Find and click the database tab
    const databaseTab = document.querySelector('.dev-tab[data-tab="database"]');
    if (databaseTab && !databaseTab.classList.contains('active')) {
        databaseTab.click();
    }
}

// Map click handler
map.on('click', (event) => {
    // Get all features at click point (both segments and polylines)
    const allFeatures = map.getFeaturesAtPixel(event.pixel);
    
    if (allFeatures.length > 0) {
        // Separate segments and polylines
        const segments = allFeatures.filter(f => f.get('type') === 'segment');
        const polylines = allFeatures.filter(f => f.get('type') === 'polyline');
        
        // Handle segment
        if (segments.length > 0) {
            const feature = segments[0];
            const streetName = feature.get('street_name');
            const lastPlowed = feature.get('last_plowed');
            const deviceId = feature.get('device_id');
            const plowCount = feature.get('plow_count_total');
            const segmentId = feature.get('segment_id');
            
            const plowedText = lastPlowed 
                ? new Date(lastPlowed).toLocaleString() 
                : 'Unknown';
            const info = `SEGMENT: ${streetName} - Last plowed: ${plowedText} (Device: ${deviceId || 'Unknown'}, Total: ${plowCount || 0}x)`;
            showStatus(info);
            console.log('📍 Segment clicked:', info);
            
            // Highlight segment in database tab
            if (window.databaseTab && segmentId) {
                switchToDatabaseTab();
                highlightTableRow('road_segments', segmentId);
            }
        }
        
        // Handle polyline (if also present)
        if (polylines.length > 0) {
            const feature = polylines[0];
            const polylineId = feature.get('polyline_id');
            const device = feature.get('device');
            const bearing = feature.get('bearing');
            const confidence = feature.get('confidence');
            const startTime = feature.get('start_time');
            const endTime = feature.get('end_time');
            
            const startText = startTime ? new Date(startTime).toLocaleString() : 'Unknown';
            const endText = endTime ? new Date(endTime).toLocaleString() : 'Unknown';
            const bearingText = bearing ? `${Math.round(bearing)}°` : 'Unknown';
            const confidenceText = confidence ? `${(confidence * 100).toFixed(1)}%` : 'Unknown';
            
            const info = `POLYLINE #${polylineId || 'Unknown'} - Device: ${device || 'Unknown'}, Bearing: ${bearingText}, Confidence: ${confidenceText}, Start: ${startText}, End: ${endText}`;
            showStatus(info);
            console.log('📍 Polyline clicked:', info);
            
            // Highlight polyline in database tab (only if polyline has an ID)
            if (window.databaseTab && polylineId) {
                switchToDatabaseTab();
                highlightTableRow('cached_polylines', polylineId);
            } else if (!polylineId) {
                console.warn('⚠️ Polyline has no database ID - cannot show in database inspector');
            }
        }
    }
});

// Developer Panel Functionality
function initDevPanel() {
    const panel = document.getElementById('dev-panel');
    const resizeHandle = document.querySelector('.dev-panel-resize-handle');
    const collapseBtn = document.querySelector('.dev-panel-collapse');
    const tabs = document.querySelectorAll('.dev-tab');
    
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
        map.updateSize();
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Final map size update
            map.updateSize();
        }
    });
    
    // Collapse functionality
    collapseBtn.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        const isCollapsed = panel.classList.contains('collapsed');
        
        collapseBtn.innerHTML = isCollapsed ? '&larr;' : '&rarr;';
        collapseBtn.title = isCollapsed ? 'Expand Panel' : 'Collapse Panel';
        
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
            map.updateSize();
        }, 300);
    });
    
    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active content
            document.querySelectorAll('.dev-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const targetContent = document.querySelector(`[data-tab-content="${tabName}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

// Function to highlight map features from database clicks
window.highlightMapFeature = function(tableName, rowData) {
    if (tableName === 'road_segments') {
        // Find and highlight the segment on the map
        const features = segmentsSource.getFeatures();
        const segment = features.find(f => f.get('segment_id') === rowData.id);
        if (segment) {
            // Flash the segment
            const originalStyle = segment.getStyle();
            segment.setStyle(createHoverStyle(segment));
            setTimeout(() => segment.setStyle(originalStyle), 1000);
            
            // Pan to segment
            const extent = segment.getGeometry().getExtent();
            map.getView().fit(extent, {
                padding: [100, 100, 100, 100],
                maxZoom: 18,
                duration: 500
            });
        }
    } else if (tableName === 'cached_polylines') {
        // Find and highlight the polyline on the map
        const features = polylinesSource.getFeatures();
        const polyline = features.find(f => f.get('polyline_id') === rowData.id);
        if (polyline) {
            // Flash the polyline
            const originalStyle = polyline.getStyle();
            polyline.setStyle(createHoverStyle(polyline));
            setTimeout(() => polyline.setStyle(originalStyle), 1000);
            
            // Pan to polyline
            const extent = polyline.getGeometry().getExtent();
            map.getView().fit(extent, {
                padding: [100, 100, 100, 100],
                maxZoom: 16,
                duration: 500
            });
        }
    } else if (tableName === 'gps_raw_data') {
        // Create a temporary marker for the GPS point
        const tempFeature = new Feature({
            geometry: new Point(fromLonLat([rowData.longitude, rowData.latitude]))
        });
        
        // Add temporary marker
        searchResultSource.clear();
        searchResultSource.addFeature(tempFeature);
        
        // Pan to point
        map.getView().animate({
            center: fromLonLat([rowData.longitude, rowData.latitude]),
            zoom: 18,
            duration: 500
        });
        
        // Remove marker after 3 seconds
        setTimeout(() => searchResultSource.clear(), 3000);
    }
};

// Initialize modules
console.log('🗺️ Initializing MudMaps Developer Mode...');
createUI();
updateGradientLabels(currentTimeHours);
initDevPanel();

// Initialize statistics module
const statsModule = initStatistics(
    { polylinesSource, segmentsSource },
    currentTimeHours
);

// Make stats update function globally accessible
window.updateStatsWithTimeRange = (hours) => {
    statsModule.setTimeRange(hours);
};

// Initialize UI controls module with style creators
setStyleCreators(createPolylineStyleWithBorders, createSegmentStyleWithBorders);
const uiControls = initUIControls(
    { polylinesLayer, segmentsLayer },
    updateStatistics
);
window.uiControls = uiControls;

// Initialize database tab
const databaseTab = initDatabaseTab(API_BASE, { 
    polylinesSource, 
    segmentsSource, 
    boundarySource 
});
window.databaseTab = databaseTab;

// Load initial data
loadAllData().then(() => {
    // Only use geolocation if no features were loaded
    const allFeatures = [
        ...polylinesSource.getFeatures(),
        ...segmentsSource.getFeatures()
    ];
    
    if (allFeatures.length === 0 && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            console.log('User location:', coords);
            
            map.getView().setCenter(fromLonLat(coords));
            map.getView().setZoom(13);
        }, (error) => {
            console.warn('Geolocation error:', error.message);
        }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
    }
});

// Export for debugging
window.devState = {
    map,
    sources: { 
        polylinesSource, 
        segmentsSource, 
        boundarySource,
        userLocationSource,
        searchResultSource
    },
    layers: { polylinesLayer, segmentsLayer },
    modules: { statsModule, uiControls, databaseTab },
    currentTimeHours: () => currentTimeHours,
    reload: loadAllData
};

console.log('✅ Dev environment ready! Access state via window.devState');
