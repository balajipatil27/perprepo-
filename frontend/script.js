// ==================== CONFIGURATION ====================
const CONFIG = {
    BACKEND_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:5000' 
        : 'https://your-backend-service.onrender.com', // CHANGE THIS FOR DEPLOYMENT
    ADMIN_TOKEN: 'admin123', // CHANGE THIS IN PRODUCTION
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    TRACKING_ENABLED: true
};

// ==================== GLOBAL STATE ====================
let appState = {
    currentStep: 1,
    sessionId: null,
    datasetId: null,
    datasetInfo: null,
    selectedColumns: new Set(),
    preprocessingSteps: [],
    currentJobId: null,
    processedFile: null,
    comparisonResults: null,
    analyticsData: {
        pageViews: 0,
        sessionStart: Date.now(),
        lastActivity: Date.now()
    }
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    trackPageView('home');
});

function initializeApp() {
    // Initialize session
    appState.sessionId = getOrCreateSessionId();
    
    // Update session time display
    updateSessionTime();
    setInterval(updateSessionTime, 60000); // Update every minute
    
    // Check for existing state in localStorage
    loadAppState();
    
    // Update UI based on state
    updateProgressIndicator();
    showStep(appState.currentStep);
    
    // Initialize any charts
    initializeCharts();
}

function setupEventListeners() {
    // File upload
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    
    fileInput.addEventListener('change', handleFileUpload);
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = CONFIG.primaryColor;
        uploadArea.style.background = 'rgba(74, 111, 165, 0.05)';
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '';
        uploadArea.style.background = '';
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '';
        uploadArea.style.background = '';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleFileUpload();
        }
    });
    
    // Track user activity
    document.addEventListener('click', () => {
        appState.analyticsData.lastActivity = Date.now();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'h') {
            e.preventDefault();
            showHelp();
        }
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// ==================== SESSION MANAGEMENT ====================
function getOrCreateSessionId() {
    let sessionId = localStorage.getItem('session_id');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('session_id', sessionId);
    }
    return sessionId;
}

function updateSessionTime() {
    const elapsed = Math.floor((Date.now() - appState.analyticsData.sessionStart) / 60000);
    document.getElementById('sessionTime').textContent = `Session: ${elapsed}m`;
    document.getElementById('pageViews').textContent = `Views: ${appState.analyticsData.pageViews}`;
}

function loadAppState() {
    try {
        const savedState = localStorage.getItem('appState');
        if (savedState) {
            const parsed = JSON.parse(savedState);
            // Merge with current state, preserving some defaults
            appState = {
                ...appState,
                ...parsed,
                selectedColumns: new Set(parsed.selectedColumns || []),
                preprocessingSteps: parsed.preprocessingSteps || []
            };
        }
    } catch (e) {
        console.warn('Could not load saved state:', e);
    }
}

function saveAppState() {
    try {
        const stateToSave = {
            ...appState,
            selectedColumns: Array.from(appState.selectedColumns),
            preprocessingSteps: appState.preprocessingSteps
        };
        localStorage.setItem('appState', JSON.stringify(stateToSave));
    } catch (e) {
        console.warn('Could not save state:', e);
    }
}

// ==================== TRACKING ====================
function trackPageView(page, action = null, details = {}) {
    if (!CONFIG.TRACKING_ENABLED) return;
    
    appState.analyticsData.pageViews++;
    
    fetch(`${CONFIG.BACKEND_URL}/api/track`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            session_id: appState.sessionId,
            page: page,
            action: action,
            details: details
        })
    }).catch(() => {
        // Silently fail if tracking fails
    });
    
    saveAppState();
}

// ==================== STEP NAVIGATION ====================
function showStep(stepNumber) {
    // Hide all steps
    document.querySelectorAll('.app-step').forEach(step => {
        step.classList.remove('active');
    });
    
    // Show selected step
    const stepElement = document.getElementById(`step-${getStepName(stepNumber)}`);
    if (stepElement) {
        stepElement.classList.add('active');
    }
    
    // Update progress indicator
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
    });
    
    const stepIndicator = document.querySelector(`.step[data-step="${stepNumber}"]`);
    if (stepIndicator) {
        stepIndicator.classList.add('active');
    }
    
    appState.currentStep = stepNumber;
    saveAppState();
    
    // Track step change
    trackPageView(getStepName(stepNumber), 'view');
}

function getStepName(stepNumber) {
    const steps = ['upload', 'preprocess', 'models', 'download'];
    return steps[stepNumber - 1] || 'upload';
}

function updateProgressIndicator() {
    document.querySelectorAll('.step').forEach((step, index) => {
        const stepNum = index + 1;
        if (stepNum <= appState.currentStep) {
            step.classList.add('active');
        } else {
            step.classList.remove('active');
        }
    });
}

function proceedToPreprocessing() {
    if (!appState.datasetId) {
        showNotification('Please upload a dataset first', 'error');
        return;
    }
    showStep(2);
    loadDatasetInfo();
}

function proceedToModelComparison() {
    if (!appState.processedFile) {
        showNotification('Please preprocess the dataset first', 'error');
        return;
    }
    showStep(3);
    populateTargetColumnSelect();
}

function proceedToDownload() {
    if (!appState.comparisonResults) {
        showNotification('Please run model comparison first', 'error');
        return;
    }
    showStep(4);
    updateDownloadSummary();
}

// ==================== FILE UPLOAD ====================
async function handleFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    // Validate file size
    if (file.size > CONFIG.MAX_FILE_SIZE) {
        showNotification('File too large (max 100MB)', 'error');
        return;
    }
    
    // Validate file type
    const validExtensions = ['.csv', '.xls', '.xlsx'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExtensions.includes(fileExt)) {
        showNotification('Invalid file type. Please upload CSV or Excel files.', 'error');
        return;
    }
    
    showLoading('Uploading dataset...');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update app state
            appState.datasetId = data.dataset_id;
            appState.datasetInfo = data;
            
            // Update UI
            updateFileInfoUI(data, file);
            showNotification('Dataset uploaded successfully!', 'success');
            
            // Track upload
            trackPageView('upload', 'success', {
                filename: file.name,
                size: file.size,
                rows: data.rows,
                columns: data.columns
            });
            
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
        console.error('Upload error:', error);
    } finally {
        hideLoading();
    }
}

function updateFileInfoUI(data, file) {
    // Update file info card
    document.getElementById('fileName').textContent = data.filename;
    document.getElementById('fileRows').textContent = data.rows.toLocaleString();
    document.getElementById('fileColumns').textContent = data.columns.toLocaleString();
    document.getElementById('fileSize').textContent = Math.round(file.size / 1024);
    
    // Show file info card
    document.getElementById('fileInfoCard').classList.remove('hidden');
    
    // Show preview if available
    if (data.preview && data.preview.length > 0) {
        const previewHtml = generatePreviewTable(data.preview);
        document.getElementById('filePreview').innerHTML = previewHtml;
    }
}

function generatePreviewTable(data) {
    if (!data || data.length === 0) return '<p>No preview available</p>';
    
    const headers = Object.keys(data[0]);
    const rows = data.slice(0, 10); // Limit to 10 rows for preview
    
    let html = '<table><thead><tr>';
    
    // Headers
    headers.forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    // Rows
    rows.forEach(row => {
        html += '<tr>';
        headers.forEach(header => {
            const value = row[header];
            html += `<td>${escapeHtml(String(value))}</td>`;
        });
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    return html;
}

function clearUpload() {
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfoCard').classList.add('hidden');
    appState.datasetId = null;
    appState.datasetInfo = null;
    saveAppState();
}

// ==================== DATASET INFO ====================
async function loadDatasetInfo() {
    if (!appState.datasetId) return;
    
    showLoading('Loading dataset information...');
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/dataset/${appState.datasetId}/info`);
        const data = await response.json();
        
        if (response.ok) {
            appState.datasetInfo = data;
            updateDatasetOverview(data);
            updateColumnSelect(data.column_info);
            showNotification('Dataset loaded successfully', 'success');
        } else {
            throw new Error(data.error || 'Failed to load dataset info');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        hideLoading();
    }
}

function updateDatasetOverview(data) {
    // Update overview stats
    document.getElementById('overviewRows').textContent = data.rows?.toLocaleString() || '0';
    document.getElementById('overviewColumns').textContent = data.columns?.toLocaleString() || '0';
    document.getElementById('overviewMissing').textContent = data.missing_values?.toLocaleString() || '0';
    document.getElementById('overviewDuplicates').textContent = data.duplicates?.toLocaleString() || '0';
    
    // Update columns display
    if (data.column_info) {
        updateColumnsDisplay(data.column_info);
    }
}

function updateColumnsDisplay(columns) {
    const container = document.getElementById('columnsContainer');
    container.innerHTML = '';
    
    columns.forEach(column => {
        const columnElement = document.createElement('div');
        columnElement.className = 'column-item';
        if (appState.selectedColumns.has(column.name)) {
            columnElement.classList.add('selected');
        }
        
        columnElement.innerHTML = `
            <div class="column-name">${escapeHtml(column.name)}</div>
            <div class="column-details">
                <span>Type: ${escapeHtml(column.type)}</span>
                <span>Missing: ${column.missing || 0}</span>
                <span>Unique: ${column.unique || 0}</span>
            </div>
        `;
        
        columnElement.addEventListener('click', () => {
            toggleColumnSelection(column.name);
            columnElement.classList.toggle('selected');
        });
        
        container.appendChild(columnElement);
    });
}

function toggleColumnSelection(columnName) {
    if (appState.selectedColumns.has(columnName)) {
        appState.selectedColumns.delete(columnName);
    } else {
        appState.selectedColumns.add(columnName);
    }
    saveAppState();
}

function updateColumnSelect(columns) {
    const select = document.getElementById('columnSelect');
    select.innerHTML = '<option value="">-- Choose a column --</option>';
    
    columns.forEach(column => {
        const option = document.createElement('option');
        option.value = column.name;
        option.textContent = `${column.name} (${column.type})`;
        select.appendChild(option);
    });
}

function onColumnSelected() {
    const select = document.getElementById('columnSelect');
    const columnName = select.value;
    
    if (!columnName) {
        document.getElementById('columnInfo').innerHTML = '';
        document.getElementById('preprocessingActions').innerHTML = '';
        return;
    }
    
    // Find column info
    const column = appState.datasetInfo?.column_info?.find(c => c.name === columnName);
    if (!column) return;
    
    // Update column info display
    updateColumnInfoDisplay(column);
    
    // Update preprocessing actions
    updatePreprocessingActions(column);
}

function updateColumnInfoDisplay(column) {
    const container = document.getElementById('columnInfo');
    
    const sampleValues = column.sample_values || [];
    const sampleText = sampleValues.length > 0 
        ? sampleValues.slice(0, 5).join(', ') + (sampleValues.length > 5 ? '...' : '')
        : 'No sample data';
    
    container.innerHTML = `
        <div class="column-info-card">
            <h4>${escapeHtml(column.name)}</h4>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Data Type:</span>
                    <span class="info-value">${escapeHtml(column.type)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Missing Values:</span>
                    <span class="info-value">${column.missing || 0} (${column.missing_percent || 0}%)</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Unique Values:</span>
                    <span class="info-value">${column.unique || 0}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Sample Values:</span>
                    <span class="info-value">${escapeHtml(sampleText)}</span>
                </div>
            </div>
        </div>
    `;
}

function updatePreprocessingActions(column) {
    const container = document.getElementById('preprocessingActions');
    const actions = [];
    
    // Determine available actions based on column type and characteristics
    if (column.missing > 0) {
        actions.push({
            id: 'fill_missing',
            icon: 'fas fa-fill-drip',
            label: 'Fill Missing Values',
            description: 'Fill NaN values with mean, median, mode, or custom value'
        });
    }
    
    if (column.type === 'object' && column.unique < 20) {
        actions.push({
            id: 'encode_categorical',
            icon: 'fas fa-code',
            label: 'Encode Categorical',
            description: 'Convert categories to numbers (label or one-hot encoding)'
        });
    }
    
    if (column.type.includes('int') || column.type.includes('float')) {
        actions.push({
            id: 'remove_outliers',
            icon: 'fas fa-filter',
            label: 'Remove Outliers',
            description: 'Remove outliers using IQR method'
        });
        
        actions.push({
            id: 'change_type',
            icon: 'fas fa-exchange-alt',
            label: 'Change Data Type',
            description: 'Convert to different numeric type'
        });
    }
    
    if (column.type === 'object') {
        actions.push({
            id: 'change_type_string',
            icon: 'fas fa-exchange-alt',
            label: 'Change to String',
            description: 'Convert to string type'
        });
    }
    
    // Always show drop column option
    actions.push({
        id: 'drop_column',
        icon: 'fas fa-trash',
        label: 'Drop Column',
        description: 'Remove this column from dataset',
        danger: true
    });
    
    // Generate HTML
    let html = '<div class="preprocessing-actions-grid">';
    actions.forEach(action => {
        html += `
            <button class="action-btn ${action.danger ? 'danger' : ''}" 
                    onclick="showActionModal('${action.id}', '${column.name}')">
                <i class="${action.icon}"></i>
                <div class="action-content">
                    <div class="action-label">${action.label}</div>
                    <div class="action-desc">${action.description}</div>
                </div>
            </button>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

// ==================== PREPROCESSING ACTIONS ====================
function showActionModal(action, column) {
    const modal = document.getElementById('actionModal');
    
    let modalContent = '';
    let modalTitle = '';
    let modalAction = '';
    
    switch (action) {
        case 'fill_missing':
            modalTitle = 'Fill Missing Values';
            modalAction = 'fill_missing';
            modalContent = `
                <h4>Select filling method for "${column}":</h4>
                <div class="method-options">
                    <button class="method-btn" onclick="addPreprocessingStep('fill_missing', '${column}', 'mean')">
                        <i class="fas fa-calculator"></i>
                        <span>Mean</span>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('fill_missing', '${column}', 'median')">
                        <i class="fas fa-chart-line"></i>
                        <span>Median</span>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('fill_missing', '${column}', 'mode')">
                        <i class="fas fa-chart-bar"></i>
                        <span>Mode</span>
                    </button>
                    <button class="method-btn" onclick="showCustomValueInput('${column}')">
                        <i class="fas fa-edit"></i>
                        <span>Custom Value</span>
                    </button>
                </div>
            `;
            break;
            
        case 'encode_categorical':
            modalTitle = 'Encode Categorical Column';
            modalAction = 'encode';
            modalContent = `
                <h4>Select encoding method for "${column}":</h4>
                <div class="method-options">
                    <button class="method-btn" onclick="addPreprocessingStep('encode', '${column}', 'label')">
                        <i class="fas fa-tag"></i>
                        <span>Label Encoding</span>
                        <small>Convert to numbers (0, 1, 2...)</small>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('encode', '${column}', 'onehot')">
                        <i class="fas fa-layer-group"></i>
                        <span>One-Hot Encoding</span>
                        <small>Create binary columns</small>
                    </button>
                </div>
            `;
            break;
            
        case 'remove_outliers':
            modalTitle = 'Remove Outliers';
            modalAction = 'remove_outliers';
            modalContent = `
                <h4>Remove outliers from "${column}" using IQR method</h4>
                <p>Values outside 1.5 × IQR will be removed</p>
                <button class="btn btn-primary" onclick="addPreprocessingStep('remove_outliers', '${column}', 'iqr')">
                    <i class="fas fa-check"></i> Apply Outlier Removal
                </button>
            `;
            break;
            
        case 'change_type':
        case 'change_type_string':
            modalTitle = 'Change Data Type';
            modalAction = 'change_type';
            modalContent = `
                <h4>Select new data type for "${column}":</h4>
                <div class="method-options">
                    <button class="method-btn" onclick="addPreprocessingStep('change_type', '${column}', 'numeric')">
                        <i class="fas fa-sort-numeric-up"></i>
                        <span>Numeric</span>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('change_type', '${column}', 'integer')">
                        <i class="fas fa-sort-numeric-down"></i>
                        <span>Integer</span>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('change_type', '${column}', 'float')">
                        <i class="fas fa-divide"></i>
                        <span>Float</span>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('change_type', '${column}', 'string')">
                        <i class="fas fa-font"></i>
                        <span>String</span>
                    </button>
                    <button class="method-btn" onclick="addPreprocessingStep('change_type', '${column}', 'category')">
                        <i class="fas fa-tags"></i>
                        <span>Category</span>
                    </button>
                </div>
            `;
            break;
            
        case 'drop_column':
            modalTitle = 'Drop Column';
            modalContent = `
                <h4>Are you sure you want to drop "${column}"?</h4>
                <p>This column will be permanently removed from the dataset.</p>
                <div class="modal-actions">
                    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-danger" onclick="addPreprocessingStep('drop_column', '${column}', '')">
                        <i class="fas fa-trash"></i> Drop Column
                    </button>
                </div>
            `;
            break;
    }
    
    modal.innerHTML = `
        <div class="modal-header">
            <h3><i class="fas fa-cog"></i> ${modalTitle}</h3>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            ${modalContent}
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function addPreprocessingStep(action, column, method, value = null) {
    const step = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        action: action,
        column: column,
        method: method,
        value: value,
        timestamp: new Date().toISOString()
    };
    
    // Remove any existing step for this column and action
    appState.preprocessingSteps = appState.preprocessingSteps.filter(
        s => !(s.column === column && s.action === action)
    );
    
    appState.preprocessingSteps.push(step);
    updateSelectedStepsUI();
    closeModal();
    showNotification('Preprocessing step added', 'success');
}

function updateSelectedStepsUI() {
    const container = document.getElementById('selectedSteps');
    
    if (appState.preprocessingSteps.length === 0) {
        container.innerHTML = '<p class="empty-message">No preprocessing steps selected yet</p>';
        return;
    }
    
    let html = '';
    appState.preprocessingSteps.forEach(step => {
        const stepDescription = getStepDescription(step);
        html += `
            <div class="step-item">
                <div class="step-content">
                    <div class="step-title">${step.column}</div>
                    <div class="step-details">${stepDescription}</div>
                </div>
                <div class="step-actions">
                    <button class="btn btn-small btn-outline" onclick="removeStep('${step.id}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    saveAppState();
}

function getStepDescription(step) {
    switch (step.action) {
        case 'fill_missing':
            return `Fill missing values with ${step.method}`;
        case 'encode':
            return `${step.method === 'label' ? 'Label' : 'One-Hot'} encoding`;
        case 'remove_outliers':
            return 'Remove outliers (IQR method)';
        case 'change_type':
            return `Convert to ${step.method}`;
        case 'drop_column':
            return 'Drop column from dataset';
        default:
            return `${step.action} - ${step.method}`;
    }
}

function removeStep(stepId) {
    appState.preprocessingSteps = appState.preprocessingSteps.filter(step => step.id !== stepId);
    updateSelectedStepsUI();
    showNotification('Step removed', 'info');
}

function clearSelectedSteps() {
    appState.preprocessingSteps = [];
    updateSelectedStepsUI();
    showNotification('All steps cleared', 'info');
}

// ==================== PROCESSING ====================
async function startPreprocessing() {
    if (!appState.datasetId) {
        showNotification('Please upload a dataset first', 'error');
        return;
    }
    
    if (appState.preprocessingSteps.length === 0) {
        if (!confirm('No preprocessing steps selected. Apply automatic preprocessing?')) {
            return;
        }
        applyAutoPreprocessing();
        return;
    }
    
    showLoading('Starting preprocessing...');
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/dataset/${appState.datasetId}/preprocess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                steps: appState.preprocessingSteps.map(step => ({
                    action: step.action,
                    column: step.column,
                    method: step.method,
                    value: step.value
                }))
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            appState.currentJobId = data.job_id;
            showProcessingProgress();
            pollJobStatus();
            showNotification('Preprocessing started successfully', 'success');
        } else {
            throw new Error(data.error || 'Failed to start preprocessing');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        hideLoading();
    }
}

function applyAutoPreprocessing() {
    if (!appState.datasetInfo?.column_info) return;
    
    // Clear existing steps
    appState.preprocessingSteps = [];
    
    // Add automatic steps based on column analysis
    appState.datasetInfo.column_info.forEach(column => {
        if (column.missing_percent > 50) {
            appState.preprocessingSteps.push({
                id: 'auto_' + column.name + '_drop',
                action: 'drop_column',
                column: column.name,
                method: 'auto',
                timestamp: new Date().toISOString()
            });
        } else if (column.missing > 0) {
            appState.preprocessingSteps.push({
                id: 'auto_' + column.name + '_fill',
                action: 'fill_missing',
                column: column.name,
                method: 'mean',
                timestamp: new Date().toISOString()
            });
        }
        
        if (column.type === 'object' && column.unique < 20) {
            appState.preprocessingSteps.push({
                id: 'auto_' + column.name + '_encode',
                action: 'encode',
                column: column.name,
                method: 'label',
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Add duplicate removal
    appState.preprocessingSteps.push({
        id: 'auto_remove_duplicates',
        action: 'remove_duplicates',
        column: 'all',
        method: 'auto',
        timestamp: new Date().toISOString()
    });
    
    updateSelectedStepsUI();
    showNotification('Automatic preprocessing configured', 'success');
}

function showProcessingProgress() {
    document.getElementById('processBtn').classList.add('hidden');
    document.getElementById('progressContainer').classList.remove('hidden');
}

function updateProcessingProgress(progress, status) {
    const progressFill = document.getElementById('progressFill');
    const progressPercent = document.getElementById('progressPercent');
    const progressText = document.getElementById('progressText');
    
    progressFill.style.width = `${progress}%`;
    progressPercent.textContent = `${progress}%`;
    progressText.textContent = status;
}

async function pollJobStatus() {
    if (!appState.currentJobId) return;
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/job/${appState.currentJobId}/status`);
        const data = await response.json();
        
        if (response.ok) {
            updateProcessingProgress(data.progress || 0, data.status || 'Processing...');
            
            if (data.status === 'completed' && data.result) {
                // Processing complete
                appState.processedFile = data.result.processed_file;
                appState.preprocessingReport = data.result.report;
                
                showNotification('Preprocessing completed!', 'success');
                
                // Hide progress, show success
                setTimeout(() => {
                    document.getElementById('processBtn').classList.remove('hidden');
                    document.getElementById('progressContainer').classList.add('hidden');
                    proceedToModelComparison();
                }, 1000);
                
            } else if (data.status === 'failed') {
                showNotification('Preprocessing failed: ' + (data.error || 'Unknown error'), 'error');
                document.getElementById('processBtn').classList.remove('hidden');
                document.getElementById('progressContainer').classList.add('hidden');
            } else {
                // Continue polling
                setTimeout(pollJobStatus, 1000);
            }
        } else {
            throw new Error('Failed to get job status');
        }
    } catch (error) {
        console.error('Error polling job status:', error);
        setTimeout(pollJobStatus, 2000);
    }
}

// ==================== MODEL COMPARISON ====================
function populateTargetColumnSelect() {
    if (!appState.datasetInfo?.column_info) return;
    
    const select = document.getElementById('targetColumnSelect');
    select.innerHTML = '<option value="">-- Select target column --</option>';
    
    appState.datasetInfo.column_info.forEach(column => {
        // Suggest columns with few unique values as potential targets
        const isPotentialTarget = column.unique > 1 && column.unique < 100;
        const option = document.createElement('option');
        option.value = column.name;
        option.textContent = `${column.name} (${column.type}, ${column.unique} unique)`;
        if (isPotentialTarget) {
            option.setAttribute('data-recommended', 'true');
        }
        select.appendChild(option);
    });
    
    // Update model info
    updateModelInfo();
}

function updateModelInfo() {
    const container = document.getElementById('modelInfo');
    container.innerHTML = `
        <div class="model-info-content">
            <h4><i class="fas fa-info-circle"></i> Models to be compared:</h4>
            <ul class="model-list">
                <li><strong>Linear Regression</strong> - For continuous values</li>
                <li><strong>Logistic Regression</strong> - For classification</li>
                <li><strong>Random Forest</strong> - Ensemble method</li>
                <li><strong>Decision Tree</strong> - Tree-based model</li>
                <li><strong>SVM</strong> - Support Vector Machine</li>
                <li><strong>K-Means</strong> - Clustering algorithm</li>
            </ul>
            <p class="note"><i class="fas fa-lightbulb"></i> 
                Models will be trained on both original and processed data to compare performance improvements.
            </p>
        </div>
    `;
}

async function startModelComparison() {
    const targetColumn = document.getElementById('targetColumnSelect').value;
    
    if (!targetColumn) {
        showNotification('Please select a target column', 'error');
        return;
    }
    
    if (!appState.processedFile) {
        showNotification('Please preprocess the dataset first', 'error');
        return;
    }
    
    showLoading('Starting model comparison...');
    
    // Show progress UI
    document.getElementById('compareBtn').classList.add('hidden');
    document.getElementById('comparisonProgress').classList.remove('hidden');
    updateModelStatusGrid('initializing');
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/dataset/${appState.datasetId}/compare`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                processed_file: appState.processedFile,
                target_column: targetColumn
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            appState.comparisonResults = data;
            showComparisonResults(data);
            showNotification('Model comparison completed!', 'success');
            
            // Track completion
            trackPageView('model_comparison', 'complete', {
                target_column: targetColumn,
                model_count: data.comparison?.length || 0
            });
            
        } else {
            throw new Error(data.error || 'Model comparison failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
        document.getElementById('compareBtn').classList.remove('hidden');
        document.getElementById('comparisonProgress').classList.add('hidden');
    } finally {
        hideLoading();
    }
}

function updateModelStatusGrid(status) {
    const models = [
        { name: 'Linear Regression', icon: 'fas fa-chart-line' },
        { name: 'Logistic Regression', icon: 'fas fa-sitemap' },
        { name: 'Random Forest', icon: 'fas fa-tree' },
        { name: 'Decision Tree', icon: 'fas fa-project-diagram' },
        { name: 'SVM', icon: 'fas fa-shapes' },
        { name: 'K-Means', icon: 'fas fa-object-group' }
    ];
    
    const container = document.getElementById('modelStatusGrid');
    let html = '';
    
    models.forEach((model, index) => {
        let statusText = 'Pending';
        let statusClass = 'pending';
        
        if (status === 'initializing') {
            statusText = 'Initializing...';
            statusClass = 'running';
        } else if (status === 'running') {
            // Simulate progress
            const progress = Math.min(100, Math.floor((index / models.length) * 100));
            statusText = `Running... ${progress}%`;
            statusClass = 'running';
        } else if (status === 'completed') {
            statusText = 'Completed';
            statusClass = 'completed';
        }
        
        html += `
            <div class="model-status-item ${statusClass}">
                <div class="model-icon">
                    <i class="${model.icon}"></i>
                </div>
                <div class="model-details">
                    <div class="model-name">${model.name}</div>
                    <div class="model-status">${statusText}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Update overall progress
    if (status === 'running') {
        const progressFill = document.getElementById('modelProgressFill');
        const progressPercent = document.getElementById('modelProgressPercent');
        const progress = 50; // Simulate 50% progress
        progressFill.style.width = `${progress}%`;
        progressPercent.textContent = `${progress}%`;
    } else if (status === 'completed') {
        const progressFill = document.getElementById('modelProgressFill');
        const progressPercent = document.getElementById('modelProgressPercent');
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
    }
}

function showComparisonResults(data) {
    // Hide progress, show results
    document.getElementById('comparisonProgress').classList.add('hidden');
    document.getElementById('comparisonResults').classList.remove('hidden');
    
    // Update result stats
    if (data.comparison && data.comparison.length > 0) {
        updateResultStats(data);
        updateComparisonTable(data.comparison);
        createPerformanceChart(data.comparison);
    }
    
    // Enable download step
    setTimeout(() => {
        proceedToDownload();
    }, 500);
}

function updateResultStats(data) {
    const comparisons = data.comparison || [];
    
    // Find best model
    let bestModel = null;
    let bestScore = -Infinity;
    
    comparisons.forEach(model => {
        if (model.status === 'success' && typeof model.processed === 'number') {
            if (model.processed > bestScore) {
                bestScore = model.processed;
                bestModel = model.model;
            }
        }
    });
    
    // Calculate average improvement
    let totalImprovement = 0;
    let count = 0;
    
    comparisons.forEach(model => {
        if (typeof model.improvement === 'number') {
            totalImprovement += model.improvement;
            count++;
        }
    });
    
    const avgImprovement = count > 0 ? (totalImprovement / count) * 100 : 0;
    
    // Update UI
    document.getElementById('bestModelName').textContent = bestModel || '-';
    document.getElementById('avgImprovement').textContent = avgImprovement > 0 
        ? `+${avgImprovement.toFixed(1)}%` 
        : `${avgImprovement.toFixed(1)}%`;
    document.getElementById('problemType').textContent = data.problem_type || '-';
    
    // Update report section
    document.getElementById('reportBestModel').textContent = bestModel || '-';
    document.getElementById('reportImprovement').textContent = avgImprovement > 0 
        ? `+${avgImprovement.toFixed(1)}% improvement` 
        : 'No improvement';
}

function updateComparisonTable(comparisons) {
    const tbody = document.querySelector('#comparisonTable tbody');
    tbody.innerHTML = '';
    
    comparisons.forEach(model => {
        const row = document.createElement('tr');
        
        let improvementClass = '';
        let improvementText = '';
        
        if (typeof model.improvement === 'number') {
            improvementClass = model.improvement > 0 ? 'improvement-positive' : 'improvement-negative';
            improvementText = model.improvement > 0 ? `+${model.improvement.toFixed(4)}` : model.improvement.toFixed(4);
        } else {
            improvementText = model.improvement || 'N/A';
        }
        
        row.innerHTML = `
            <td>${escapeHtml(model.model)}</td>
            <td>${typeof model.original === 'number' ? model.original.toFixed(4) : escapeHtml(String(model.original))}</td>
            <td>${typeof model.processed === 'number' ? model.processed.toFixed(4) : escapeHtml(String(model.processed))}</td>
            <td class="${improvementClass}">${improvementText}</td>
            <td>${escapeHtml(model.metric || 'N/A')}</td>
        `;
        
        tbody.appendChild(row);
    });
}

function createPerformanceChart(comparisons) {
    const successfulModels = comparisons.filter(m => 
        typeof m.original === 'number' && typeof m.processed === 'number'
    );
    
    if (successfulModels.length === 0) return;
    
    const ctx = document.createElement('canvas');
    ctx.width = 800;
    ctx.height = 400;
    
    const container = document.getElementById('chartPlaceholder');
    container.innerHTML = '';
    container.appendChild(ctx);
    
    const modelNames = successfulModels.map(m => m.model);
    const originalScores = successfulModels.map(m => m.original);
    const processedScores = successfulModels.map(m => m.processed);
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: modelNames,
            datasets: [
                {
                    label: 'Original Data',
                    data: originalScores,
                    backgroundColor: 'rgba(74, 111, 165, 0.7)',
                    borderColor: 'rgba(74, 111, 165, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Processed Data',
                    data: processedScores,
                    backgroundColor: 'rgba(40, 167, 69, 0.7)',
                    borderColor: 'rgba(40, 167, 69, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Model Performance Comparison'
                },
                legend: {
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Score'
                    }
                }
            }
        }
    });
}

// ==================== DOWNLOAD FUNCTIONS ====================
function updateDownloadSummary() {
    if (appState.preprocessingReport) {
        document.getElementById('reportSteps').textContent = 
            appState.preprocessingReport.steps_applied?.length || 0;
        document.getElementById('reportDuplicates').textContent = 
            appState.preprocessingReport.duplicates_removed || 0;
    }
    
    if (appState.datasetInfo) {
        document.getElementById('processedDimensions').textContent = 
            `${appState.datasetInfo.rows} × ${appState.datasetInfo.columns}`;
    }
}

async function downloadProcessedData() {
    if (!appState.processedFile) {
        showNotification('No processed file available', 'error');
        return;
    }
    
    showLoading('Downloading processed data...');
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/download/${appState.processedFile}`);
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `processed_${appState.datasetInfo?.filename || 'dataset'}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showNotification('Download started!', 'success');
            
            // Track download
            trackPageView('download', 'processed_data', {
                filename: appState.processedFile,
                dataset_id: appState.datasetId
            });
            
        } else {
            throw new Error('Download failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function downloadComparisonReport() {
    if (!appState.comparisonResults) {
        showNotification('No comparison results available', 'error');
        return;
    }
    
    showLoading('Generating comparison report...');
    
    try {
        // Create PDF report (simplified - in production, generate actual PDF)
        const reportData = {
            title: 'Model Comparison Report',
            dataset: appState.datasetInfo?.filename || 'Unknown',
            timestamp: new Date().toISOString(),
            results: appState.comparisonResults,
            preprocessing: appState.preprocessingReport
        };
        
        // For now, download as JSON
        const dataStr = JSON.stringify(reportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = window.URL.createObjectURL(dataBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comparison_report_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showNotification('Report downloaded!', 'success');
        
    } catch (error) {
        showNotification('Failed to generate report: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function downloadPreprocessingReport() {
    if (!appState.preprocessingReport) {
        showNotification('No preprocessing report available', 'error');
        return;
    }
    
    showLoading('Generating preprocessing report...');
    
    try {
        // Create HTML report
        let reportHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Preprocessing Report - ${appState.datasetInfo?.filename || 'Dataset'}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    h1 { color: #4a6fa5; }
                    .section { margin: 30px 0; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                </style>
            </head>
            <body>
                <h1>Preprocessing Report</h1>
                <div class="section">
                    <h2>Dataset Information</h2>
                    <p><strong>Filename:</strong> ${escapeHtml(appState.datasetInfo?.filename || 'N/A')}</p>
                    <p><strong>Original Size:</strong> ${appState.preprocessingReport.original_shape?.join(' × ') || 'N/A'}</p>
                    <p><strong>Processed Size:</strong> ${appState.preprocessingReport.processed_shape?.join(' × ') || 'N/A'}</p>
                </div>
        `;
        
        if (appState.preprocessingReport.steps_applied?.length > 0) {
            reportHTML += `
                <div class="section">
                    <h2>Preprocessing Steps Applied</h2>
                    <table>
                        <tr><th>Step</th><th>Details</th></tr>
            `;
            
            appState.preprocessingReport.steps_applied.forEach(step => {
                reportHTML += `<tr><td>${escapeHtml(step.step || 'N/A')}</td><td>${escapeHtml(step.details || '')}</td></tr>`;
            });
            
            reportHTML += `</table></div>`;
        }
        
        reportHTML += `
                <div class="section">
                    <p><em>Report generated on ${new Date().toLocaleString()}</em></p>
                </div>
            </body>
            </html>
        `;
        
        // Download HTML file
        const blob = new Blob([reportHTML], { type: 'text/html' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `preprocessing_report_${new Date().toISOString().split('T')[0]}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showNotification('Preprocessing report downloaded!', 'success');
        
    } catch (error) {
        showNotification('Failed to generate report: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function downloadCompleteAnalysis() {
    showLoading('Preparing complete analysis package...');
    
    try {
        // Create ZIP file with all data
        const allData = {
            metadata: {
                generated: new Date().toISOString(),
                session_id: appState.sessionId,
                dataset_id: appState.datasetId
            },
            dataset_info: appState.datasetInfo,
            preprocessing_steps: appState.preprocessingSteps,
            preprocessing_report: appState.preprocessingReport,
            comparison_results: appState.comparisonResults
        };
        
        // Download as JSON
        const dataStr = JSON.stringify(allData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `complete_analysis_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showNotification('Complete analysis downloaded!', 'success');
        
    } catch (error) {
        showNotification('Failed to create analysis package: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== UTILITY FUNCTIONS ====================
function showHelp() {
    document.getElementById('helpModal').classList.remove('hidden');
    trackPageView('help', 'open');
}

function closeHelp() {
    document.getElementById('helpModal').classList.add('hidden');
}

function closeModal() {
    document.getElementById('actionModal').classList.add('hidden');
}

function showLoading(message = 'Processing...', details = '') {
    document.getElementById('loadingMessage').textContent = message;
    document.getElementById('loadingDetails').textContent = details;
    document.getElementById('loadingModal').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingModal').classList.add('hidden');
}

function showNotification(message, type = 'info', duration = 5000) {
    const container = document.getElementById('notificationContainer');
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };
    
    notification.innerHTML = `
        <div class="notification-icon">
            <i class="${icons[type] || icons.info}"></i>
        </div>
        <div class="notification-content">
            <div class="notification-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
    `;
    
    container.appendChild(notification);
    
    // Auto-remove after duration
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, duration);
    
    // Track notification
    if (type === 'error') {
        trackPageView('notification', 'error', { message: message.substring(0, 100) });
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function resetApplication() {
    if (confirm('Are you sure you want to start over? All current progress will be lost.')) {
        // Clear app state
        appState = {
            currentStep: 1,
            sessionId: appState.sessionId, // Keep session ID
            datasetId: null,
            datasetInfo: null,
            selectedColumns: new Set(),
            preprocessingSteps: [],
            currentJobId: null,
            processedFile: null,
            comparisonResults: null,
            analyticsData: {
                pageViews: appState.analyticsData.pageViews,
                sessionStart: appState.analyticsData.sessionStart,
                lastActivity: Date.now()
            }
        };
        
        // Clear UI
        clearUpload();
        clearSelectedSteps();
        
        // Reset to first step
        showStep(1);
        
        // Clear any saved state
        localStorage.removeItem('appState');
        
        showNotification('Application reset. Ready for new dataset!', 'info');
        trackPageView('reset', 'application');
    }
}

function shareResults() {
    const shareData = {
        title: 'DataPrePro Analysis Results',
        text: `Check out my data analysis results from DataPrePro AI!`,
        url: window.location.href
    };
    
    if (navigator.share) {
        navigator.share(shareData)
            .then(() => showNotification('Results shared successfully!', 'success'))
            .catch(() => showNotification('Sharing cancelled', 'info'));
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(shareData.url)
            .then(() => showNotification('Link copied to clipboard!', 'success'))
            .catch(() => showNotification('Failed to copy link', 'error'));
    }
}

function showPrivacyPolicy() {
    alert('Privacy Policy:\n\n' +
          '1. We collect anonymous usage statistics to improve the service\n' +
          '2. Your uploaded data is processed temporarily and not stored permanently\n' +
          '3. No personal information is collected without your consent\n' +
          '4. You can opt-out of analytics tracking at any time\n\n' +
          'For more details, contact: privacy@dataprepro.ai');
}

function loadSampleDataset(type) {
    const samples = {
        titanic: {
            url: 'https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv',
            name: 'titanic.csv',
            description: 'Titanic passenger survival dataset'
        },
        iris: {
            url: 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv',
            name: 'iris.csv',
            description: 'Iris flower dataset'
        },
        housing: {
            url: 'https://raw.githubusercontent.com/ageron/handson-ml/master/datasets/housing/housing.csv',
            name: 'housing.csv',
            description: 'California housing dataset'
        }
    };
    
    const sample = samples[type];
    if (!sample) return;
    
    showLoading(`Loading ${sample.description}...`);
    
    // Simulate file upload with sample data
    fetch(sample.url)
        .then(response => response.blob())
        .then(blob => {
            const file = new File([blob], sample.name, { type: 'text/csv' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            document.getElementById('fileInput').files = dataTransfer.files;
            handleFileUpload();
        })
        .catch(error => {
            showNotification('Failed to load sample dataset: ' + error.message, 'error');
            hideLoading();
        });
}

function initializeCharts() {
    // Initialize any global charts if needed
}

// ==================== EXPORT FUNCTIONS FOR HTML ====================
window.proceedToPreprocessing = proceedToPreprocessing;
window.proceedToModelComparison = proceedToModelComparison;
window.clearUpload = clearUpload;
window.showHelp = showHelp;
window.closeHelp = closeHelp;
window.loadSampleDataset = loadSampleDataset;
window.onColumnSelected = onColumnSelected;
window.showActionModal = showActionModal;
window.addPreprocessingStep = addPreprocessingStep;
window.removeStep = removeStep;
window.clearSelectedSteps = clearSelectedSteps;
window.startPreprocessing = startPreprocessing;
window.applyAutoPreprocessing = applyAutoPreprocessing;
window.startModelComparison = startModelComparison;
window.downloadProcessedData = downloadProcessedData;
window.downloadComparisonReport = downloadComparisonReport;
window.downloadPreprocessingReport = downloadPreprocessingReport;
window.downloadCompleteAnalysis = downloadCompleteAnalysis;
window.resetApplication = resetApplication;
window.shareResults = shareResults;
window.showPrivacyPolicy = showPrivacyPolicy;