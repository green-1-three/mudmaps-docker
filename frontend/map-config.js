/**
 * Map Configuration Module
 * Centralized configuration constants for map behavior and styling
 */

// Geographic Configuration
export const MUNICIPALITY = 'pomfret-vt';

// Map Initialization Defaults
export const DEFAULT_MAP_CENTER = [0, 0];
export const DEFAULT_MAP_ZOOM = 2;
export const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';

// Interaction Configuration
export const SNAP_RADIUS = 20; // pixels - radius for snapping to segments on hover/click

// Layer Styling Constants
export const SEGMENT_LINE_WIDTH = 4;
export const SEGMENT_LINE_WIDTH_HOVER = 7;
export const SEGMENT_LINE_WIDTH_SELECTED = 8;

export const OFFSET_LINE_WIDTH = 3;

export const POLYLINE_LINE_WIDTH = 2;

// Color Configuration
export const COLOR_SELECTED = '#00ffff'; // Cyan for selected segments
export const COLOR_BOUNDARY_LINE = 'rgba(255, 255, 255, 0.4)';
export const COLOR_BOUNDARY_FILL = 'rgba(255, 255, 255, 0.02)';

// Zoom Configuration
export const ZOOM_THRESHOLD_MID = 12;
export const ZOOM_THRESHOLD_HIGH = 14;
export const FIT_BOUNDS_PADDING = 50;
export const FIT_BOUNDS_MAX_ZOOM = 16;

// Label Configuration
export const LABEL_TEXT_COLOR = '#333333';
export const LABEL_HALO_COLOR = '#ffffff';
export const LABEL_HALO_WIDTH = 2;

// ============================================================================
// Layer Factory Functions
// ============================================================================

/**
 * Create segment labels layer definition
 */
export function createSegmentLabelsLayer() {
    return {
        id: 'segment-labels',
        type: 'symbol',
        source: 'all-segments-labels',
        layout: {
            'text-field': ['get', 'street_name'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
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
            'text-color': LABEL_TEXT_COLOR,
            'text-halo-color': LABEL_HALO_COLOR,
            'text-halo-width': LABEL_HALO_WIDTH
        }
    };
}

/**
 * Create forward offsets layer definition
 */
export function createForwardOffsetsLayer() {
    return {
        id: 'forward-offsets',
        type: 'line',
        source: 'forward-offsets',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': OFFSET_LINE_WIDTH,
            'line-opacity': ['coalesce', ['get', 'opacity'], 1]
        }
    };
}

/**
 * Create reverse offsets layer definition
 */
export function createReverseOffsetsLayer() {
    return {
        id: 'reverse-offsets',
        type: 'line',
        source: 'reverse-offsets',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': OFFSET_LINE_WIDTH,
            'line-opacity': ['coalesce', ['get', 'opacity'], 1]
        }
    };
}

/**
 * Create segments layer definition
 * @param {Object} options - Configuration options
 * @param {boolean} options.enableHoverAndSelection - Enable hover and selection states
 */
export function createSegmentsLayer(options = {}) {
    const { enableHoverAndSelection = false } = options;

    const baseLayer = {
        id: 'segments',
        type: 'line',
        source: 'segments',
        layout: enableHoverAndSelection ? {
            'line-cap': 'round',
            'line-join': 'round'
        } : {},
        paint: {
            'line-color': ['get', 'color'],
            'line-width': SEGMENT_LINE_WIDTH
        }
    };

    // Add hover and selection styles if enabled
    if (enableHoverAndSelection) {
        baseLayer.paint['line-color'] = [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            COLOR_SELECTED,  // Cyan when selected
            ['get', 'color']  // Normal color
        ];

        baseLayer.paint['line-width'] = [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            SEGMENT_LINE_WIDTH_SELECTED,  // Extra wide when selected
            ['boolean', ['feature-state', 'hover'], false],
            SEGMENT_LINE_WIDTH_HOVER,  // Width when hovered
            SEGMENT_LINE_WIDTH   // Normal width
        ];

        baseLayer.paint['line-opacity'] = [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            1,  // Fully opaque when selected
            ['boolean', ['feature-state', 'hover'], false],
            1,  // Fully opaque when hovered
            ['coalesce', ['get', 'opacity'], 1]  // Normal opacity
        ];
    }

    return baseLayer;
}
