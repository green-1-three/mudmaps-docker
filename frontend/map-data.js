/**
 * Map Data Module
 * Shared functions for loading and processing segment data
 */

import { getColorByAge, abbreviateStreetName, fetchJSON } from './utils.js';
import { MUNICIPALITY } from './map-config.js';

/**
 * Calculate segment timing information
 */
export function calculateSegmentTimes(segment) {
    const forwardTime = segment.properties.last_plowed_forward
        ? new Date(segment.properties.last_plowed_forward).getTime()
        : 0;
    const reverseTime = segment.properties.last_plowed_reverse
        ? new Date(segment.properties.last_plowed_reverse).getTime()
        : 0;
    const lastPlowed = Math.max(forwardTime, reverseTime);
    const lastPlowedISO = lastPlowed > 0 ? new Date(lastPlowed).toISOString() : null;
    const isActivated = lastPlowed > 0;

    return { forwardTime, reverseTime, lastPlowed, lastPlowedISO, isActivated };
}

/**
 * Check if a timestamp is within the time range
 */
export function isWithinTimeRange(timestamp, currentTimeHours) {
    if (!timestamp) return false;
    const cutoffTime = Date.now() - (currentTimeHours * 60 * 60 * 1000);
    const time = new Date(timestamp).getTime();
    return time >= cutoffTime;
}

/**
 * Create a label feature from a segment
 */
export function createLabelFeature(segment) {
    if (!segment.properties.street_name) return null;

    return {
        type: 'Feature',
        geometry: segment.geometry,
        properties: {
            street_name: abbreviateStreetName(segment.properties.street_name),
            segment_id: segment.id || segment.properties.segment_id
        }
    };
}

/**
 * Create a simple segment feature (for public view)
 */
export function createSimpleSegmentFeature(segment, lastPlowedISO, currentTimeHours) {
    return {
        type: 'Feature',
        geometry: segment.geometry,
        properties: {
            color: getColorByAge(lastPlowedISO, currentTimeHours)
        }
    };
}

/**
 * Create a simple offset feature (for public view)
 */
export function createSimpleOffsetFeature(geometry, timestamp, currentTimeHours) {
    return {
        type: 'Feature',
        geometry,
        properties: {
            color: getColorByAge(timestamp, currentTimeHours)
        }
    };
}

/**
 * Load segments from API
 */
export async function loadSegmentsFromAPI(apiBase, municipality = MUNICIPALITY) {
    const url = `${apiBase}/segments?municipality=${municipality}&all=true`;
    console.log(`🛣️  Fetching segments from: ${url}`);

    const data = await fetchJSON(url);
    console.log(`✅ Segments loaded`);

    if (!data.features || data.features.length === 0) {
        console.log('⚠️ No segments in response');
        return [];
    }

    return data.features;
}
