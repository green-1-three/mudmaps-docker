/**
 * UI Controls Module
 * Handles layer visibility toggles and UI control interactions
 * Simplified for Mapbox GL - actual toggle handlers are in dev.js
 */

let uiState = {
    showPolylineBorders: false,
    showSegmentBorders: false,
    showActiveSegments: true,
    showInactiveSegments: false,
    showPolylines: false,
    segmentTransparent: true,
    offsetTransparent: false,
    layers: null,
    updateCallback: null
};

/**
 * Initialize UI controls
 * @param {Object} layers - Map layer IDs (for Mapbox)
 * @param {Function} updateCallback - Callback when visibility changes (for stats update)
 */
export function initUIControls(layers, updateCallback) {
    uiState.layers = layers;
    uiState.updateCallback = updateCallback;

    // Note: Actual toggle event listeners are set up in dev.js
    // This module just maintains state

    return {
        getState: () => uiState,
        setState: (newState) => {
            Object.assign(uiState, newState);
        }
    };
}

/**
 * Get current UI state
 */
export function getUIState() {
    return uiState;
}

/**
 * Set style creators - no-op for Mapbox (kept for compatibility)
 */
export function setStyleCreators(polylineStyleFn, segmentStyleFn) {
    // Not needed for Mapbox GL - styling is data-driven
    // Kept for compatibility with existing code
}
