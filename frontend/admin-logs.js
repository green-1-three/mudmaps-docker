/**
 * Logs Viewer Module
 * Provides real-time log viewing with filtering and auto-refresh
 */

import { fetchJSON } from './utils.js';

// Module state
let logsState = {
    logs: [],
    loading: false,
    autoRefreshInterval: null,
    filters: {
        level: 'all', // all, error, warn, info, debug
        component: 'all', // all, or specific component name
        timeRange: '1h', // 1h, 6h, 24h, 7d, all
        search: '',
        limit: 200 // 50, 100, 200, 500, 1000, all
    },
    availableComponents: [],
    API_BASE: ''
};

/**
 * Initialize the logs tab
 * @param {string} apiBase - The API base URL
 */
export function initLogsTab(apiBase) {
    logsState.API_BASE = apiBase;

    // Create the logs tab content if it doesn't exist
    const existingTab = document.querySelector('[data-tab-content="logs"]');
    if (!existingTab) {
        createLogsTabHTML();
    }

    setupLogsEventListeners();

    // Load initial logs
    loadLogs();

    return {
        refreshLogs: () => loadLogs(),
        clearLogs: () => clearLogsDisplay(),
        getState: () => logsState
    };
}

/**
 * Create the HTML structure for the logs tab
 */
function createLogsTabHTML() {
    const tabContent = document.createElement('div');
    tabContent.className = 'admin-tab-content';
    tabContent.setAttribute('data-tab-content', 'logs');

    tabContent.innerHTML = `
        <h3>System Logs</h3>

        <div class="logs-actions" style="margin-bottom: 15px;">
            <button id="logs-refresh-btn" class="db-btn">🔄 Refresh</button>
            <button id="logs-auto-refresh-btn" class="db-btn">Auto-Refresh: OFF</button>
            <button id="logs-copy-btn" class="db-btn">📋 Copy Logs</button>
            <button id="logs-clear-btn" class="db-btn">🗑️ Clear Display</button>
        </div>

        <div class="logs-filters">
            <div class="filter-row">
                <div class="filter-group">
                    <label for="logs-level-filter">Level:</label>
                    <select id="logs-level-filter" class="logs-select">
                        <option value="all">All</option>
                        <option value="error">Error</option>
                        <option value="warn">Warning</option>
                        <option value="info">Info</option>
                        <option value="debug">Debug</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label for="logs-component-filter">Component:</label>
                    <select id="logs-component-filter" class="logs-select">
                        <option value="all">All</option>
                    </select>
                </div>
            </div>

            <div class="filter-row">
                <div class="filter-group">
                    <label for="logs-time-filter">Time Range:</label>
                    <select id="logs-time-filter" class="logs-select">
                        <option value="1h">Last 1 Hour</option>
                        <option value="6h">Last 6 Hours</option>
                        <option value="24h">Last 24 Hours</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="all">All Time</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label for="logs-limit-filter">Limit:</label>
                    <select id="logs-limit-filter" class="logs-select">
                        <option value="50">50 logs</option>
                        <option value="100">100 logs</option>
                        <option value="200" selected>200 logs</option>
                        <option value="500">500 logs</option>
                        <option value="1000">1000 logs</option>
                        <option value="all">All logs</option>
                    </select>
                </div>
            </div>

            <div class="filter-row">
                <div class="filter-group filter-group-full">
                    <label for="logs-search-filter">Search:</label>
                    <input type="text" id="logs-search-filter" class="logs-input" placeholder="Filter by message...">
                </div>
            </div>
        </div>

        <div class="logs-stats">
            <span id="logs-count">Total Logs: 0</span>
            <span id="logs-last-updated">Last Updated: Never</span>
        </div>

        <div class="logs-container" id="logs-container">
            <div class="logs-loading">Loading logs...</div>
        </div>
    `;

    // Add to the dev panel body
    const devPanelBody = document.querySelector('.admin-panel-body');
    if (devPanelBody) {
        devPanelBody.appendChild(tabContent);
    }
}

/**
 * Setup event listeners for logs controls
 */
function setupLogsEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('logs-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadLogs();
        });
    }

    // Auto-refresh toggle
    const autoRefreshBtn = document.getElementById('logs-auto-refresh-btn');
    if (autoRefreshBtn) {
        autoRefreshBtn.addEventListener('click', () => {
            if (logsState.autoRefreshInterval) {
                clearInterval(logsState.autoRefreshInterval);
                logsState.autoRefreshInterval = null;
                autoRefreshBtn.textContent = 'Auto-Refresh: OFF';
                autoRefreshBtn.classList.remove('active');
            } else {
                logsState.autoRefreshInterval = setInterval(() => {
                    loadLogs();
                }, 5000); // Refresh every 5 seconds
                autoRefreshBtn.textContent = 'Auto-Refresh: ON';
                autoRefreshBtn.classList.add('active');
            }
        });
    }

    // Copy button
    const copyBtn = document.getElementById('logs-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            copyVisibleLogs(copyBtn);
        });
    }

    // Clear button
    const clearBtn = document.getElementById('logs-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearLogsDisplay();
        });
    }

    // Level filter
    const levelFilter = document.getElementById('logs-level-filter');
    if (levelFilter) {
        levelFilter.addEventListener('change', (e) => {
            logsState.filters.level = e.target.value;
            renderLogs();
        });
    }

    // Component filter
    const componentFilter = document.getElementById('logs-component-filter');
    if (componentFilter) {
        componentFilter.addEventListener('change', (e) => {
            logsState.filters.component = e.target.value;
            renderLogs();
        });
    }

    // Time range filter
    const timeFilter = document.getElementById('logs-time-filter');
    if (timeFilter) {
        timeFilter.addEventListener('change', (e) => {
            logsState.filters.timeRange = e.target.value;
            renderLogs();
        });
    }

    // Limit filter
    const limitFilter = document.getElementById('logs-limit-filter');
    if (limitFilter) {
        limitFilter.addEventListener('change', (e) => {
            logsState.filters.limit = e.target.value;
            // Re-fetch logs with new limit
            loadLogs();
        });
    }

    // Search filter
    const searchFilter = document.getElementById('logs-search-filter');
    if (searchFilter) {
        searchFilter.addEventListener('input', (e) => {
            logsState.filters.search = e.target.value.toLowerCase();
            renderLogs();
        });
    }
}

/**
 * Load logs from the backend
 */
async function loadLogs() {
    if (logsState.loading) return;
    logsState.loading = true;

    const container = document.getElementById('logs-container');
    if (!container) return;

    try {
        // Construct the API endpoint with limit parameter
        const limit = logsState.filters.limit === 'all' ? 10000 : logsState.filters.limit;
        const url = `${logsState.API_BASE}/logs?limit=${limit}`;
        console.log(`📋 Fetching logs from: ${url}`);

        const response = await fetchJSON(url);

        if (response && Array.isArray(response.logs)) {
            logsState.logs = response.logs;
        } else if (Array.isArray(response)) {
            logsState.logs = response;
        } else {
            console.warn('Unexpected logs response format:', response);
            logsState.logs = [];
        }

        // Extract unique components from logs
        updateAvailableComponents();

        renderLogs();

    } catch (err) {
        console.error('Failed to load logs:', err);

        // Show error in container
        container.innerHTML = `
            <div class="logs-error">
                <p>⚠️ Failed to load logs</p>
                <p class="error-message">${err.message}</p>
                <p class="error-hint">Note: The logs endpoint may not be implemented yet. Expected endpoint: GET ${logsState.API_BASE}/logs?limit=N</p>
            </div>
        `;
    } finally {
        logsState.loading = false;
    }
}

/**
 * Extract unique components from logs and update the component filter dropdown
 */
function updateAvailableComponents() {
    const components = new Set();

    logsState.logs.forEach(log => {
        if (log.component) {
            components.add(log.component);
        }
    });

    logsState.availableComponents = Array.from(components).sort();

    // Update the component filter dropdown
    const componentFilter = document.getElementById('logs-component-filter');
    if (componentFilter) {
        const currentValue = componentFilter.value;

        // Rebuild options
        componentFilter.innerHTML = '<option value="all">All</option>';
        logsState.availableComponents.forEach(component => {
            const option = document.createElement('option');
            option.value = component;
            option.textContent = component;
            componentFilter.appendChild(option);
        });

        // Restore previous selection if it still exists
        if (logsState.availableComponents.includes(currentValue)) {
            componentFilter.value = currentValue;
        }
    }
}

/**
 * Render logs to the display
 */
function renderLogs() {
    const container = document.getElementById('logs-container');
    if (!container) return;

    // Filter logs
    let filteredLogs = logsState.logs;

    // Filter by level
    if (logsState.filters.level !== 'all') {
        filteredLogs = filteredLogs.filter(log =>
            log.level && log.level.toLowerCase() === logsState.filters.level
        );
    }

    // Filter by component
    if (logsState.filters.component !== 'all') {
        filteredLogs = filteredLogs.filter(log =>
            log.component === logsState.filters.component
        );
    }

    // Filter by time range
    if (logsState.filters.timeRange !== 'all') {
        const now = Date.now();
        const timeRanges = {
            '1h': 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000
        };
        const rangeMs = timeRanges[logsState.filters.timeRange];

        if (rangeMs) {
            filteredLogs = filteredLogs.filter(log => {
                if (!log.timestamp) return true; // Keep logs without timestamp
                const logTime = new Date(log.timestamp).getTime();
                return (now - logTime) <= rangeMs;
            });
        }
    }

    // Filter by search
    if (logsState.filters.search) {
        filteredLogs = filteredLogs.filter(log =>
            (log.message && log.message.toLowerCase().includes(logsState.filters.search)) ||
            (log.component && log.component.toLowerCase().includes(logsState.filters.search))
        );
    }

    // Clear container
    container.innerHTML = '';

    if (filteredLogs.length === 0) {
        container.innerHTML = '<div class="logs-empty">No logs to display</div>';
    } else {
        // Create log entries (most recent first)
        const fragment = document.createDocumentFragment();

        filteredLogs.forEach(log => {
            const logEntry = createLogEntry(log);
            fragment.appendChild(logEntry);
        });

        container.appendChild(fragment);
    }

    // Update stats
    updateLogsStats(logsState.logs.length, filteredLogs.length);
}

/**
 * Create a log entry element
 */
function createLogEntry(log) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-level-${(log.level || 'info').toLowerCase()}`;

    // Format timestamp
    const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown time';

    // Format level with emoji
    const levelEmoji = {
        'error': '❌',
        'warn': '⚠️',
        'info': 'ℹ️',
        'debug': '🐛'
    };
    const level = log.level || 'info';
    const emoji = levelEmoji[level.toLowerCase()] || '📝';

    // Build entry HTML
    entry.innerHTML = `
        <div class="log-header">
            <span class="log-timestamp">${timestamp}</span>
            <span class="log-level">${emoji} ${level.toUpperCase()}</span>
            ${log.component ? `<span class="log-component">[${log.component}]</span>` : ''}
        </div>
        <div class="log-message">${escapeHtml(log.message || 'No message')}</div>
        ${log.details ? `<div class="log-details"><pre>${escapeHtml(JSON.stringify(log.details, null, 2))}</pre></div>` : ''}
    `;

    return entry;
}

/**
 * Update logs statistics display
 */
function updateLogsStats(totalCount, filteredCount) {
    const countEl = document.getElementById('logs-count');
    const lastUpdatedEl = document.getElementById('logs-last-updated');

    if (countEl) {
        if (totalCount === filteredCount) {
            countEl.textContent = `Total Logs: ${totalCount}`;
        } else {
            countEl.textContent = `Showing ${filteredCount} of ${totalCount} logs`;
        }
    }

    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleTimeString()}`;
    }
}

/**
 * Copy visible logs to clipboard
 */
function copyVisibleLogs(button) {
    // Get the filtered logs (same logic as renderLogs)
    let filteredLogs = logsState.logs;

    // Filter by level
    if (logsState.filters.level !== 'all') {
        filteredLogs = filteredLogs.filter(log =>
            log.level && log.level.toLowerCase() === logsState.filters.level
        );
    }

    // Filter by component
    if (logsState.filters.component !== 'all') {
        filteredLogs = filteredLogs.filter(log =>
            log.component === logsState.filters.component
        );
    }

    // Filter by time range
    if (logsState.filters.timeRange !== 'all') {
        const now = Date.now();
        const timeRanges = {
            '1h': 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000
        };
        const rangeMs = timeRanges[logsState.filters.timeRange];

        if (rangeMs) {
            filteredLogs = filteredLogs.filter(log => {
                if (!log.timestamp) return true;
                const logTime = new Date(log.timestamp).getTime();
                return (now - logTime) <= rangeMs;
            });
        }
    }

    // Filter by search
    if (logsState.filters.search) {
        filteredLogs = filteredLogs.filter(log =>
            (log.message && log.message.toLowerCase().includes(logsState.filters.search)) ||
            (log.component && log.component.toLowerCase().includes(logsState.filters.search))
        );
    }

    if (filteredLogs.length === 0) {
        console.warn('No logs to copy');
        return;
    }

    // Copy to clipboard as JSON
    const jsonString = JSON.stringify(filteredLogs, null, 2);

    navigator.clipboard.writeText(jsonString).then(() => {
        console.log(`✅ Copied ${filteredLogs.length} logs to clipboard`);

        // Visual feedback
        const originalText = button.textContent;
        button.textContent = '✅ Copied!';
        button.classList.add('success');
        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('success');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy logs:', err);
        alert('Failed to copy logs to clipboard');
    });
}

/**
 * Clear logs display
 */
function clearLogsDisplay() {
    logsState.logs = [];
    logsState.availableComponents = [];
    renderLogs();
    updateAvailableComponents();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get current logs state (for debugging)
 */
export function getLogsState() {
    return logsState;
}
