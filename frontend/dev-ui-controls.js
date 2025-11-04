/**
 * UI Controls Module
 * Handles layer visibility toggles and UI control interactions
 */

let uiState = {
    showPolylineBorders: false,
    showSegmentBorders: false,
    showActiveSegments: true,
    showInactiveSegments: true,
    showPolylines: true,
    segmentTransparent: false,
    offsetTransparent: false,
    layers: null,
    updateCallback: null
};

/**
 * Initialize UI controls
 * @param {Object} layers - Map layers (polylinesLayer, segmentsLayer)
 * @param {Function} updateCallback - Callback when visibility changes (for stats update)
 */
export function initUIControls(layers, updateCallback) {
    uiState.layers = layers;
    uiState.updateCallback = updateCallback;
    
    setupToggleListeners();
    
    return {
        getState: () => uiState,
        updateSegmentVisibility,
        createPolylineStyleWithBorders,
        createSegmentStyleWithBorders
    };
}

/**
 * Setup toggle listeners
 */
function setupToggleListeners() {
    const { polylinesLayer, segmentsLayer, forwardOffsetLayer, reverseOffsetLayer } = uiState.layers;
    
    // Polyline visibility toggle
    const togglePolylines = document.getElementById('toggle-polylines');
    if (togglePolylines) {
        togglePolylines.addEventListener('change', (e) => {
            uiState.showPolylines = e.target.checked;
            polylinesLayer.setVisible(e.target.checked);
            if (uiState.updateCallback) uiState.updateCallback();
        });
    }
    
    // Polyline borders toggle
    const togglePolylineBorders = document.getElementById('toggle-polyline-borders');
    if (togglePolylineBorders) {
        togglePolylineBorders.addEventListener('change', (e) => {
            uiState.showPolylineBorders = e.target.checked;
            // Update polyline layer style
            polylinesLayer.setStyle(createPolylineStyleWithBorders);
            if (uiState.updateCallback) uiState.updateCallback();
        });
    }
    
    // Segment borders toggle
    const toggleSegmentBorders = document.getElementById('toggle-segment-borders');
    if (toggleSegmentBorders) {
        toggleSegmentBorders.addEventListener('change', (e) => {
            uiState.showSegmentBorders = e.target.checked;
            updateSegmentVisibility();
        });
    }
    
    // Active segments toggle
    const toggleActiveSegments = document.getElementById('toggle-active-segments');
    if (toggleActiveSegments) {
        toggleActiveSegments.addEventListener('change', (e) => {
            uiState.showActiveSegments = e.target.checked;
            updateSegmentVisibility();
        });
    }
    
    // Inactive segments toggle
    const toggleInactiveSegments = document.getElementById('toggle-inactive-segments');
    if (toggleInactiveSegments) {
        toggleInactiveSegments.addEventListener('change', (e) => {
            uiState.showInactiveSegments = e.target.checked;
            updateSegmentVisibility();
        });
    }

    // Segment transparency toggle
    const toggleSegmentTransparency = document.getElementById('toggle-segment-transparency');
    if (toggleSegmentTransparency) {
        toggleSegmentTransparency.addEventListener('change', (e) => {
            uiState.segmentTransparent = e.target.checked;
            updateSegmentVisibility();
        });
    }

    // Offset transparency toggle
    const toggleOffsetTransparency = document.getElementById('toggle-offset-transparency');
    if (toggleOffsetTransparency) {
        toggleOffsetTransparency.addEventListener('change', (e) => {
            uiState.offsetTransparent = e.target.checked;
            // Trigger re-render of offset layers
            if (forwardOffsetLayer) forwardOffsetLayer.changed();
            if (reverseOffsetLayer) reverseOffsetLayer.changed();
        });
    }
}

/**
 * Update segment visibility based on toggle states
 */
function updateSegmentVisibility() {
    const { segmentsLayer } = uiState.layers;
    
    // Update the style function to filter segments
    segmentsLayer.setStyle((feature) => {
        const isActivated = feature.get('is_activated');
        
        // Filter based on toggle states
        if (isActivated && !uiState.showActiveSegments) return null;
        if (!isActivated && !uiState.showInactiveSegments) return null;
        
        // Apply the normal style with optional borders
        return createSegmentStyleWithBorders(feature);
    });
    
    // Update statistics when visibility changes
    if (uiState.updateCallback) {
        uiState.updateCallback();
    }
}

/**
 * Create polyline style with optional borders
 * This needs to be imported from main dev.js for access to Style classes
 */
function createPolylineStyleWithBorders(feature) {
    // This will be overridden by dev.js with the actual implementation
    // that has access to OpenLayers Style classes
    console.warn('createPolylineStyleWithBorders needs to be overridden');
    return null;
}

/**
 * Create segment style with optional borders
 * This needs to be imported from main dev.js for access to Style classes
 */
function createSegmentStyleWithBorders(feature) {
    // This will be overridden by dev.js with the actual implementation
    // that has access to OpenLayers Style classes
    console.warn('createSegmentStyleWithBorders needs to be overridden');
    return null;
}

/**
 * Export the style creator functions for override
 */
export function setStyleCreators(polylineStyleFn, segmentStyleFn) {
    createPolylineStyleWithBorders = polylineStyleFn;
    createSegmentStyleWithBorders = segmentStyleFn;
}

/**
 * Get current UI state
 */
export function getUIState() {
    return uiState;
}
