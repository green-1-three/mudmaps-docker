/**
 * Statistics Module
 * Handles data statistics display and updates
 */

let statsState = {
    currentTimeHours: 24,
    sources: null
};

/**
 * Initialize statistics module
 * @param {Object} sources - Map vector sources (polylinesSource, segmentsSource)
 * @param {number} initialTimeHours - Initial time range in hours
 */
export function initStatistics(sources, initialTimeHours = 24) {
    statsState.sources = sources;
    statsState.currentTimeHours = initialTimeHours;
    
    // Initial statistics update
    updateStatistics();
    
    return {
        update: updateStatistics,
        setTimeRange: (hours) => {
            statsState.currentTimeHours = hours;
            updateStatistics();
        }
    };
}

/**
 * Update all statistics displays
 */
export function updateStatistics() {
    if (!statsState.sources) {
        console.warn('Statistics module not initialized with sources');
        return;
    }
    
    const { polylinesSource, segmentsSource } = statsState.sources;
    
    // Polyline statistics
    const totalPolylines = polylinesSource.getFeatures().length;
    const visiblePolylines = polylinesSource.getFeatures().filter(f => {
        const endTime = f.get('end_time');
        if (!endTime) return false;
        const cutoffTime = Date.now() - (statsState.currentTimeHours * 60 * 60 * 1000);
        return new Date(endTime).getTime() >= cutoffTime;
    }).length;
    
    // Segment statistics
    const allSegments = segmentsSource.getFeatures();
    const totalSegments = allSegments.length;
    const activeSegments = allSegments.filter(f => f.get('is_activated')).length;
    const inactiveSegments = totalSegments - activeSegments;
    const visibleSegments = allSegments.filter(f => {
        const lastPlowed = f.get('last_plowed');
        if (!lastPlowed) return false;
        const cutoffTime = Date.now() - (statsState.currentTimeHours * 60 * 60 * 1000);
        return new Date(lastPlowed).getTime() >= cutoffTime;
    }).length;
    
    // Coverage statistics
    const activationRate = totalSegments > 0 
        ? ((activeSegments / totalSegments) * 100).toFixed(1) 
        : '0.0';
    
    // Count unique streets covered
    const streetsSet = new Set();
    allSegments.forEach(f => {
        const street = f.get('street_name');
        if (street && f.get('is_activated')) {
            streetsSet.add(street);
        }
    });
    const streetsCovered = streetsSet.size;
    
    // Update DOM elements
    updateElement('stat-polylines-total', totalPolylines);
    updateElement('stat-polylines-visible', visiblePolylines);
    updateElement('stat-segments-total', totalSegments);
    updateElement('stat-segments-active', activeSegments);
    updateElement('stat-segments-inactive', inactiveSegments);
    updateElement('stat-segments-visible', visibleSegments);
    updateElement('stat-activation-rate', `${activationRate}%`);
    updateElement('stat-streets-covered', streetsCovered);
    updateElement('stat-last-updated', new Date().toLocaleTimeString());
    
    // Return statistics for other modules to use
    return {
        polylines: {
            total: totalPolylines,
            visible: visiblePolylines
        },
        segments: {
            total: totalSegments,
            active: activeSegments,
            inactive: inactiveSegments,
            visible: visibleSegments
        },
        coverage: {
            activationRate,
            streetsCovered
        }
    };
}

/**
 * Update a DOM element by ID
 */
function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/**
 * Get current statistics without updating display
 */
export function getStatistics() {
    if (!statsState.sources) {
        return null;
    }
    
    const { polylinesSource, segmentsSource } = statsState.sources;
    const allSegments = segmentsSource.getFeatures();
    const totalSegments = allSegments.length;
    const activeSegments = allSegments.filter(f => f.get('is_activated')).length;
    
    return {
        polylines: polylinesSource.getFeatures().length,
        segments: {
            total: totalSegments,
            active: activeSegments,
            inactive: totalSegments - activeSegments
        }
    };
}
