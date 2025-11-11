/**
 * Time Slider Module
 * Shared time range slider UI and functionality
 */

import { updateTimeDisplay, updateGradientLabels } from './utils.js';

// Discrete time intervals mapping: index -> hours
export const TIME_INTERVALS = [1, 2, 4, 8, 24, 72, 168]; // 1h, 2h, 4h, 8h, 1d, 3d, 7d

/**
 * Create time slider HTML
 */
export function createTimeSliderHTML() {
    return `
        <div class="control-panel">
            <h3>Latest Snowplow Activity</h3>

            <div class="control-group">
                <label for="timeRange">Time Range:</label>
                <input type="range" id="timeRange" min="0" max="6" value="6" step="1">
                <div class="time-display">
                    <span id="timeValue">Last 7 days</span>
                </div>
            </div>

            <div class="legend">
                <div class="legend-title">Segment Age:</div>
                <div class="gradient-bar"></div>
                <div class="gradient-labels">
                    <span id="gradientLeft">Now</span>
                    <span id="gradientCenter">12 hours</span>
                    <span id="gradientRight">1 day</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Setup time slider event handlers
 * @param {Function} onTimeChange - Callback function that receives hours when slider changes
 */
export function setupTimeSlider(onTimeChange) {
    const slider = document.getElementById('timeRange');

    if (!slider) {
        console.error('Time range slider not found');
        return;
    }

    slider.addEventListener('input', (e) => {
        const index = parseInt(e.target.value);
        const hours = TIME_INTERVALS[index];

        // Update display
        updateTimeDisplay(hours);

        // Call the provided callback
        if (onTimeChange) {
            onTimeChange(hours);
        }
    });
}
