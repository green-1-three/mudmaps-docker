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
const segmentsSource = new VectorSource();
const userLocationSource = new VectorSource();
const searchResultSource = new VectorSource();

// Add layers to map (order matters for display)
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

// Global variable to store current time range
let currentTimeHours = 24;
let isSliderDragging = false; // Track if slider is being dragged

// Enhanced style function that can filter based on time while dragging
function createSegmentStyleWithFilter(feature) {
    // If dragging, check if feature should be visible based on time
    if (isSliderDragging) {
        const lastPlowed = feature.get('last_plowed');
        if (lastPlowed) {
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            const plowTime = new Date(lastPlowed).getTime();
            if (plowTime < cutoffTime) {
                return null; // Hide feature
            }
        }
    }
    
    // Normal style
    const lastPlowed = feature.get('last_plowed');
    const color = lastPlowed ? getColorByAge(lastPlowed) : '#0066cc';
    
    // Make segments thicker for better visibility
    return new Style({
        stroke: new Stroke({
            color: color,
            width: 4
        })
    });
}

// Load and display road segments
async function loadSegments() {
    try {
        showStatus('Loading road segments...');
        const startTime = performance.now();

        // Load all activated segments (last 7 days)
        const url = `${API_BASE}/segments?municipality=pomfret-vt`;
        console.log(`🛣️  Fetching segments from: ${url}`);
        
        const data = await fetchJSON(url);
        const fetchTime = performance.now() - startTime;
        console.log(`✅ Segments loaded in ${fetchTime.toFixed(0)}ms`);
        console.log('📦 Response data:', data);

        if (!data.features || data.features.length === 0) {
            showStatus('No activated segments found');
            console.log('⚠️ No segments in response');
            return;
        }

        console.log(`🛣️  Processing ${data.features.length} segment(s)`);

        // Clear existing features
        segmentsSource.clear();

        let totalSegments = 0;
        let segmentsWithinTimeRange = 0;

        // Create features from GeoJSON
        data.features.forEach(segment => {
            if (!segment.geometry || !segment.geometry.coordinates) {
                console.warn('⚠️ Segment missing geometry:', segment);
                return;
            }

            // Get the most recent plow time (forward or reverse)
            const forwardTime = segment.properties.last_plowed_forward 
                ? new Date(segment.properties.last_plowed_forward).getTime() 
                : 0;
            const reverseTime = segment.properties.last_plowed_reverse 
                ? new Date(segment.properties.last_plowed_reverse).getTime() 
                : 0;
            const lastPlowed = Math.max(forwardTime, reverseTime);
            const lastPlowedISO = lastPlowed > 0 ? new Date(lastPlowed).toISOString() : null;

            // Check if within current time range
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            if (lastPlowed >= cutoffTime) {
                segmentsWithinTimeRange++;
            }

            // Convert GeoJSON coordinates to OpenLayers format
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
                segment_length: segment.properties.segment_length
            });

            segmentsSource.addFeature(feature);
            totalSegments++;
        });

        const totalTime = performance.now() - startTime;
        console.log(`⚡ Total load time: ${totalTime.toFixed(0)}ms`);
        console.log(`📊 Segments: ${totalSegments} total, ${segmentsWithinTimeRange} within ${currentTimeHours}h range`);

        // Fit map to show segments from initial time range
        isSliderDragging = true; // Enable filtering
        segmentsSource.changed();
        isSliderDragging = false; // Disable filtering

        const allFeatures = segmentsSource.getFeatures();

        if (allFeatures.length > 0) {
            const extent = segmentsSource.getExtent();
            map.getView().fit(extent, {
                padding: [50, 50, 50, 50],
                maxZoom: 16,
                duration: 1000
            });
        }

        showStatus(`Loaded ${totalSegments} road segments (${segmentsWithinTimeRange} active in last ${currentTimeHours}h)`);

    } catch (err) {
        console.error('Failed to load segments:', err);
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
        segmentsSource.changed();
    });

    slider.addEventListener('change', (e) => {
        // Clear dragging flag
        isSliderDragging = false;
        
        // Update the time range and force re-render
        const index = parseInt(e.target.value);
        currentTimeHours = TIME_INTERVALS[index];
        segmentsSource.changed();
        
        // Update status
        const visibleCount = segmentsSource.getFeatures().filter(f => {
            const lastPlowed = f.get('last_plowed');
            if (!lastPlowed) return false;
            const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
            return new Date(lastPlowed).getTime() >= cutoffTime;
        }).length;
        
        showStatus(`Showing ${visibleCount} segments plowed in last ${currentTimeHours}h`);
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

function showStatus(message) {
    // Status div removed - log to console instead
    console.log(message);
}

function fitAllSegments() {
    const allFeatures = segmentsSource.getFeatures();

    if (allFeatures.length > 0) {
        const extent = segmentsSource.getExtent();
        map.getView().fit(extent, {
            padding: [50, 50, 50, 50],
            maxZoom: 16,
            duration: 1000
        });
    }
}

// Make functions available globally (keeping for compatibility)
window.fitAllSegments = fitAllSegments;

// User geolocation - center map on user's location
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition((pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        console.log('User location:', coords);
        
        // Center map on user's location
        map.getView().setCenter(fromLonLat(coords));
        map.getView().setZoom(13);
    }, (error) => {
        console.warn('Geolocation error:', error.message);
    }, { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 });
}

// Map click handler - show segment info
map.on('click', (event) => {
    const features = map.getFeaturesAtPixel(event.pixel);
    if (features.length > 0) {
        const feature = features[0];
        const streetName = feature.get('street_name');
        const lastPlowed = feature.get('last_plowed');
        const deviceId = feature.get('device_id');
        const plowCount = feature.get('plow_count_total');

        if (streetName) {
            const plowedText = lastPlowed 
                ? new Date(lastPlowed).toLocaleString() 
                : 'Unknown';
            const info = `${streetName} - Last plowed: ${plowedText} (Device: ${deviceId || 'Unknown'}, Total: ${plowCount || 0}x)`;
            showStatus(info);
            console.log('📍 Segment clicked:', info);
        }
    }
});

// Initialize
console.log('🗺️ Initializing MudMaps (SEGMENT-BASED)...');
createUI();
updateGradientLabels(currentTimeHours); // Set initial gradient labels
loadSegments();
