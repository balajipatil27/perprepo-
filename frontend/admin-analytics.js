// ==================== CONFIGURATION ====================
const ADMIN_CONFIG = {
    BACKEND_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:5000' 
        : 'https://dataprepo-backend.onrender.com', // CHANGE THIS FOR DEPLOYMENT
    ADMIN_TOKEN: localStorage.getItem('admin_token') || 'admin123',
    REFRESH_INTERVAL: 30000, // 30 seconds
    CHARTS: {}
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    // Check if already authenticated
    const savedToken = localStorage.getItem('admin_token');
    if (savedToken) {
        ADMIN_CONFIG.ADMIN_TOKEN = savedToken;
        authenticateAdmin();
    }
    
    // Setup event listeners
    setupAdminEventListeners();
});

function setupAdminEventListeners() {
    // Enter key for auth
    document.getElementById('adminToken')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') authenticateAdmin();
    });
}

// ==================== AUTHENTICATION ====================
async function authenticateAdmin() {
    const tokenInput = document.getElementById('adminToken');
    const token = tokenInput ? tokenInput.value.trim() : ADMIN_CONFIG.ADMIN_TOKEN;
    
    if (!token) {
        showNotification('Please enter admin token', 'error');
        return;
    }
    
    showLoading('Authenticating...');
    
    try {
        const response = await fetch(`${ADMIN_CONFIG.BACKEND_URL}/api/analytics/dashboard`, {
            headers: {
                'X-Admin-Token': token
            }
        });
        
        if (response.ok) {
            // Save token
            ADMIN_CONFIG.ADMIN_TOKEN = token;
            localStorage.setItem('admin_token', token);
            
            // Show dashboard
            document.getElementById('authScreen').classList.add('hidden');
            document.getElementById('dashboardContent').classList.remove('hidden');
            
            // Load data
            loadDashboardData();
            startAutoRefresh();
            
            showNotification('Authentication successful!', 'success');
        } else {
            throw new Error('Invalid admin token');
        }
    } catch (error) {
        showNotification(error.message, 'error');
        localStorage.removeItem('admin_token');
    } finally {
        hideLoading();
    }
}

function logoutAdmin() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('admin_token');
        location.reload();
    }
}

// ==================== DASHBOARD DATA ====================
async function loadDashboardData() {
    try {
        const response = await fetch(`${ADMIN_CONFIG.BACKEND_URL}/api/analytics/dashboard`, {
            headers: {
                'X-Admin-Token': ADMIN_CONFIG.ADMIN_TOKEN
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            updateDashboardUI(data);
        } else if (response.status === 401) {
            // Token expired
            localStorage.removeItem('admin_token');
            location.reload();
        } else {
            throw new Error('Failed to load dashboard data');
        }
    } catch (error) {
        showNotification(error.message, 'error');
        console.error('Dashboard error:', error);
    }
}

function updateDashboardUI(data) {
    if (!data.success || !data.stats) {
        showNotification('Invalid dashboard data', 'error');
        return;
    }
    
    const stats = data.stats;
    
    // Update overview stats
    document.getElementById('totalSessions').textContent = stats.total_sessions?.toLocaleString() || '0';
    document.getElementById('totalPageViews').textContent = stats.total_page_views?.toLocaleString() || '0';
    document.getElementById('totalDatasets').textContent = stats.total_datasets?.toLocaleString() || '0';
    document.getElementById('totalPreprocessing').textContent = stats.total_preprocessing?.toLocaleString() || '0';
    
    // Update today's stats
    document.getElementById('todaySessions').textContent = stats.today_sessions?.toLocaleString() || '0';
    document.getElementById('todayPageViews').textContent = stats.today_page_views?.toLocaleString() || '0';
    document.getElementById('activeSessions').textContent = stats.active_sessions_5min?.toLocaleString() || '0';
    
    // Update processing stats
    const avgTime = stats.processing_stats?.avg_processing_time || 0;
    document.getElementById('avgProcessingTime').textContent = `${avgTime.toFixed(2)}s`;
    
    // Update dataset stats
    document.getElementById('totalUploads').textContent = stats.total_datasets?.toLocaleString() || '0';
    document.getElementById('totalDownloads').textContent = stats.total_downloads?.toLocaleString() || '0';
    document.getElementById('totalComparisons').textContent = stats.total_comparisons?.toLocaleString() || '0';
    document.getElementById('avgColumns').textContent = stats.processing_stats?.avg_columns?.toFixed(1) || '0';
    
    // Update charts
    updateCharts(stats);
    
    // Update recent activity
    updateRecentActivity(stats.recent_activity || []);
    
    // Update popular pages
    updatePopularPages(stats.popular_pages || []);
    
    // Update last refresh time
    updateLastRefresh();
}

function updateCharts(stats) {
    // Daily Activity Chart
    updateDailyActivityChart(stats.daily_activity || []);
    
    // Dataset Processing Chart
    updateDatasetChart(stats);
}

function updateDailyActivityChart(dailyData) {
    const ctx = document.getElementById('dailyActivityChart');
    if (!ctx) return;
    
    // Prepare data
    const labels = dailyData.map(item => {
        const date = new Date(item.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }).reverse();
    
    const data = dailyData.map(item => item.count).reverse();
    
    // Destroy existing chart
    if (ADMIN_CONFIG.CHARTS.dailyActivity) {
        ADMIN_CONFIG.CHARTS.dailyActivity.destroy();
    }
    
    // Create new chart
    ADMIN_CONFIG.CHARTS.dailyActivity = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Page Views',
                data: data,
                borderColor: '#4a6fa5',
                backgroundColor: 'rgba(74, 111, 165, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#4a6fa5',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function updateDatasetChart(stats) {
    const ctx = document.getElementById('datasetChart');
    if (!ctx) return;
    
    const data = [
        stats.total_datasets || 0,
        stats.total_preprocessing || 0,
        stats.total_comparisons || 0,
        stats.total_downloads || 0
    ];
    
    // Destroy existing chart
    if (ADMIN_CONFIG.CHARTS.datasetChart) {
        ADMIN_CONFIG.CHARTS.datasetChart.destroy();
    }
    
    // Create new chart
    ADMIN_CONFIG.CHARTS.datasetChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Uploads', 'Preprocessing', 'Comparisons', 'Downloads'],
            datasets: [{
                data: data,
                backgroundColor: [
                    '#4a6fa5',
                    '#28a745',
                    '#ffc107',
                    '#17a2b8'
                ],
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                }
            },
            cutout: '60%'
        }
    });
}

function updateRecentActivity(activities) {
    const container = document.getElementById('activityList');
    if (!container) return;
    
    if (activities.length === 0) {
        container.innerHTML = '<div class="activity-item"><div class="activity-content"><div class="activity-title">No recent activity</div></div></div>';
        return;
    }
    
    let html = '';
    activities.forEach(activity => {
        const icon = getActivityIcon(activity.type, activity.action);
        const title = getActivityTitle(activity);
        const time = formatTimeAgo(activity.timestamp);
        
        html += `
            <div class="activity-item">
                <div class="activity-icon">
                    <i class="${icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${title}</div>
                    <div class="activity-meta">
                        <span class="activity-time">${time}</span>
                        ${activity.session_id ? `<span class="activity-session">Session: ${activity.session_id}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function updatePopularPages(pages) {
    const tbody = document.querySelector('#popularPagesTable tbody');
    if (!tbody) return;
    
    if (pages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No data available</td></tr>';
        return;
    }
    
    let html = '';
    pages.forEach(page => {
        html += `
            <tr>
                <td>${escapeHtml(page.page)}</td>
                <td>${page.views.toLocaleString()}</td>
                <td>${formatTimeAgo(new Date())}</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

// ==================== UTILITY FUNCTIONS ====================
function getActivityIcon(type, action) {
    if (type === 'page_view') {
        switch (action) {
            case 'upload': return 'fas fa-cloud-upload-alt';
            case 'preprocess': return 'fas fa-cogs';
            case 'compare': return 'fas fa-robot';
            case 'download': return 'fas fa-download';
            default: return 'fas fa-eye';
        }
    } else if (type === 'dataset_action') {
        switch (action) {
            case 'upload': return 'fas fa-file-upload';
            case 'preprocess': return 'fas fa-magic';
            case 'compare': return 'fas fa-chart-bar';
            case 'download': return 'fas fa-file-download';
            default: return 'fas fa-database';
        }
    }
    return 'fas fa-circle';
}

function getActivityTitle(activity) {
    if (activity.type === 'page_view') {
        return `Viewed ${activity.page}${activity.action ? ` - ${activity.action}` : ''}`;
    } else if (activity.type === 'dataset_action') {
        return `${activity.action.charAt(0).toUpperCase() + activity.action.slice(1)} dataset ${activity.dataset_id?.substring(0, 8) || ''}`;
    }
    return 'Unknown activity';
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
}

function updateLastRefresh() {
    // Could add a last refresh timestamp display
}

function startAutoRefresh() {
    // Auto-refresh dashboard every 30 seconds
    setInterval(() => {
        loadDashboardData();
    }, ADMIN_CONFIG.REFRESH_INTERVAL);
}

function refreshDashboard() {
    loadDashboardData();
    showNotification('Dashboard refreshed', 'success');
}

async function exportAnalyticsData() {
    showLoading('Exporting analytics data...');
    
    try {
        const response = await fetch(`${ADMIN_CONFIG.BACKEND_URL}/api/analytics/export`, {
            headers: {
                'X-Admin-Token': ADMIN_CONFIG.ADMIN_TOKEN
            }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `analytics_export_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            showNotification('Analytics data exported successfully!', 'success');
        } else {
            throw new Error('Export failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function cleanupAnalyticsData() {
    if (!confirm('Are you sure you want to delete analytics data older than 90 days? This action cannot be undone.')) {
        return;
    }
    
    showLoading('Cleaning up old data...');
    
    try {
        const response = await fetch(`${ADMIN_CONFIG.BACKEND_URL}/api/analytics/cleanup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': ADMIN_CONFIG.ADMIN_TOKEN
            },
            body: JSON.stringify({ days: 90 })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(data.message || 'Cleanup completed successfully', 'success');
            loadDashboardData(); // Refresh
        } else {
            throw new Error('Cleanup failed');
        }
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== SHARED FUNCTIONS ====================
function showLoading(message = 'Loading...') {
    // Reuse the same loading modal from main app
    const modal = document.getElementById('loadingModal') || createLoadingModal();
    modal.querySelector('#loadingMessage').textContent = message;
    modal.classList.remove('hidden');
}

function hideLoading() {
    const modal = document.getElementById('loadingModal');
    if (modal) modal.classList.add('hidden');
}

function createLoadingModal() {
    const modal = document.createElement('div');
    modal.id = 'loadingModal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="loader"></div>
            <h3 id="loadingMessage">Loading...</h3>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function showNotification(message, type = 'info') {
    // Reuse notification system from main app
    const container = document.getElementById('notificationContainer') || createNotificationContainer();
    
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
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 1001;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 400px;
    `;
    document.body.appendChild(container);
    return container;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== EXPORT FUNCTIONS FOR HTML ====================
window.authenticateAdmin = authenticateAdmin;
window.logoutAdmin = logoutAdmin;
window.refreshDashboard = refreshDashboard;
window.exportAnalyticsData = exportAnalyticsData;
window.cleanupAnalyticsData = cleanupAnalyticsData;
