// Global variables
let currentDatasetId = null;
let currentProcessedFile = null;
let datasetInfo = null;
let selectedSteps = [];
let backendUrl = 'http://localhost:5000'; // Change this for production

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileStats = document.getElementById('fileStats');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkForExistingDataset();
});

// Enhanced with basic tracking
let sessionId = localStorage.getItem('session_id');
if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('session_id', sessionId);
}

// Track page views
function trackPageView(page, action = null) {
    // Send to backend
    fetch(`${backendUrl}/api/track`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            session_id: sessionId,
            page: page,
            action: action,
            timestamp: new Date().toISOString()
        })
    }).catch(() => {
        // Silently fail if tracking fails
    });
    
    // Also track in localStorage for offline persistence
    const trackingHistory = JSON.parse(localStorage.getItem('tracking_history') || '[]');
    trackingHistory.push({
        page,
        action,
        timestamp: new Date().toISOString()
    });
    localStorage.setItem('tracking_history', JSON.stringify(trackingHistory.slice(-100))); // Keep last 100
}

// Track specific actions
function trackAction(action, details = {}) {
    const currentPage = document.querySelector('.card.active h2')?.textContent || 'unknown';
    trackPageView(currentPage, action);
    
    // Send detailed tracking
    fetch(`${backendUrl}/api/track/action`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            session_id: sessionId,
            action: action,
            details: details,
            timestamp: new Date().toISOString()
        })
    }).catch(() => {
        // Silently fail
    });
}

// Initialize tracking
document.addEventListener('DOMContentLoaded', () => {
    // Track initial page view
    trackPageView('homepage', 'load');
    
    // Track navigation
    const originalProceedToPreprocessing = window.proceedToPreprocessing;
    window.proceedToPreprocessing = function() {
        trackAction('navigate', { from: 'upload', to: 'preprocessing' });
        return originalProceedToPreprocessing();
    };
    
    const originalProceedToModelComparison = window.proceedToModelComparison;
    window.proceedToModelComparison = function() {
        trackAction('navigate', { from: 'preprocessing', to: 'model_comparison' });
        return originalProceedToModelComparison();
    };
    
    // Track file upload
    const originalHandleFileUpload = window.handleFileUpload;
    window.handleFileUpload = async function() {
        trackAction('file_upload_start');
        const result = await originalHandleFileUpload();
        trackAction('file_upload_complete', {
            success: !result?.error,
            filename: document.getElementById('fileName')?.textContent
        });
        return result;
    };
    
    // Track preprocessing
    const originalApplyPreprocessing = window.applyPreprocessing;
    window.applyPreprocessing = async function() {
        trackAction('preprocessing_start', {
            steps_count: selectedSteps.length,
            steps: selectedSteps
        });
        return originalApplyPreprocessing();
    };
    
    // Track model comparison
    const originalStartModelComparison = window.startModelComparison;
    window.startModelComparison = async function() {
        trackAction('model_comparison_start', {
            target_column: document.getElementById('targetColumnSelect').value
        });
        return originalStartModelComparison();
    };
    
    // Track downloads
    const originalDownloadProcessed = window.downloadProcessed;
    window.downloadProcessed = async function() {
        trackAction('download_processed');
        return originalDownloadProcessed();
    };
    
    const originalDownloadResults = window.downloadResults;
    window.downloadResults = function() {
        trackAction('download_results');
        return originalDownloadResults();
    };
});

// Add to existing showNotification function to track errors
const originalShowNotification = window.showNotification;
window.showNotification = function(message, type = 'info') {
    if (type === 'error') {
        trackAction('error', { message: message });
    }
    return originalShowNotification(message, type);
};


// Event Listeners
function setupEventListeners() {
    // File upload
    fileInput.addEventListener('change', handleFileUpload);
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#4a6fa5';
        uploadArea.style.background = '#eef2ff';
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
}

// Add this to track basic usage
function trackUsage(action, details = {}) {
    fetch('/api/track', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            session_id: localStorage.getItem('session_id') || 'unknown',
            page: window.location.pathname,
            action: action,
            details: details
        })
    }).catch(() => {}); // Silent fail
}

// Track important events
trackUsage('page_load');
// Add more trackUsage() calls for uploads, preprocessing, etc.

// File Upload Handler
async function handleFileUpload() {
    const file = fileInput.files[0];
    if (!file) return;
    
    showLoading('Uploading dataset...');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${backendUrl}/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentDatasetId = data.dataset_id;
            datasetInfo = data;
            
            // Display file info
            fileName.textContent = data.filename;
            fileStats.textContent = `${data.rows} rows × ${data.columns} columns`;
            fileInfo.classList.remove('hidden');
            
            showNotification('Dataset uploaded successfully!', 'success');
        } else {
            showNotification(data.error || 'Upload failed', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Proceed to Preprocessing
async function proceedToPreprocessing() {
    if (!currentDatasetId) {
        showNotification('Please upload a dataset first', 'error');
        return;
    }
    
    showLoading('Loading dataset information...');
    
    try {
        const response = await fetch(`${backendUrl}/dataset/${currentDatasetId}/info`);
        const data = await response.json();
        
        if (response.ok) {
            datasetInfo = data;
            displayDatasetOverview(data);
            populateColumnSelect(data.column_info);
            
            // Switch to preprocessing section
            document.getElementById('upload-section').classList.remove('active');
            document.getElementById('preprocessing-section').classList.add('active');
            
            showNotification('Dataset loaded successfully!', 'success');
        } else {
            showNotification(data.error || 'Failed to load dataset', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Display Dataset Overview
function displayDatasetOverview(data) {
    const overviewDiv = document.getElementById('datasetOverview');
    
    overviewDiv.innerHTML = `
        <div class="overview-stats">
            <div class="stat">
                <i class="fas fa-table"></i>
                <span>${data.shape[0]} rows</span>
            </div>
            <div class="stat">
                <i class="fas fa-columns"></i>
                <span>${data.shape[1]} columns</span>
            </div>
            <div class="stat">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${data.missing_summary.total_missing} missing values</span>
            </div>
        </div>
        <div class="columns-preview">
            <h4>Columns:</h4>
            <div class="columns-list">
                ${data.column_info.map(col => `
                    <span class="column-tag ${col.missing > 0 ? 'has-missing' : ''}">
                        ${col.name} <small>(${col.type})</small>
                    </span>
                `).join('')}
            </div>
        </div>
    `;
}

// Populate Column Select Dropdown
function populateColumnSelect(columnInfo) {
    const select = document.getElementById('columnSelect');
    select.innerHTML = '<option value="">-- Select a column --</option>';
    
    columnInfo.forEach(col => {
        const option = document.createElement('option');
        option.value = col.name;
        option.textContent = `${col.name} (${col.type})`;
        select.appendChild(option);
    });
}

// Update Available Actions Based on Selected Column
function updateColumnActions() {
    const columnSelect = document.getElementById('columnSelect');
    const selectedColumn = columnSelect.value;
    
    if (!selectedColumn) {
        document.getElementById('actionButtons').innerHTML = '';
        return;
    }
    
    const columnInfo = datasetInfo.column_info.find(col => col.name === selectedColumn);
    
    const actions = [
        {
            id: 'fill_missing',
            icon: 'fas fa-fill-drip',
            label: 'Fill Missing Values',
            available: columnInfo.missing > 0,
            subActions: ['mean', 'median', 'mode', 'zero']
        },
        {
            id: 'change_type',
            icon: 'fas fa-exchange-alt',
            label: 'Change Data Type',
            available: true,
            subActions: ['numeric', 'string', 'datetime']
        },
        {
            id: 'encode',
            icon: 'fas fa-code',
            label: 'Encode Categorical',
            available: columnInfo.type === 'object' && columnInfo.unique < 20,
            subActions: ['label', 'onehot']
        },
        {
            id: 'remove_outliers',
            icon: 'fas fa-filter',
            label: 'Remove Outliers',
            available: columnInfo.type.includes('int') || columnInfo.type.includes('float')
        }
    ];
    
    const actionButtons = document.getElementById('actionButtons');
    actionButtons.innerHTML = '';
    
    actions.forEach(action => {
        if (action.available) {
            const button = document.createElement('button');
            button.className = 'action-btn';
            button.innerHTML = `
                <i class="${action.icon}"></i>
                <span>${action.label}</span>
            `;
            
            if (action.subActions) {
                button.addEventListener('click', () => showSubActions(action, selectedColumn));
            } else {
                button.addEventListener('click', () => addPreprocessingStep({
                    action: action.id,
                    column: selectedColumn,
                    method: 'auto'
                }));
            }
            
            actionButtons.appendChild(button);
        }
    });
}

// Show Sub-Actions Modal
function showSubActions(action, column) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>${action.label}</h3>
            <p>Select method for column: <strong>${column}</strong></p>
            <div class="sub-action-buttons">
                ${action.subActions.map(method => `
                    <button class="btn" onclick="addPreprocessingStep({
                        action: '${action.id}',
                        column: '${column}',
                        method: '${method}'
                    }); this.closest('.modal').remove()">
                        ${method.charAt(0).toUpperCase() + method.slice(1)}
                    </button>
                `).join('')}
            </div>
            <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">
                Cancel
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Add Preprocessing Step
function addPreprocessingStep(step) {
    // Check if step already exists for this column
    const existingIndex = selectedSteps.findIndex(s => 
        s.column === step.column && s.action === step.action
    );
    
    if (existingIndex > -1) {
        selectedSteps[existingIndex] = step;
    } else {
        selectedSteps.push(step);
    }
    
    updateSelectedStepsList();
    showNotification('Preprocessing step added', 'success');
}

// Update Selected Steps List
function updateSelectedStepsList() {
    const listDiv = document.getElementById('selectedStepsList');
    
    if (selectedSteps.length === 0) {
        listDiv.innerHTML = '<p class="empty-message">No steps selected yet</p>';
        return;
    }
    
    listDiv.innerHTML = selectedSteps.map((step, index) => `
        <div class="step-item">
            <div>
                <strong>${step.column}</strong>
                <small>${step.action.replace('_', ' ')} (${step.method})</small>
            </div>
            <button onclick="removeStep(${index})">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Remove Step
function removeStep(index) {
    selectedSteps.splice(index, 1);
    updateSelectedStepsList();
}

// Apply Preprocessing
async function applyPreprocessing() {
    if (!currentDatasetId) {
        showNotification('Please upload a dataset first', 'error');
        return;
    }
    
    showLoading('Starting preprocessing...');
    
    try {
        const response = await fetch(`${backendUrl}/dataset/${currentDatasetId}/preprocess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                steps: selectedSteps
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Start polling for progress
            pollJobStatus(data.job_id);
        } else {
            throw new Error(data.error || 'Preprocessing failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
        hideLoading();
    }
}

// Auto Preprocess
async function autoPreprocess() {
    if (!currentDatasetId) {
        showNotification('Please upload a dataset first', 'error');
        return;
    }
    
    showLoading('Starting automatic preprocessing...');
    
    try {
        const response = await fetch(`${backendUrl}/dataset/${currentDatasetId}/preprocess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                steps: [] // Empty steps triggers auto preprocessing
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            pollJobStatus(data.job_id);
        } else {
            throw new Error(data.error || 'Auto preprocessing failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
        hideLoading();
    }
}

// Poll Job Status
async function pollJobStatus(jobId) {
    const progressDiv = document.getElementById('processingProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    progressDiv.classList.remove('hidden');
    
    const poll = async () => {
        try {
            const response = await fetch(`${backendUrl}/job/${jobId}/status`);
            const data = await response.json();
            
            if (response.ok) {
                progressFill.style.width = `${data.progress}%`;
                progressText.textContent = `Processing... ${data.progress}%`;
                
                if (data.status === 'completed') {
                    currentProcessedFile = data.result.processed_file;
                    displayPreprocessingResults(data.result.report);
                    progressDiv.classList.add('hidden');
                    showNotification('Preprocessing completed successfully!', 'success');
                } else if (data.status === 'error') {
                    throw new Error(data.error || 'Processing failed');
                } else {
                    setTimeout(poll, 1000);
                }
            } else {
                throw new Error('Failed to get job status');
            }
        } catch (error) {
            showNotification(error.message, 'error');
            progressDiv.classList.add('hidden');
            hideLoading();
        }
    };
    
    poll();
}

// Display Preprocessing Results
function displayPreprocessingResults(report) {
    const resultsDiv = document.getElementById('preprocessingResults');
    const reportDiv = document.getElementById('preprocessingReport');
    
    reportDiv.innerHTML = `
        <div class="report-summary">
            <div class="report-stat">
                <i class="fas fa-columns"></i>
                <div>
                    <h4>Columns</h4>
                    <p>${report.original_shape[1]} → ${report.processed_shape[1]}</p>
                </div>
            </div>
            <div class="report-stat">
                <i class="fas fa-stream"></i>
                <div>
                    <h4>Rows</h4>
                    <p>${report.original_shape[0]} → ${report.processed_shape[0]}</p>
                </div>
            </div>
            <div class="report-stat">
                <i class="fas fa-trash-alt"></i>
                <div>
                    <h4>Duplicates Removed</h4>
                    <p>${report.duplicates_removed}</p>
                </div>
            </div>
        </div>
        
        <div class="report-steps">
            <h4>Applied Steps:</h4>
            <div class="steps-list">
                ${report.steps.map(step => `
                    <div class="step">
                        <i class="fas fa-check-circle"></i>
                        <span>${step.details}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    resultsDiv.classList.remove('hidden');
    hideLoading();
}

// Proceed to Model Comparison
function proceedToModelComparison() {
    if (!currentProcessedFile) {
        showNotification('Please process the dataset first', 'error');
        return;
    }
    
    // Populate target column select
    const targetSelect = document.getElementById('targetColumnSelect');
    targetSelect.innerHTML = '<option value="">-- Select target column --</option>';
    
    datasetInfo.column_info.forEach(col => {
        const option = document.createElement('option');
        option.value = col.name;
        option.textContent = col.name;
        targetSelect.appendChild(option);
    });
    
    // Switch to model section
    document.getElementById('preprocessing-section').classList.remove('active');
    document.getElementById('model-section').classList.add('active');
}

// Start Model Comparison
async function startModelComparison() {
    const targetColumn = document.getElementById('targetColumnSelect').value;
    
    if (!targetColumn) {
        showNotification('Please select a target column', 'error');
        return;
    }
    
    showLoading('Starting model comparison...');
    
    // Show progress bar
    const progressDiv = document.getElementById('comparisonProgress');
    const progressFill = document.getElementById('modelProgressFill');
    const modelStatus = document.getElementById('modelStatus');
    
    progressDiv.classList.remove('hidden');
    progressFill.style.width = '0%';
    
    // Update progress with model names
    const models = [
        'Linear Regression',
        'Logistic Regression', 
        'Random Forest',
        'Decision Tree',
        'SVM',
        'K-Means'
    ];
    
    let currentModel = 0;
    
    const progressInterval = setInterval(() => {
        currentModel++;
        const progress = Math.min((currentModel / models.length) * 100, 100);
        progressFill.style.width = `${progress}%`;
        
        if (currentModel <= models.length) {
            modelStatus.innerHTML = `
                <div class="model-running">
                    <i class="fas fa-cog fa-spin"></i>
                    Running ${models[currentModel - 1]}...
                </div>
            `;
        }
    }, 500);
    
    try {
        const response = await fetch(`${backendUrl}/dataset/${currentDatasetId}/compare`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                processed_file: currentProcessedFile,
                target_column: targetColumn
            })
        });
        
        clearInterval(progressInterval);
        progressFill.style.width = '100%';
        
        const data = await response.json();
        
        if (response.ok) {
            displayComparisonResults(data);
            progressDiv.classList.add('hidden');
            showNotification('Model comparison completed!', 'success');
        } else {
            throw new Error(data.error || 'Model comparison failed');
        }
    } catch (error) {
        clearInterval(progressInterval);
        showNotification(error.message, 'error');
        progressDiv.classList.add('hidden');
    } finally {
        hideLoading();
    }
}

// Display Comparison Results
function displayComparisonResults(data) {
    const resultsDiv = document.getElementById('comparisonResults');
    const tableBody = document.querySelector('#resultsTable tbody');
    const summaryDiv = document.getElementById('summaryStats');
    
    // Clear table
    tableBody.innerHTML = '';
    
    // Add rows
    data.comparison.forEach(model => {
        const row = document.createElement('tr');
        
        const improvementClass = typeof model.improvement === 'number' 
            ? (model.improvement > 0 ? 'improvement-positive' : 'improvement-negative')
            : '';
        
        row.innerHTML = `
            <td>${model.model}</td>
            <td>${model.original}</td>
            <td>${model.processed}</td>
            <td class="${improvementClass}">
                ${typeof model.improvement === 'number' 
                    ? (model.improvement > 0 ? '+' : '') + model.improvement 
                    : model.improvement}
            </td>
            <td>${model.metric}</td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Calculate summary
    const numericComparisons = data.comparison.filter(m => 
        typeof m.original === 'number' && typeof m.processed === 'number'
    );
    
    if (numericComparisons.length > 0) {
        const avgImprovement = numericComparisons.reduce((sum, m) => sum + m.improvement, 0) / numericComparisons.length;
        const maxImprovement = Math.max(...numericComparisons.map(m => m.improvement));
        const bestModel = numericComparisons.find(m => m.improvement === maxImprovement);
        
        summaryDiv.innerHTML = `
            <div class="summary-stats">
                <div class="summary-stat">
                    <i class="fas fa-chart-line"></i>
                    <div>
                        <h5>Average Improvement</h5>
                        <p class="${avgImprovement > 0 ? 'positive' : 'negative'}">
                            ${avgImprovement > 0 ? '+' : ''}${avgImprovement.toFixed(4)}
                        </p>
                    </div>
                </div>
                <div class="summary-stat">
                    <i class="fas fa-trophy"></i>
                    <div>
                        <h5>Best Model</h5>
                        <p>${bestModel.model} (+${bestModel.improvement.toFixed(4)})</p>
                    </div>
                </div>
                <div class="summary-stat">
                    <i class="fas fa-project-diagram"></i>
                    <div>
                        <h5>Problem Type</h5>
                        <p>${data.problem_type}</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    resultsDiv.classList.remove('hidden');
}

// Download Processed Data
async function downloadProcessed() {
    if (!currentProcessedFile) {
        showNotification('No processed file available', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${backendUrl}/download/${currentProcessedFile}`);
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `processed_${datasetInfo.filename}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showNotification('Download started!', 'success');
        } else {
            throw new Error('Download failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Download Results
function downloadResults() {
    const table = document.getElementById('resultsTable');
    let csv = [];
    
    // Get headers
    const headers = [];
    table.querySelectorAll('th').forEach(th => headers.push(th.textContent));
    csv.push(headers.join(','));
    
    // Get rows
    table.querySelectorAll('tbody tr').forEach(row => {
        const rowData = [];
        row.querySelectorAll('td').forEach(td => {
            rowData.push(td.textContent);
        });
        csv.push(rowData.join(','));
    });
    
    // Create and download file
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model_comparison_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showNotification('Results exported!', 'success');
}

// Reset Application
function resetApplication() {
    currentDatasetId = null;
    currentProcessedFile = null;
    datasetInfo = null;
    selectedSteps = [];
    
    // Reset UI
    fileInfo.classList.add('hidden');
    document.getElementById('preprocessingResults').classList.add('hidden');
    document.getElementById('comparisonResults').classList.add('hidden');
    document.getElementById('model-section').classList.remove('active');
    document.getElementById('upload-section').classList.add('active');
    
    // Clear inputs
    fileInput.value = '';
    document.getElementById('columnSelect').innerHTML = '<option value="">-- Select a column --</option>';
    document.getElementById('selectedStepsList').innerHTML = '<p class="empty-message">No steps selected yet</p>';
    document.getElementById('targetColumnSelect').innerHTML = '<option value="">-- Select target column --</option>';
    
    showNotification('Application reset. Ready for new dataset!', 'success');
}

// Helper Functions
function showLoading(message = 'Processing...') {
    const modal = document.getElementById('loadingModal');
    const loadingText = document.getElementById('loadingText');
    
    loadingText.textContent = message;
    modal.classList.remove('hidden');
}

function hideLoading() {
    const modal = document.getElementById('loadingModal');
    modal.classList.add('hidden');
}

function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(n => n.remove());
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Add CSS for notification
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: var(--border-radius);
                background: white;
                box-shadow: var(--box-shadow);
                display: flex;
                align-items: center;
                gap: 10px;
                z-index: 1001;
                animation: slideInRight 0.3s ease;
            }
            
            .notification.success {
                border-left: 4px solid var(--success-color);
            }
            
            .notification.error {
                border-left: 4px solid var(--danger-color);
            }
            
            .notification.info {
                border-left: 4px solid var(--primary-color);
            }
            
            .notification i {
                font-size: 1.2rem;
            }
            
            .notification.success i {
                color: var(--success-color);
            }
            
            .notification.error i {
                color: var(--danger-color);
            }
            
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Auto-remove notification
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Check for existing dataset on page load
function checkForExistingDataset() {
    const savedDatasetId = localStorage.getItem('currentDatasetId');
    if (savedDatasetId) {
        // Optionally load saved dataset
        // currentDatasetId = savedDatasetId;
    }
}

// Save current state
function saveState() {
    if (currentDatasetId) {
        localStorage.setItem('currentDatasetId', currentDatasetId);
    }
}

// Update backend URL for production
function updateBackendUrl(url) {
    backendUrl = url;
}