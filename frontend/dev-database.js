/**
 * Database Visualization Module
 * Provides real-time database table viewing with infinite scroll and map interaction
 */

import { fetchJSON } from './dev-common.js';

// Module state
let databaseState = {
    tables: {
        gps_raw_data: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'device_id', 'longitude', 'latitude', 'recorded_at', 'processed']
        },
        cached_polylines: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'device_id', 'start_time', 'end_time', 'point_count', 'created_at']
        },
        road_segments: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'street_name', 'municipality_id', 'last_plowed_forward', 'last_plowed_reverse', 'plow_count_total']
        },
        segment_updates: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'segment_id', 'device_id', 'direction', 'timestamp']
        }
    },
    activeTable: 'gps_raw_data',
    selectedRow: null,
    API_BASE: ''
};

/**
 * Initialize the database tab
 * @param {string} apiBase - The API base URL
 * @param {Object} mapSources - References to map vector sources
 */
export function initDatabaseTab(apiBase, mapSources) {
    databaseState.API_BASE = apiBase;
    
    // Create the database tab content if it doesn't exist
    const existingTab = document.querySelector('[data-tab-content="database"]');
    if (!existingTab) {
        createDatabaseTabHTML();
    }
    
    setupDatabaseEventListeners();
    
    // Load initial data for the default table
    loadTableData(databaseState.activeTable);
    
    return {
        refreshTable: (tableName) => loadTableData(tableName),
        highlightRow: (tableName, id) => highlightTableRow(tableName, id),
        getState: () => databaseState
    };
}

/**
 * Create the HTML structure for the database tab
 */
function createDatabaseTabHTML() {
    const tabContent = document.createElement('div');
    tabContent.className = 'dev-tab-content';
    tabContent.setAttribute('data-tab-content', 'database');
    
    tabContent.innerHTML = `
        <h3>Database Inspector</h3>
        
        <div class="db-controls">
            <div class="db-table-selector">
                <label>Table:</label>
                <select id="db-table-select">
                    <option value="gps_raw_data">GPS Raw Data</option>
                    <option value="cached_polylines">Cached Polylines</option>
                    <option value="road_segments">Road Segments</option>
                    <option value="segment_updates">Segment Updates</option>
                </select>
            </div>
            <div class="db-actions">
                <button id="db-refresh-btn" class="db-btn">🔄 Refresh</button>
                <button id="db-auto-refresh-btn" class="db-btn">Auto-Refresh: OFF</button>
            </div>
        </div>
        
        <div class="db-stats">
            <span id="db-row-count">Rows: 0</span>
            <span id="db-last-updated">Last Updated: Never</span>
        </div>
        
        <div class="db-table-container">
            <table id="db-table" class="db-table">
                <thead id="db-table-head">
                    <tr></tr>
                </thead>
                <tbody id="db-table-body">
                    <tr>
                        <td colspan="100%" class="db-loading">Select a table to view data</td>
                    </tr>
                </tbody>
            </table>
        </div>
        
        <div class="db-scroll-loader" id="db-scroll-loader" style="display: none;">
            Loading more rows...
        </div>
    `;
    
    // Add to the dev panel body
    const devPanelBody = document.querySelector('.dev-panel-body');
    if (devPanelBody) {
        devPanelBody.appendChild(tabContent);
    }
}

/**
 * Setup event listeners for database controls
 */
function setupDatabaseEventListeners() {
    // Table selector
    const tableSelect = document.getElementById('db-table-select');
    if (tableSelect) {
        tableSelect.addEventListener('change', (e) => {
            databaseState.activeTable = e.target.value;
            resetTableState(databaseState.activeTable);
            loadTableData(databaseState.activeTable);
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('db-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            resetTableState(databaseState.activeTable);
            loadTableData(databaseState.activeTable);
        });
    }
    
    // Auto-refresh toggle
    let autoRefreshInterval = null;
    const autoRefreshBtn = document.getElementById('db-auto-refresh-btn');
    if (autoRefreshBtn) {
        autoRefreshBtn.addEventListener('click', () => {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
                autoRefreshInterval = null;
                autoRefreshBtn.textContent = 'Auto-Refresh: OFF';
                autoRefreshBtn.classList.remove('active');
            } else {
                autoRefreshInterval = setInterval(() => {
                    loadTableData(databaseState.activeTable, true);
                }, 30000); // Refresh every 30 seconds
                autoRefreshBtn.textContent = 'Auto-Refresh: ON';
                autoRefreshBtn.classList.add('active');
            }
        });
    }
    
    // Infinite scroll
    const tableContainer = document.querySelector('.db-table-container');
    if (tableContainer) {
        tableContainer.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = tableContainer;
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                loadMoreRows();
            }
        });
    }
}

/**
 * Reset table state when switching tables
 */
function resetTableState(tableName) {
    databaseState.tables[tableName].offset = 0;
    databaseState.tables[tableName].data = [];
    databaseState.selectedRow = null;
}

/**
 * Load table data from the backend
 */
async function loadTableData(tableName, append = false) {
    const table = databaseState.tables[tableName];
    
    if (table.loading) return;
    table.loading = true;
    
    const loader = document.getElementById('db-scroll-loader');
    const tbody = document.getElementById('db-table-body');
    const thead = document.getElementById('db-table-head');
    
    if (!append) {
        tbody.innerHTML = '<tr><td colspan="100%" class="db-loading">Loading...</td></tr>';
        loader.style.display = 'none';
    } else {
        loader.style.display = 'block';
    }
    
    try {
        // Construct the API endpoint
        const url = `${databaseState.API_BASE}/database/${tableName}?limit=10&offset=${table.offset}`;
        console.log(`📊 Fetching ${tableName} from: ${url}`);
        
        const response = await fetchJSON(url);
        
        if (!append) {
            table.data = response.rows || [];
            table.offset = table.data.length;
            
            // Build table headers
            const headerRow = thead.querySelector('tr');
            headerRow.innerHTML = table.columns.map(col => 
                `<th>${col.replace(/_/g, ' ').toUpperCase()}</th>`
            ).join('');
            
            // Build table body
            tbody.innerHTML = '';
        } else {
            table.data.push(...(response.rows || []));
            table.offset = table.data.length;
        }
        
        // Add rows to table
        const fragment = document.createDocumentFragment();
        const startIdx = append ? table.data.length - response.rows.length : 0;
        
        for (let i = startIdx; i < table.data.length; i++) {
            const row = table.data[i];
            const tr = createTableRow(tableName, row, i);
            fragment.appendChild(tr);
        }
        
        if (!append) {
            tbody.innerHTML = '';
        }
        tbody.appendChild(fragment);
        
        // Update stats
        updateTableStats(table.data.length);
        
        // Hide loader
        loader.style.display = 'none';
        
    } catch (err) {
        console.error(`Failed to load ${tableName}:`, err);
        tbody.innerHTML = `<tr><td colspan="100%" class="db-error">Error: ${err.message}</td></tr>`;
        loader.style.display = 'none';
    } finally {
        table.loading = false;
    }
}

/**
 * Create a table row element
 */
function createTableRow(tableName, rowData, index) {
    const tr = document.createElement('tr');
    tr.className = 'db-row';
    tr.dataset.tableName = tableName;
    tr.dataset.rowId = rowData.id;
    tr.dataset.index = index;
    
    // Add click handler for row selection and map interaction
    tr.addEventListener('click', () => handleRowClick(tableName, rowData, tr));
    
    // Build cells based on columns
    const table = databaseState.tables[tableName];
    tr.innerHTML = table.columns.map(col => {
        let value = rowData[col];
        
        // Format special columns
        if (col.includes('time') || col.includes('_at')) {
            value = value ? new Date(value).toLocaleString() : 'null';
        } else if (col === 'processed') {
            value = value ? '✅' : '❌';
        } else if (col === 'longitude' || col === 'latitude') {
            value = value ? value.toFixed(6) : 'null';
        } else if (value === null || value === undefined) {
            value = 'null';
        }
        
        return `<td>${value}</td>`;
    }).join('');
    
    return tr;
}

/**
 * Handle row click for selection and map interaction
 */
function handleRowClick(tableName, rowData, rowElement) {
    // Remove previous selection
    document.querySelectorAll('.db-row.selected').forEach(r => r.classList.remove('selected'));
    
    // Add selection to clicked row
    rowElement.classList.add('selected');
    databaseState.selectedRow = { tableName, data: rowData };
    
    // Trigger map interaction based on table type
    if (window.highlightMapFeature) {
        window.highlightMapFeature(tableName, rowData);
    }
    
    console.log(`📍 Selected ${tableName} row:`, rowData);
}

/**
 * Load more rows when scrolling to bottom
 */
function loadMoreRows() {
    const table = databaseState.tables[databaseState.activeTable];
    
    // Only load more if we're not already loading and we have data
    if (!table.loading && table.data.length > 0) {
        loadTableData(databaseState.activeTable, true);
    }
}

/**
 * Update table statistics display
 */
function updateTableStats(rowCount) {
    const rowCountEl = document.getElementById('db-row-count');
    const lastUpdatedEl = document.getElementById('db-last-updated');
    
    if (rowCountEl) {
        rowCountEl.textContent = `Rows: ${rowCount}`;
    }
    
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleTimeString()}`;
    }
}

/**
 * Highlight a specific row in the table
 * Called from map click events
 */
export function highlightTableRow(tableName, id) {
    // Switch to the correct table if needed
    const tableSelect = document.getElementById('db-table-select');
    if (tableSelect && tableSelect.value !== tableName) {
        tableSelect.value = tableName;
        databaseState.activeTable = tableName;
        resetTableState(tableName);
        loadTableData(tableName).then(() => {
            // After loading, find and highlight the row
            scrollToRow(tableName, id);
        });
    } else {
        scrollToRow(tableName, id);
    }
}

/**
 * Scroll to and highlight a specific row
 */
function scrollToRow(tableName, id) {
    const row = document.querySelector(`tr[data-table-name="${tableName}"][data-row-id="${id}"]`);
    
    if (row) {
        // Remove previous selection
        document.querySelectorAll('.db-row.selected').forEach(r => r.classList.remove('selected'));
        
        // Select the row
        row.classList.add('selected');
        
        // Scroll into view
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add highlight animation
        row.classList.add('highlight-flash');
        setTimeout(() => row.classList.remove('highlight-flash'), 1000);
    }
}

/**
 * Get current database state (for debugging)
 */
export function getDatabaseState() {
    return databaseState;
}
