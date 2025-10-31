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
            columns: ['id', 'device_id', 'longitude', 'latitude', 'recorded_at', 'received_at', 'processed', 'batch_id', 'altitude', 'accuracy', 'speed', 'bearing']
        },
        cached_polylines: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'device_id', 'start_time', 'end_time', 'osrm_confidence', 'point_count', 'osrm_duration_ms', 'batch_id', 'created_at', 'last_accessed', 'access_count', 'bearing']
        },
        road_segments: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'segment_length', 'bearing', 'municipality_id', 'street_name', 'road_classification', 'osm_way_id', 'last_plowed_forward', 'last_plowed_reverse', 'last_plowed_device_id', 'plow_count_today', 'plow_count_total', 'last_reset_date', 'created_at', 'updated_at']
        },
        segment_updates: { 
            offset: 0, 
            data: [], 
            loading: false,
            columns: ['id', 'segment_id', 'polyline_id', 'device_id', 'direction', 'overlap_percentage', 'timestamp']
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
    
    // Load initial data for all tables
    Object.keys(databaseState.tables).forEach(tableName => {
        loadTableData(tableName);
    });
    
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
        
        <div class="db-actions" style="margin-bottom: 15px;">
            <button id="db-refresh-btn" class="db-btn">🔄 Refresh All</button>
            <button id="db-auto-refresh-btn" class="db-btn">Auto-Refresh: OFF</button>
        </div>
        
        <!-- Road Segments Table -->
        <div class="db-table-section">
            <h4>Road Segments</h4>
            <div class="db-stats">
                <span id="db-row-count-road_segments">Rows: 0</span>
                <span id="db-last-updated-road_segments">Last Updated: Never</span>
            </div>
            <div class="db-table-container" data-table="road_segments">
                <table class="db-table">
                    <thead id="db-table-head-road_segments">
                        <tr></tr>
                    </thead>
                    <tbody id="db-table-body-road_segments">
                        <tr>
                            <td colspan="100%" class="db-loading">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Cached Polylines Table -->
        <div class="db-table-section">
            <h4>Cached Polylines</h4>
            <div class="db-stats">
                <span id="db-row-count-cached_polylines">Rows: 0</span>
                <span id="db-last-updated-cached_polylines">Last Updated: Never</span>
            </div>
            <div class="db-table-container" data-table="cached_polylines">
                <table class="db-table">
                    <thead id="db-table-head-cached_polylines">
                        <tr></tr>
                    </thead>
                    <tbody id="db-table-body-cached_polylines">
                        <tr>
                            <td colspan="100%" class="db-loading">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- GPS Raw Data Table -->
        <div class="db-table-section">
            <h4>GPS Raw Data</h4>
            <div class="db-stats">
                <span id="db-row-count-gps_raw_data">Rows: 0</span>
                <span id="db-last-updated-gps_raw_data">Last Updated: Never</span>
            </div>
            <div class="db-table-container" data-table="gps_raw_data">
                <table class="db-table">
                    <thead id="db-table-head-gps_raw_data">
                        <tr></tr>
                    </thead>
                    <tbody id="db-table-body-gps_raw_data">
                        <tr>
                            <td colspan="100%" class="db-loading">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Segment Updates Table -->
        <div class="db-table-section">
            <h4>Segment Updates</h4>
            <div class="db-stats">
                <span id="db-row-count-segment_updates">Rows: 0</span>
                <span id="db-last-updated-segment_updates">Last Updated: Never</span>
            </div>
            <div class="db-table-container" data-table="segment_updates">
                <table class="db-table">
                    <thead id="db-table-head-segment_updates">
                        <tr></tr>
                    </thead>
                    <tbody id="db-table-body-segment_updates">
                        <tr>
                            <td colspan="100%" class="db-loading">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
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
    // Refresh button - refresh all tables
    const refreshBtn = document.getElementById('db-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Reset and reload all tables
            Object.keys(databaseState.tables).forEach(tableName => {
                resetTableState(tableName);
                loadTableData(tableName);
            });
        });
    }
    
    // Auto-refresh toggle - refresh all tables
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
                    Object.keys(databaseState.tables).forEach(tableName => {
                        loadTableData(tableName, true);
                    });
                }, 30000); // Refresh every 30 seconds
                autoRefreshBtn.textContent = 'Auto-Refresh: ON';
                autoRefreshBtn.classList.add('active');
            }
        });
    }
    
    // Infinite scroll for each table container
    document.querySelectorAll('.db-table-container').forEach(container => {
        const tableName = container.dataset.table;
        container.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                loadMoreRows(tableName);
            }
        });
    });
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
    
    const tbody = document.getElementById(`db-table-body-${tableName}`);
    const thead = document.getElementById(`db-table-head-${tableName}`);
    
    if (!append) {
        tbody.innerHTML = '<tr><td colspan="100%" class="db-loading">Loading...</td></tr>';
    }
    
    try {
        // Construct the API endpoint
        const url = `${databaseState.API_BASE}/database/${tableName}?limit=5&offset=${table.offset}`;
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
        updateTableStats(tableName, table.data.length);
        
    } catch (err) {
        console.error(`Failed to load ${tableName}:`, err);
        tbody.innerHTML = `<tr><td colspan="100%" class="db-error">Error: ${err.message}</td></tr>`;
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
function loadMoreRows(tableName) {
    const table = databaseState.tables[tableName];
    
    // Only load more if we're not already loading and we have data
    if (!table.loading && table.data.length > 0) {
        loadTableData(tableName, true);
    }
}

/**
 * Update table statistics display
 */
function updateTableStats(tableName, rowCount) {
    const rowCountEl = document.getElementById(`db-row-count-${tableName}`);
    const lastUpdatedEl = document.getElementById(`db-last-updated-${tableName}`);
    
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
export async function highlightTableRow(tableName, id) {
    console.log(`🎯 Highlighting ${tableName} row with ID: ${id}`);
    
    // Check if row exists in current data
    const table = databaseState.tables[tableName];
    const existingRow = table.data.find(row => row.id === id);
    
    if (existingRow) {
        console.log(`  ✅ Row ${id} already exists in table data`);
        // Row exists, just scroll to it
        scrollToRow(tableName, id);
    } else {
        console.log(`  🔍 Row ${id} not in current data, fetching from backend`);
        // Row doesn't exist, fetch it from backend and insert it
        await fetchAndInsertRow(tableName, id);
    }
}

/**
 * Fetch a single row from backend and insert it into the table
 */
async function fetchAndInsertRow(tableName, id) {
    console.log(`🔍 Fetching ${tableName} row with ID: ${id} (plus surrounding rows)`);
    
    try {
        let rowsToInsert = [];
        
        // Fetch the target row plus surrounding rows (±4)
        if (tableName === 'cached_polylines') {
            // Fetch 9 rows: target + 4 before + 4 after, ordered by ID DESC
            const url = `${databaseState.API_BASE}/database/cached_polylines?limit=9&target_id=${id}`;
            console.log(`  🌍 Fetching from: ${url}`);
            const response = await fetchJSON(url);
            
            if (response.rows && response.rows.length > 0) {
                rowsToInsert = response.rows;
            } else {
                // Fallback: fetch just the single row
                const singleUrl = `${databaseState.API_BASE}/polylines/${id}`;
                console.log(`  🔄 Fallback to single row fetch: ${singleUrl}`);
                const singleRow = await fetchJSON(singleUrl);
                if (singleRow) {
                    rowsToInsert = [singleRow];
                }
            }
        } else if (tableName === 'road_segments') {
            // Fetch 9 rows: target + 4 before + 4 after, ordered by ID DESC
            const url = `${databaseState.API_BASE}/database/road_segments?limit=9&target_id=${id}`;
            console.log(`  🌍 Fetching from: ${url}`);
            const response = await fetchJSON(url);
            
            if (response.rows && response.rows.length > 0) {
                rowsToInsert = response.rows;
            } else {
                // Fallback: fetch just the single row and transform it
                const singleUrl = `${databaseState.API_BASE}/segments/${id}`;
                console.log(`  🔄 Fallback to single row fetch: ${singleUrl}`);
                const segment = await fetchJSON(singleUrl);
                if (segment) {
                    rowsToInsert = [{
                        id: segment.id,
                        segment_length: segment.properties.segment_length,
                        bearing: segment.properties.bearing,
                        municipality_id: segment.properties.municipality_id,
                        street_name: segment.properties.street_name,
                        road_classification: segment.properties.road_classification,
                        osm_way_id: segment.properties.osm_way_id,
                        last_plowed_forward: segment.properties.last_plowed_forward,
                        last_plowed_reverse: segment.properties.last_plowed_reverse,
                        last_plowed_device_id: segment.properties.last_plowed_device_id,
                        plow_count_today: segment.properties.plow_count_today,
                        plow_count_total: segment.properties.plow_count_total,
                        last_reset_date: segment.properties.last_reset_date,
                        created_at: segment.properties.created_at,
                        updated_at: segment.properties.updated_at
                    }];
                }
            }
        } else {
            console.warn(`⚠️ Cannot fetch individual row for table: ${tableName}`);
            return;
        }
        
        if (rowsToInsert.length === 0) {
            console.warn(`⚠️ Row ${id} not found in ${tableName}`);
            return;
        }
        
        console.log(`  📦 Received ${rowsToInsert.length} rows`);
        
        // Ensure table has been initialized with headers
        const tbody = document.getElementById(`db-table-body-${tableName}`);
        const thead = document.getElementById(`db-table-head-${tableName}`);
        const table = databaseState.tables[tableName];
        
        // ALWAYS initialize headers when fetching new data
        console.log(`  🔧 Initializing table headers for ${tableName}`);
        const headerRow = thead.querySelector('tr');
        headerRow.innerHTML = table.columns.map(col => 
            `<th>${col.replace(/_/g, ' ').toUpperCase()}</th>`
        ).join('');
        tbody.innerHTML = '';
        
        // Clear existing data and replace with new rows
        table.data = rowsToInsert;
        tbody.innerHTML = '';
        console.log(`  ♻️ Replaced table data with ${rowsToInsert.length} rows`);
        
        // Create and insert all row elements
        const fragment = document.createDocumentFragment();
        rowsToInsert.forEach((rowData, index) => {
            const tr = createTableRow(tableName, rowData, index);
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
        console.log(`  🎯 Inserted ${rowsToInsert.length} row elements into DOM`);
        
        // Update stats
        updateTableStats(table.data.length);
        
        // Scroll to and highlight the target row
        scrollToRow(tableName, id);
        
        console.log(`✅ Successfully loaded and highlighted row ${id} in ${tableName}`);
        
    } catch (err) {
        console.error(`❌ Failed to fetch row ${id} from ${tableName}:`, err);
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
