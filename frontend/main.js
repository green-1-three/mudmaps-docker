import './style.css';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { updateTimeDisplay, updateGradientLabels } from './utils.js';
import { TIME_INTERVALS, createTimeSliderHTML, setupTimeSlider } from './time-slider.js';
import { FIT_BOUNDS_PADDING, FIT_BOUNDS_MAX_ZOOM } from './map-config.js';
import {
    loadSegmentsFromAPI,
    calculateSegmentTimes,
    isWithinTimeRange,
    createLabelFeature,
    createSimpleSegmentFeature,
    createSimpleOffsetFeature
} from './map-data.js';
import {
    initializeMap,
    hideBaseMapLabels,
    setupBasicSources,
    setupBasicLayers,
    setupZoomDisplay
} from './map-init.js';

// Configuration
let API_BASE = import.meta.env.VITE_API_BASE;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

if (!API_BASE) {
    API_BASE = (window.location.hostname === 'localhost')
        ? 'http://localhost:3001'
        : '/api';
}

console.log('Using API_BASE:', API_BASE);

// Global variable to store current time range
let currentTimeHours = 168;

// Initialize map
const map = initializeMap('map', MAPBOX_TOKEN);

// GeoJSON data stores
const geojsonData = {
    segments: { type: 'FeatureCollection', features: [] },
    forwardOffsets: { type: 'FeatureCollection', features: [] },
    reverseOffsets: { type: 'FeatureCollection', features: [] },
    allSegmentsLabels: { type: 'FeatureCollection', features: [] }
};

// Setup zoom display
setupZoomDisplay(map, 'zoom-display');

// Map load event - add sources and layers
map.on('load', () => {
    hideBaseMapLabels(map);
    setupBasicSources(map, geojsonData);
    setupBasicLayers(map);
    loadAllData();
});

// Load segments
async function loadSegments() {
    try {
        const segments = await loadSegmentsFromAPI(API_BASE);
        if (!segments || segments.length === 0) {
            return;
        }

        const segmentFeatures = [];
        const forwardOffsetFeatures = [];
        const reverseOffsetFeatures = [];
        const allSegmentsLabelFeatures = [];

        segments.forEach(segment => {
            if (!segment.geometry?.coordinates) {
                return;
            }

            // Add ALL segments to labels collection
            const labelFeature = createLabelFeature(segment);
            if (labelFeature) {
                allSegmentsLabelFeatures.push(labelFeature);
            }

            // Calculate timing information
            const { lastPlowedISO, isActivated } = calculateSegmentTimes(segment);

            // Skip inactive segments for display (labels already added)
            if (!isActivated) {
                return;
            }

            // Filter by time range
            if (!isWithinTimeRange(lastPlowedISO, currentTimeHours)) {
                return;
            }

            // Add segment
            segmentFeatures.push(createSimpleSegmentFeature(segment, lastPlowedISO, currentTimeHours));

            // Add forward offset
            if (segment.vertices_forward?.coordinates && segment.properties.last_plowed_forward) {
                if (isWithinTimeRange(segment.properties.last_plowed_forward, currentTimeHours)) {
                    forwardOffsetFeatures.push(
                        createSimpleOffsetFeature(
                            segment.vertices_forward,
                            segment.properties.last_plowed_forward,
                            currentTimeHours
                        )
                    );
                }
            }

            // Add reverse offset
            if (segment.vertices_reverse?.coordinates && segment.properties.last_plowed_reverse) {
                if (isWithinTimeRange(segment.properties.last_plowed_reverse, currentTimeHours)) {
                    reverseOffsetFeatures.push(
                        createSimpleOffsetFeature(
                            segment.vertices_reverse,
                            segment.properties.last_plowed_reverse,
                            currentTimeHours
                        )
                    );
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

            map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING, maxZoom: FIT_BOUNDS_MAX_ZOOM });
        }
    } catch (err) {
        console.error('Failed to load data:', err);
    }
}

// Create simple time slider UI
function createUI() {
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'controls';
    controlsDiv.innerHTML = createTimeSliderHTML();
    document.body.appendChild(controlsDiv);

    setupTimeSlider((hours) => {
        currentTimeHours = hours;
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
