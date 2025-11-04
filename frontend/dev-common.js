/**
 * Common Utilities Module
 * Shared functions used across dev modules
 */

// Polyline decoder with caching
const polylineCache = {};

export function decodePolyline(str, precision = 5) {
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

/**
 * Fetch JSON with error handling
 */
export async function fetchJSON(url) {
    const r = await fetch(url);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok || !ct.includes('application/json')) {
        const head = await r.text().then(t => t.slice(0, 120)).catch(() => '');
        throw new Error(`Non-JSON from ${url} (${r.status}): ${head}`);
    }
    return r.json();
}

/**
 * Interpolate between two colors
 */
export function interpolateColor(color1, color2, factor) {
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

/**
 * Get color based on time recency with smooth gradient
 */
export function getColorByAge(timestamp, maxHours = 24) {
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

/**
 * Format time label for display
 */
export function formatTimeLabel(minutes) {
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

/**
 * Update the gradient legend labels based on time range
 */
export function updateGradientLabels(hours) {
    const leftLabel = document.getElementById('gradientLeft');
    const centerLabel = document.getElementById('gradientCenter');
    const rightLabel = document.getElementById('gradientRight');

    if (leftLabel) leftLabel.textContent = 'Now';

    const centerMinutes = (hours * 60) / 2;
    if (centerLabel) centerLabel.textContent = formatTimeLabel(centerMinutes);

    const rightMinutes = hours * 60;
    if (rightLabel) rightLabel.textContent = formatTimeLabel(rightMinutes);
}

/**
 * Update the time display text based on selected hours
 */
export function updateTimeDisplay(hours) {
    const timeValue = document.getElementById('timeValue');

    if (!timeValue) return;

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

/**
 * Show status message (console log for now)
 */
export function showStatus(message) {
    console.log(message);
    // Could add a status bar UI element here in the future
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp) {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
}

/**
 * Calculate duration between two timestamps in minutes
 */
export function calculateDuration(startTime, endTime) {
    if (!startTime || !endTime) return null;
    return ((new Date(endTime) - new Date(startTime)) / 60000).toFixed(1);
}
