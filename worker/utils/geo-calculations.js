/**
 * Geographic calculation utilities
 * Pure functions for distance, bearing, and coordinate operations
 */

/**
 * Calculate distance between two GPS points in meters using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c; // Distance in meters
}

/**
 * Calculate bearing between two points (0-360 degrees)
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number|null} Bearing in degrees (0-360) or null if points are identical
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    if (lat1 === lat2 && lon1 === lon2) {
        return null;
    }
    
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    
    // Normalize to 0-360
    bearing = (bearing + 360) % 360;
    
    return bearing;
}

/**
 * Convert coordinates array to WKT LINESTRING format for PostGIS
 * @param {Array<Array<number>>} coords - Array of [lat, lon] coordinates
 * @returns {string} WKT LINESTRING string
 */
function coordinatesToWKT(coords) {
    // coords is array of [lat, lon]
    // WKT needs "lon lat" format
    const wktCoords = coords.map(coord => `${coord[1]} ${coord[0]}`).join(', ');
    return `LINESTRING(${wktCoords})`;
}

/**
 * Check if a batch of GPS points has significant movement
 * @param {Array<Object>} batch - Array of GPS points with latitude/longitude
 * @param {number} minDistanceMeters - Minimum distance to be considered significant
 * @returns {boolean} True if movement exceeds threshold
 */
function hasSignificantMovement(batch, minDistanceMeters = 50) {
    if (batch.length < 2) return false;
    
    const first = batch[0];
    const last = batch[batch.length - 1];
    
    const distance = calculateDistance(
        first.latitude, first.longitude,
        last.latitude, last.longitude
    );
    
    return distance >= minDistanceMeters;
}

module.exports = {
    calculateDistance,
    calculateBearing,
    coordinatesToWKT,
    hasSignificantMovement
};
