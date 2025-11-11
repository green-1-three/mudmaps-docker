/**
 * Map Initialization Module
 * Shared functions for initializing and configuring Mapbox GL maps
 */

import mapboxgl from 'mapbox-gl';
import {
    DEFAULT_MAP_CENTER,
    DEFAULT_MAP_ZOOM,
    MAP_STYLE,
    createSegmentLabelsLayer,
    createForwardOffsetsLayer,
    createReverseOffsetsLayer,
    createSegmentsLayer
} from './map-config.js';

/**
 * Initialize a Mapbox GL map
 */
export function initializeMap(containerId, mapboxToken) {
    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
        container: containerId,
        style: MAP_STYLE,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM
    });

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    return map;
}

/**
 * Hide base map labels
 */
export function hideBaseMapLabels(map) {
    const style = map.getStyle();
    style.layers.forEach(layer => {
        if (layer.type === 'symbol' && layer.layout?.['text-field']) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
    });
}

/**
 * Add basic map sources (segments, offsets, labels)
 */
export function setupBasicSources(map, geojsonData) {
    const segmentSourceConfig = {
        type: 'geojson',
        data: geojsonData.segments
    };

    // Only add promoteId if it's defined
    if (geojsonData.promoteId) {
        segmentSourceConfig.promoteId = geojsonData.promoteId;
    }

    map.addSource('segments', segmentSourceConfig);
    map.addSource('forward-offsets', {
        type: 'geojson',
        data: geojsonData.forwardOffsets
    });
    map.addSource('reverse-offsets', {
        type: 'geojson',
        data: geojsonData.reverseOffsets
    });
    map.addSource('all-segments-labels', {
        type: 'geojson',
        data: geojsonData.allSegmentsLabels
    });
}

/**
 * Add basic map layers (offsets, segments, labels)
 * @param {Object} options - Configuration options
 * @param {boolean} options.enableHoverAndSelection - Enable hover and selection for segments
 */
export function setupBasicLayers(map, options = {}) {
    const { enableHoverAndSelection = false } = options;

    // Add layers in correct order (bottom to top)
    map.addLayer(createForwardOffsetsLayer());
    map.addLayer(createReverseOffsetsLayer());
    map.addLayer(createSegmentsLayer({ enableHoverAndSelection }));
    map.addLayer(createSegmentLabelsLayer());
}

/**
 * Setup zoom level display
 */
export function setupZoomDisplay(map, elementId) {
    map.on('zoom', () => {
        const zoomLevel = map.getZoom().toFixed(1);
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = `Zoom: ${zoomLevel}`;
        }
    });
}
