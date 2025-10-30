/**
 * OSRM (Open Source Routing Machine) Service
 * Handles all interactions with the OSRM API for map matching
 */

const fetch = require('node-fetch');

class OSRMService {
    constructor(baseUrl = process.env.OSRM_BASE || 'http://osrm:5000') {
        this.baseUrl = baseUrl;
        this.timeout = 10000; // 10 seconds
    }

    /**
     * Call OSRM match service to snap GPS points to road network
     * @param {Array<Array<number>>} coordinates - Array of [longitude, latitude] pairs
     * @returns {Promise<Object|null>} Matched route object or null if matching fails
     */
    async matchRoute(coordinates) {
        try {
            // Format: longitude,latitude;longitude,latitude;...
            const coordString = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
            const url = `${this.baseUrl}/match/v1/driving/${coordString}?overview=full&geometries=geojson`;
            
            const response = await fetch(url, { timeout: this.timeout });
            
            if (!response.ok) {
                throw new Error(`OSRM responded with status ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.code !== 'Ok' || !data.matchings || data.matchings.length === 0) {
                return null;
            }
            
            const matching = data.matchings[0];
            
            return {
                coordinates: matching.geometry.coordinates.map(c => [c[1], c[0]]), // Convert to [lat, lon]
                confidence: matching.confidence || 0.5
            };
            
        } catch (error) {
            console.error(`❌ OSRM API Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Get route between two points
     * @param {Array<number>} start - [longitude, latitude] of start point
     * @param {Array<number>} end - [longitude, latitude] of end point
     * @returns {Promise<Object|null>} Route object or null if routing fails
     */
    async getRoute(start, end) {
        try {
            const coordString = `${start[0]},${start[1]};${end[0]},${end[1]}`;
            const url = `${this.baseUrl}/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
            
            const response = await fetch(url, { timeout: this.timeout });
            
            if (!response.ok) {
                throw new Error(`OSRM responded with status ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                return null;
            }
            
            return data.routes[0];
            
        } catch (error) {
            console.error(`❌ OSRM Route Error: ${error.message}`);
            return null;
        }
    }
}

module.exports = OSRMService;
