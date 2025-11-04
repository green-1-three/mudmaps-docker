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
            columns: ['id', 'device_id', 'geometry', 'start_time', 'end_time', 'osrm_confidence', 'point_count', 'osrm_duration_ms', 'batch_id', 'created_at', 'last_accessed', 'access_count', 'bearing']
        },
        road_segments: {
            offset: 0,
            data: [],
            loading: false,
            columns: ['id', 'geometry', 'segment_length', 'bearing', 'municipality_id', 'street_name', 'road_classification', 'osm_way_id', 'osm_tags', 'last_plowed_forward', 'last_plowed_reverse', 'last_plowed_device_id', 'plow_count_today', 'plow_count_total', 'last_reset_date', 'created_at', 'updated_at']
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
        <h3>Database</h3>

        <!-- Sub-tabs for Database tab -->
        <div class="db-sub-tabs" style="display: flex; gap: 5px; margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">
            <button class="db-sub-tab active" data-db-subtab="inspector">Inspector</button>
            <button class="db-sub-tab" data-db-subtab="operations">Operations</button>
        </div>

        <!-- Inspector Sub-tab -->
        <div class="db-sub-tab-content active" data-db-subtab-content="inspector">
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
                <div class="db-table-actions">
                    <button id="db-copy-road_segments" class="db-action-btn">📋 Copy Visible Data</button>
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
                <div class="db-table-actions">
                    <button id="db-view-gps-from-polyline" class="db-action-btn" disabled>🔍 View GPS Points</button>
                    <button id="db-copy-cached_polylines" class="db-action-btn">📋 Copy Visible Data</button>
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
                <div class="db-table-actions">
                    <button id="db-view-polyline-from-gps" class="db-action-btn" disabled>🔍 View Polyline</button>
                    <button id="db-copy-gps_raw_data" class="db-action-btn">📋 Copy Visible Data</button>
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
                <div class="db-table-actions">
                    <button id="db-copy-segment_updates" class="db-action-btn">📋 Copy Visible Data</button>
                </div>
            </div>
        </div>

        <!-- Operations Sub-tab -->
        <div class="db-sub-tab-content" data-db-subtab-content="operations">
            <h4>Database Operations</h4>
            <p style="color: #666; margin-bottom: 20px;">Perform maintenance and bulk operations on the database.</p>

            <div class="operation-section" style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                <h5 style="margin-top: 0;">Reprocess Cached Polylines</h5>
                <p style="color: #666; font-size: 13px; margin-bottom: 15px;">
                    Re-run segment activation for all existing polylines. This will activate road segments
                    that were missed due to strict intersection logic. Uses the updated 2m buffer detection.
                </p>

                <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
                    <label for="reprocess-limit" style="font-size: 13px;">Process:</label>
                    <select id="reprocess-limit" style="padding: 5px;">
                        <option value="">All polylines</option>
                        <option value="100">100 polylines</option>
                        <option value="500">500 polylines</option>
                        <option value="1000">1000 polylines</option>
                    </select>
                    <button id="reprocess-polylines-btn" class="db-btn" style="background: #1976d2; color: white; padding: 8px 15px;">
                        ▶ Start Reprocessing
                    </button>
                </div>

                <div id="reprocess-stats" style="background: white; padding: 10px; border-radius: 3px; font-size: 13px; display: none;">
                    <div><strong>Database Stats:</strong></div>
                    <div id="reprocess-stats-content" style="margin-top: 5px; line-height: 1.6;"></div>
                </div>

                <div id="reprocess-progress" style="margin-top: 15px; display: none;">
                    <div style="background: white; padding: 10px; border-radius: 3px; font-size: 13px;">
                        <div><strong>Progress:</strong></div>
                        <div id="reprocess-progress-content" style="margin-top: 5px; line-height: 1.6;"></div>
                    </div>
                </div>
            </div>

            <div class="operation-section" style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                <h5 style="margin-top: 0;">Generate Offset Geometries</h5>
                <p style="color: #666; font-size: 13px; margin-bottom: 15px;">
                    Generate offset geometries for road segments for directional plow visualization.
                    Creates left/right offset lines 2m from centerline using full OSM way curves.
                </p>

                <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
                    <label for="offset-limit" style="font-size: 13px;">Process:</label>
                    <select id="offset-limit" style="padding: 5px;">
                        <option value="">All ways</option>
                        <option value="10">10 ways</option>
                        <option value="50">50 ways</option>
                        <option value="100">100 ways</option>
                    </select>
                    <button id="generate-offsets-btn" class="db-btn" style="background: #6a1b9a; color: white; padding: 8px 15px;">
                        ▶ Start Generation
                    </button>
                </div>

                <div id="offset-stats" style="background: white; padding: 10px; border-radius: 3px; font-size: 13px; display: none;">
                    <div><strong>Offset Stats:</strong></div>
                    <div id="offset-stats-content" style="margin-top: 5px; line-height: 1.6;"></div>
                </div>

                <div id="offset-progress" style="margin-top: 15px; display: none;">
                    <div style="background: white; padding: 10px; border-radius: 3px; font-size: 13px;">
                        <div><strong>Progress:</strong></div>
                        <div id="offset-progress-content" style="margin-top: 5px; line-height: 1.6;"></div>
                    </div>
                </div>
            </div>

            <div class="operation-section" style="background: #fff3cd; padding: 15px; border-radius: 5px; border: 1px solid #ffc107;">
                <h5 style="margin-top: 0; color: #856404;">⚠️ Warning</h5>
                <p style="color: #856404; font-size: 13px; margin: 0;">
                    These operations can take several minutes for large datasets and may impact system performance.
                    Make sure no critical operations are running before proceeding.
                </p>
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
    
    // Copy buttons - copy visible table data as JSON
    setupCopyButton('db-copy-road_segments', 'road_segments');
    setupCopyButton('db-copy-cached_polylines', 'cached_polylines');
    setupCopyButton('db-copy-gps_raw_data', 'gps_raw_data');
    setupCopyButton('db-copy-segment_updates', 'segment_updates');
    
    // Navigation buttons - view related data
    setupViewGPSButton();
    setupViewPolylineButton();

    // Sub-tab switching
    const subTabs = document.querySelectorAll('.db-sub-tab');
    subTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const subtabName = tab.dataset.dbSubtab;

            // Update active sub-tab button
            subTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active sub-tab content
            document.querySelectorAll('.db-sub-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const targetContent = document.querySelector(`[data-db-subtab-content="${subtabName}"]`);
            if (targetContent) {
                targetContent.classList.add('active');

                // Load stats when Operations tab is opened
                if (subtabName === 'operations') {
                    loadReprocessStats();
                    loadOffsetStats();
                }
            }
        });
    });

    // Reprocess polylines button
    const reprocessBtn = document.getElementById('reprocess-polylines-btn');
    if (reprocessBtn) {
        reprocessBtn.addEventListener('click', async () => {
            const limitSelect = document.getElementById('reprocess-limit');
            const limit = limitSelect.value ? parseInt(limitSelect.value) : null;

            if (!confirm(`Are you sure you want to reprocess ${limit ? limit + ' polylines' : 'ALL polylines'}? This may take several minutes.`)) {
                return;
            }

            reprocessBtn.disabled = true;
            reprocessBtn.textContent = '⏳ Starting...';

            const progressDiv = document.getElementById('reprocess-progress');
            const progressContent = document.getElementById('reprocess-progress-content');
            progressDiv.style.display = 'block';
            progressContent.innerHTML = 'Starting reprocessing job...';

            try {
                // Start the job
                const body = limit ? { limit } : {};
                const response = await fetch(`${databaseState.API_BASE}/operations/reprocess-polylines`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                const startResult = await response.json();

                if (!startResult.success || !startResult.jobId) {
                    progressContent.innerHTML = `❌ <strong>Error:</strong> ${startResult.message || 'Failed to start job'}`;
                    reprocessBtn.disabled = false;
                    reprocessBtn.textContent = '▶ Start Reprocessing';
                    return;
                }

                // Poll for job status
                const jobId = startResult.jobId;
                progressContent.innerHTML = `Job started: ${jobId}<br>Checking status...`;

                pollJobStatus(jobId, progressContent, reprocessBtn);

            } catch (error) {
                progressContent.innerHTML = `❌ <strong>Error:</strong> ${error.message}`;
                reprocessBtn.disabled = false;
                reprocessBtn.textContent = '▶ Start Reprocessing';
            }
        });
    }

    // Generate offsets button
    const generateOffsetsBtn = document.getElementById('generate-offsets-btn');
    if (generateOffsetsBtn) {
        generateOffsetsBtn.addEventListener('click', async () => {
            const limitSelect = document.getElementById('offset-limit');
            const limit = limitSelect.value ? parseInt(limitSelect.value) : null;

            if (!confirm(`Are you sure you want to generate offsets for ${limit ? limit + ' ways' : 'ALL ways'}? This may take several minutes.`)) {
                return;
            }

            generateOffsetsBtn.disabled = true;
            generateOffsetsBtn.textContent = '⏳ Starting...';

            const progressDiv = document.getElementById('offset-progress');
            const progressContent = document.getElementById('offset-progress-content');
            progressDiv.style.display = 'block';
            progressContent.innerHTML = 'Starting offset generation job...';

            try {
                // Start the job
                const body = limit ? { limit } : {};
                const response = await fetch(`${databaseState.API_BASE}/operations/generate-offsets`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });

                const startResult = await response.json();

                if (!startResult.success || !startResult.jobId) {
                    progressContent.innerHTML = `❌ <strong>Error:</strong> ${startResult.message || 'Failed to start job'}`;
                    generateOffsetsBtn.disabled = false;
                    generateOffsetsBtn.textContent = '▶ Start Generation';
                    return;
                }

                // Poll for job status
                const jobId = startResult.jobId;
                progressContent.innerHTML = `Job started: ${jobId}<br>Checking status...`;

                pollOffsetJobStatus(jobId, progressContent, generateOffsetsBtn);

            } catch (error) {
                progressContent.innerHTML = `❌ <strong>Error:</strong> ${error.message}`;
                generateOffsetsBtn.disabled = false;
                generateOffsetsBtn.textContent = '▶ Start Generation';
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
    
    const tbody = document.getElementById(`db-table-body-${tableName}`);
    const thead = document.getElementById(`db-table-head-${tableName}`);
    
    if (!append) {
        tbody.innerHTML = '<tr><td colspan="100%" class="db-loading">Loading...</td></tr>';
    }
    
    try {
        // Construct the API endpoint
        const url = `${databaseState.API_BASE}/database/${tableName}?limit=20&offset=${table.offset}`;
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
        if (col === 'geometry') {
            // Format geometry as "LINESTRING([lon1,lat1] ... [lonN,latN])"
            if (value && typeof value === 'object' && value.coordinates) {
                const coords = value.coordinates;
                if (coords.length > 0) {
                    const first = coords[0];
                    const last = coords[coords.length - 1];
                    const vertexCount = coords.length;
                    value = `LINESTRING([${first[0].toFixed(5)},${first[1].toFixed(5)}] ... [${last[0].toFixed(5)},${last[1].toFixed(5)}]) (${vertexCount} vertices)`;
                } else {
                    value = 'LINESTRING (empty)';
                }
            } else if (value === null || value === undefined) {
                value = 'null';
            } else {
                value = String(value);
            }
        } else if (col === 'osm_tags') {
            // Format osm_tags as truncated JSON
            if (value && typeof value === 'object') {
                const json = JSON.stringify(value);
                value = json.length > 50 ? json.substring(0, 50) + '...' : json;
            } else if (value === null || value === undefined) {
                value = 'null';
            } else {
                value = String(value);
            }
        } else if (col.includes('time') || col.includes('_at')) {
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
    
    // Enable/disable navigation buttons based on selection
    updateNavigationButtons(tableName, rowData);
    
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
 * Update navigation button states based on selected row
 */
function updateNavigationButtons(tableName, rowData) {
    const viewGPSBtn = document.getElementById('db-view-gps-from-polyline');
    const viewPolylineBtn = document.getElementById('db-view-polyline-from-gps');
    
    // Clear any existing errors
    clearButtonError('db-view-gps-from-polyline');
    clearButtonError('db-view-polyline-from-gps');
    
    // Enable View GPS Points button if polyline with batch_id is selected
    if (viewGPSBtn) {
        if (tableName === 'cached_polylines' && rowData.batch_id) {
            viewGPSBtn.disabled = false;
        } else {
            viewGPSBtn.disabled = true;
        }
    }
    
    // Enable View Polyline button if GPS point with batch_id is selected
    if (viewPolylineBtn) {
        if (tableName === 'gps_raw_data' && rowData.batch_id) {
            viewPolylineBtn.disabled = false;
        } else {
            viewPolylineBtn.disabled = true;
        }
    }
}

/**
 * Setup copy button for a specific table
 */
function setupCopyButton(buttonId, tableName) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.addEventListener('click', () => {
            const table = databaseState.tables[tableName];
            if (table.data.length === 0) {
                console.warn(`No data to copy from ${tableName}`);
                return;
            }
            
            // Copy data as JSON
            const jsonString = JSON.stringify(table.data, null, 2);
            
            // Copy to clipboard
            navigator.clipboard.writeText(jsonString).then(() => {
                console.log(`✅ Copied ${table.data.length} rows from ${tableName} as JSON`);
                
                // Visual feedback
                const originalText = button.textContent;
                button.textContent = '✅ Copied!';
                button.classList.add('success');
                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('success');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy:', err);
                alert('Failed to copy data to clipboard');
            });
        });
    }
}

/**
 * Setup View GPS Points button (from cached_polylines table)
 */
function setupViewGPSButton() {
    const button = document.getElementById('db-view-gps-from-polyline');
    if (!button) return;
    
    button.addEventListener('click', async () => {
        const selected = databaseState.selectedRow;
        
        if (!selected || selected.tableName !== 'cached_polylines') {
            console.warn('No polyline selected');
            return;
        }
        
        const batchId = selected.data.batch_id;
        if (!batchId) {
            console.warn('Selected polyline has no batch_id');
            return;
        }
        
        console.log(`🔍 Loading GPS points for batch_id: ${batchId}`);
        button.disabled = true;
        button.textContent = '⏳ Loading...';
        clearButtonError('db-view-gps-from-polyline');
        
        try {
            // Fetch GPS points by batch_id
            const url = `${databaseState.API_BASE}/database/gps_raw_data/by-batch/${batchId}`;
            const response = await fetchJSON(url);
            
            if (!response || response.length === 0) {
                console.warn(`No GPS points found for batch_id: ${batchId}`);
                showButtonError('db-view-gps-from-polyline', 'No GPS points found for this polyline');
                return;
            }
            
            console.log(`📍 Found ${response.length} GPS points`);
            
            // Replace GPS table data with these points
            const gpsTable = databaseState.tables.gps_raw_data;
            gpsTable.data = response;
            gpsTable.offset = response.length;
            
            // Rebuild GPS table
            const tbody = document.getElementById('db-table-body-gps_raw_data');
            const thead = document.getElementById('db-table-head-gps_raw_data');
            
            // Initialize headers
            const headerRow = thead.querySelector('tr');
            headerRow.innerHTML = gpsTable.columns.map(col => 
                `<th>${col.replace(/_/g, ' ').toUpperCase()}</th>`
            ).join('');
            
            // Build rows
            tbody.innerHTML = '';
            const fragment = document.createDocumentFragment();
            response.forEach((rowData, index) => {
                const tr = createTableRow('gps_raw_data', rowData, index);
                fragment.appendChild(tr);
            });
            tbody.appendChild(fragment);
            
            // Update stats
            updateTableStats('gps_raw_data', response.length);
            
            // Scroll GPS table into view
            const gpsSection = document.querySelector('[data-table="gps_raw_data"]').closest('.db-table-section');
            if (gpsSection) {
                gpsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            
            console.log(`✅ Loaded ${response.length} GPS points into table`);
            
        } catch (err) {
            console.error('Failed to load GPS points:', err);
            showButtonError('db-view-gps-from-polyline', 'Failed to load GPS points');
        } finally {
            button.disabled = false;
            button.textContent = '🔍 View GPS Points';
        }
    });
}

/**
 * Setup View Polyline button (from gps_raw_data table)
 */
function setupViewPolylineButton() {
    const button = document.getElementById('db-view-polyline-from-gps');
    if (!button) return;
    
    button.addEventListener('click', async () => {
        const selected = databaseState.selectedRow;
        
        if (!selected || selected.tableName !== 'gps_raw_data') {
            console.warn('No GPS point selected');
            return;
        }
        
        const batchId = selected.data.batch_id;
        if (!batchId) {
            console.warn('Selected GPS point has no batch_id');
            return;
        }
        
        console.log(`🔍 Loading polyline for batch_id: ${batchId}`);
        button.disabled = true;
        button.textContent = '⏳ Loading...';
        clearButtonError('db-view-polyline-from-gps');
        
        try {
            // Fetch polyline by batch_id
            const url = `${databaseState.API_BASE}/database/cached_polylines/by-batch/${batchId}`;
            const response = await fetchJSON(url);
            
            if (!response) {
                console.warn(`No polyline found for batch_id: ${batchId}`);
                showButtonError('db-view-polyline-from-gps', 'No polyline found for this GPS point');
                return;
            }
            
            console.log(`📍 Found polyline:`, response);
            
            // Replace polyline table data with this polyline
            const polylineTable = databaseState.tables.cached_polylines;
            polylineTable.data = [response];
            polylineTable.offset = 1;
            
            // Rebuild polyline table
            const tbody = document.getElementById('db-table-body-cached_polylines');
            const thead = document.getElementById('db-table-head-cached_polylines');
            
            // Initialize headers
            const headerRow = thead.querySelector('tr');
            headerRow.innerHTML = polylineTable.columns.map(col => 
                `<th>${col.replace(/_/g, ' ').toUpperCase()}</th>`
            ).join('');
            
            // Build row
            tbody.innerHTML = '';
            const tr = createTableRow('cached_polylines', response, 0);
            tbody.appendChild(tr);
            
            // Update stats
            updateTableStats('cached_polylines', 1);
            
            // Scroll polyline table into view
            const polylineSection = document.querySelector('[data-table="cached_polylines"]').closest('.db-table-section');
            if (polylineSection) {
                polylineSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            
            // Auto-select the row
            tr.click();
            
            console.log(`✅ Loaded polyline into table`);
            
        } catch (err) {
            console.error('Failed to load polyline:', err);
            showButtonError('db-view-polyline-from-gps', 'Failed to load polyline');
        } finally {
            button.disabled = false;
            button.textContent = '🔍 View Polyline';
        }
    });
}

/**
 * Show error message below a button
 */
function showButtonError(buttonId, message) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    
    // Remove any existing error
    clearButtonError(buttonId);
    
    // Create error element
    const errorEl = document.createElement('div');
    errorEl.className = 'db-button-error';
    errorEl.id = `${buttonId}-error`;
    errorEl.textContent = message;
    
    // Insert after button's parent container
    const buttonContainer = button.closest('.db-table-actions');
    if (buttonContainer) {
        buttonContainer.parentNode.insertBefore(errorEl, buttonContainer.nextSibling);
    }
}

/**
 * Clear error message below a button
 */
function clearButtonError(buttonId) {
    const errorEl = document.getElementById(`${buttonId}-error`);
    if (errorEl) {
        errorEl.remove();
    }
}

/**
 * Poll job status until completion
 */
async function pollJobStatus(jobId, progressContent, reprocessBtn) {
    const pollInterval = 1000; // Poll every second
    let attempts = 0;
    const maxAttempts = 600; // Max 10 minutes

    const poll = async () => {
        attempts++;

        if (attempts > maxAttempts) {
            progressContent.innerHTML = `❌ <strong>Timeout:</strong> Job took too long. Check backend logs for status.`;
            reprocessBtn.disabled = false;
            reprocessBtn.textContent = '▶ Start Reprocessing';
            return;
        }

        try {
            const response = await fetchJSON(`${databaseState.API_BASE}/operations/jobs/${jobId}`);

            if (!response) {
                progressContent.innerHTML = `❌ <strong>Error:</strong> Job not found`;
                reprocessBtn.disabled = false;
                reprocessBtn.textContent = '▶ Start Reprocessing';
                return;
            }

            const { status, progress, result, error } = response;

            // Update progress display
            if (status === 'running') {
                const percentage = progress.percentage || 0;
                const current = progress.current || 0;
                const total = progress.total || 0;

                progressContent.innerHTML = `
                    ⏳ <strong>Processing...</strong><br>
                    • Progress: ${current} / ${total} polylines (${percentage}%)<br>
                    • Status: Running
                `;

                // Continue polling
                setTimeout(poll, pollInterval);
            } else if (status === 'completed') {
                progressContent.innerHTML = `
                    ✅ <strong>Success!</strong><br>
                    • Processed: ${result.processed} polylines<br>
                    • Segments Activated: ${result.segmentsActivated} updates<br>
                    • Message: ${result.message}
                    ${result.errors ? `<br>• Errors: ${result.errors.length}` : ''}
                `;

                reprocessBtn.disabled = false;
                reprocessBtn.textContent = '▶ Start Reprocessing';

                // Reload stats
                loadReprocessStats();
            } else if (status === 'failed') {
                progressContent.innerHTML = `❌ <strong>Error:</strong> ${error || 'Job failed'}`;
                reprocessBtn.disabled = false;
                reprocessBtn.textContent = '▶ Start Reprocessing';
            }
        } catch (err) {
            progressContent.innerHTML = `❌ <strong>Error:</strong> ${err.message}`;
            reprocessBtn.disabled = false;
            reprocessBtn.textContent = '▶ Start Reprocessing';
        }
    };

    // Start polling
    poll();
}

/**
 * Poll offset generation job status
 */
async function pollOffsetJobStatus(jobId, progressContent, generateOffsetsBtn) {
    const pollInterval = 1000; // Poll every second
    let attempts = 0;
    const maxAttempts = 600; // Max 10 minutes

    const poll = async () => {
        attempts++;

        if (attempts > maxAttempts) {
            progressContent.innerHTML = `❌ <strong>Timeout:</strong> Job took too long. Check backend logs for status.`;
            generateOffsetsBtn.disabled = false;
            generateOffsetsBtn.textContent = '▶ Start Generation';
            return;
        }

        try {
            const response = await fetchJSON(`${databaseState.API_BASE}/operations/jobs/${jobId}`);

            if (!response) {
                progressContent.innerHTML = `❌ <strong>Error:</strong> Job not found`;
                generateOffsetsBtn.disabled = false;
                generateOffsetsBtn.textContent = '▶ Start Generation';
                return;
            }

            const { status, progress, result, error } = response;

            // Update progress display
            if (status === 'running') {
                const percentage = progress.percentage || 0;
                const current = progress.current || 0;
                const total = progress.total || 0;

                progressContent.innerHTML = `
                    ⏳ <strong>Processing...</strong><br>
                    • Progress: ${current} / ${total} ways (${percentage}%)<br>
                    • Status: Running
                `;

                // Continue polling
                setTimeout(poll, pollInterval);
            } else if (status === 'completed') {
                progressContent.innerHTML = `
                    ✅ <strong>Success!</strong><br>
                    • Processed: ${result.processed} ways<br>
                    • Segments Updated: ${result.segmentsUpdated}<br>
                    • Message: ${result.message}
                    ${result.errors ? `<br>• Errors: ${result.errors.length}` : ''}
                `;

                generateOffsetsBtn.disabled = false;
                generateOffsetsBtn.textContent = '▶ Start Generation';

                // Reload stats
                loadOffsetStats();
            } else if (status === 'failed') {
                progressContent.innerHTML = `❌ <strong>Error:</strong> ${error || 'Job failed'}`;
                generateOffsetsBtn.disabled = false;
                generateOffsetsBtn.textContent = '▶ Start Generation';
            }
        } catch (err) {
            progressContent.innerHTML = `❌ <strong>Error:</strong> ${err.message}`;
            generateOffsetsBtn.disabled = false;
            generateOffsetsBtn.textContent = '▶ Start Generation';
        }
    };

    // Start polling
    poll();
}

/**
 * Load offset generation statistics
 */
async function loadOffsetStats() {
    const statsDiv = document.getElementById('offset-stats');
    const statsContent = document.getElementById('offset-stats-content');

    if (!statsDiv || !statsContent) return;

    statsDiv.style.display = 'block';
    statsContent.innerHTML = 'Loading stats...';

    try {
        const stats = await fetchJSON(`${databaseState.API_BASE}/operations/offset-status`);

        if (stats) {
            const totalSegments = parseInt(stats.total_segments) || 0;
            const segmentsWithForward = parseInt(stats.segments_with_forward) || 0;
            const segmentsWithReverse = parseInt(stats.segments_with_reverse) || 0;
            const totalWays = parseInt(stats.total_ways) || 0;
            const waysWithOffsets = parseInt(stats.ways_with_offsets) || 0;
            const pendingWays = totalWays - waysWithOffsets;

            statsContent.innerHTML = `
                • Total Segments: ${totalSegments.toLocaleString()}<br>
                • Segments with Forward Offset: ${segmentsWithForward.toLocaleString()}<br>
                • Segments with Reverse Offset: ${segmentsWithReverse.toLocaleString()}<br>
                • Total OSM Ways: ${totalWays.toLocaleString()}<br>
                • Ways with Offsets: ${waysWithOffsets.toLocaleString()}<br>
                • Pending: ${pendingWays.toLocaleString()} ways
            `;
        } else {
            statsContent.innerHTML = 'Failed to load stats';
        }
    } catch (error) {
        statsContent.innerHTML = `Error: ${error.message}`;
    }
}

/**
 * Load reprocess statistics
 */
async function loadReprocessStats() {
    const statsDiv = document.getElementById('reprocess-stats');
    const statsContent = document.getElementById('reprocess-stats-content');

    if (!statsDiv || !statsContent) return;

    statsDiv.style.display = 'block';
    statsContent.innerHTML = 'Loading statistics...';

    try {
        const response = await fetchJSON(`${databaseState.API_BASE}/operations/reprocess-status`);

        if (response) {
            const { polylines, segments } = response;

            statsContent.innerHTML = `
                <strong>Polylines:</strong><br>
                • Total: ${polylines.total_polylines}<br>
                • With Geometry: ${polylines.polylines_with_geometry}<br>
                • Unique Devices: ${polylines.unique_devices}<br>
                • Date Range: ${polylines.oldest_polyline ? new Date(polylines.oldest_polyline).toLocaleDateString() : 'N/A'}
                  to ${polylines.newest_polyline ? new Date(polylines.newest_polyline).toLocaleDateString() : 'N/A'}<br>
                <br>
                <strong>Road Segments:</strong><br>
                • Total: ${segments.total_segments}<br>
                • Activated: ${segments.activated_segments} (${((segments.activated_segments / segments.total_segments) * 100).toFixed(1)}%)
            `;
        }
    } catch (error) {
        statsContent.innerHTML = `❌ Error loading stats: ${error.message}`;
    }
}

/**
 * Get current database state (for debugging)
 */
export function getDatabaseState() {
    return databaseState;
}
