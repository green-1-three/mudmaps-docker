import './style.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Feature } from 'ol';
import { Point, LineString, Polygon } from 'ol/geom';
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

// Map setup with OpenStreetMap (clean, readable basemap similar to Google Maps)
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
map.addLayer(new VectorLayer({
    source: polylinesSource,
    zIndex: 0.5,
    style: createPolylineStyleWithFilter
}));

// Segments on top (zIndex: 1)
map.addLayer(new VectorLayer({
    source: segmentsSource,
    zIndex: 1,
    style: createSegmentStyleWithFilter
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

// Global variable to store current time range
let currentTimeHours = 24;

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

// Style for segments - gradient colors for activated, red for unactivated, thicker, on top
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
    
    // Activated segments: apply time filter and gradient
    const lastPlowed = feature.get('last_plowed');
    if (lastPlowed) {
        const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
        const plowTime = new Date(lastPlowed).getTime();
        if (plowTime < cutoffTime) {
            return null;  // Hide segments older than the time range
        }
    }
    
    const color = lastPlowed ? getColorByAge(lastPlowed) : '#0066cc';
    
    return new Style({
        stroke: new Stroke({
            color: color,
            width: 4
        })
    });
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
            // Handle single encoded path
            if (device.encoded_path) {
                const coords = decodePolyline(device.encoded_path);
                const projectedCoords = coords.map(coord => fromLonLat(coord));
                
                const feature = new Feature({
                    geometry: new LineString(projectedCoords),
                    device: device.device,
                    start_time: device.start_time,
                    end_time: device.end_time,
                    type: 'polyline'
                });
                
                polylinesSource.addFeature(feature);
                totalPolylines++;
            }
            
            // Handle batched paths
            if (device.batches && device.batches.length > 0) {
                for (const batch of device.batches) {
                    if (batch.success && batch.encoded_polyline) {
                        const coords = decodePolyline(batch.encoded_polyline);
                        const projectedCoords = coords.map(coord => fromLonLat(coord));
                        
                        const feature = new Feature({
                            geometry: new LineString(projectedCoords),
                            device: device.device,
                            start_time: device.start_time,
                            end_time: device.end_time,
                            type: 'polyline'
                        });
                        
                        polylinesSource.addFeature(feature);
                        totalPolylines++;
                    }
                }
            }
            
            // Handle raw coordinates fallback (when OSRM fails)
            if (device.raw_coordinates && device.raw_coordinates.length > 0) {
                const projectedCoords = device.raw_coordinates.map(coord => fromLonLat(coord));
                
                const feature = new Feature({
                    geometry: new LineString(projectedCoords),
                    device: device.device,
                    start_time: device.start_time,
                    end_time: device.end_time,
                    type: 'polyline',
                    raw: true  // Mark as unmatched
                });
                
                polylinesSource.addFeature(feature);
                totalPolylines++;
            }
        }

        console.log(`📊 Loaded ${totalPolylines} polylines`);
        showStatus(`Loaded ${totalPolylines} polylines`);

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

    } catch (err) {
        console.error('Failed to load segments:', err);
        showStatus(`Error: ${err.message}`);
    }
}

// Load both polylines and segments
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
        
        map.getView().setCenter(fromLonLat(coords));
        map.getView().setZoom(13);
    }, (error) => {
        console.warn('Geolocation error:', error.message);
    }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
}

// Map click handler
map.on('click', (event) => {
    const features = map.getFeaturesAtPixel(event.pixel);
    if (features.length > 0) {
        const feature = features[0];
        const type = feature.get('type');
        
        if (type === 'segment') {
            const streetName = feature.get('street_name');
            const lastPlowed = feature.get('last_plowed');
            const deviceId = feature.get('device_id');
            const plowCount = feature.get('plow_count_total');
            
            const plowedText = lastPlowed 
                ? new Date(lastPlowed).toLocaleString() 
                : 'Unknown';
            const info = `SEGMENT: ${streetName} - Last plowed: ${plowedText} (Device: ${deviceId || 'Unknown'}, Total: ${plowCount || 0}x)`;
            showStatus(info);
            console.log('📍 Segment clicked:', info);
        } else if (type === 'polyline') {
            const device = feature.get('device');
            const startTime = feature.get('start_time');
            const endTime = feature.get('end_time');
            
            const info = `POLYLINE: Device ${device} from ${new Date(startTime).toLocaleString()} to ${new Date(endTime).toLocaleString()}`;
            showStatus(info);
            console.log('📍 Polyline clicked:', info);
        }
    }
});

// Initialize
console.log('🗺️ Initializing MudMaps (POLYLINES + SEGMENTS)...');
createUI();
updateGradientLabels(currentTimeHours);
loadAllData();
