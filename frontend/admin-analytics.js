// Admin Analytics Dashboard
let adminToken = 'admin123'; // Change this in production

// DOM Elements
const authSection = document.getElementById('authSection');
const dashboardContent = document.getElementById('dashboardContent');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // For simplicity, auto-authenticate with default token
    // In production, you should implement proper authentication
    authenticateAdmin();
});

// Authenticate Admin
async function authenticateAdmin() {
    try {
        const response = await fetch('/api/analytics/dashboard', {
            headers: {
                'X-Admin-Token': adminToken
            }
        });
        
        if (response.ok) {
            authSection.classList.add('hidden');
            dashboardContent.classList.remove('hidden');
            loadDashboardData();
            startRealtimeUpdates();
        } else {
            showNotification('Authentication failed. Please check token.', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please check backend.', 'error');
    }
}

// Load Dashboard Data
async function loadDashboardData() {
    try {
        const response = await fetch('/api/analytics/dashboard', {
            headers: {
                'X-Admin-Token': adminToken
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            updateDashboard(data);
        } else {
            showNotification('Failed to load dashboard data', 'error');
        }
    } catch (error) {
        showNotification('Network error', 'error');
    }
}

// Update Dashboard UI
function updateDashboard(data) {
    if (!data.success) return;
    
    const stats = data.stats;
    
    // Overview stats
    document.getElementById('totalSessions').textContent = 
        stats.total_sessions.toLocaleString();
    document.getElementById('totalPageViews').textContent = 
        stats.total_page_views.toLocaleString();
    document.getElementById('totalDatasets').textContent = 
        stats.total_datasets.toLocaleString();
    document.getElementById('totalProcessing').textContent = 
        stats.total_preprocessing.toLocaleString();
    
    // Today's stats
    document.getElementById('todaySessions').textContent = 
        stats.today_sessions.toLocaleString();
    document.getElementById('todayPageViews').textContent = 
        stats.today_page_views.toLocaleString();
    
    // Active sessions
    document.getElementById('activeSessions').textContent = 
        stats.active_sessions.toLocaleString();
    
    // Dataset analytics
    document.getElementById('avgProcessingTime').textContent = 
        `${stats.processing_stats.avg_processing_time.toFixed(2)}s`;
    document.getElementById('avgDatasetSize').textContent = 
        `${Math.round(stats.processing_stats.avg_rows)} rows × ${Math.round(stats.processing_stats.avg_columns)} columns`;
    document.getElementById('totalDownloads').textContent = 
        stats.total_downloads.toLocaleString();
    document.getElementById('totalComparisons').textContent = 
        stats.total_comparisons.toLocaleString();
    
    // Popular pages table
    const popularPagesTbody = document.getElementById('popularPages');
    popularPagesTbody.innerHTML = stats.popular_pages.map(page => `
        <tr>
            <td>${page.page}</td>
            <td>${page.views.toLocaleString()}</td>
            <td>${formatTimeAgo(new Date())}</td>
        </tr>
    `).join('');
    
    // Recent activity feed
    const activityFeed = document.getElementById('activityFeed');
    activityFeed.innerHTML = stats.recent_activity.map(activity => `
        <div class="activity-item">
            <div class="activity-icon">
                <i class="fas fa-${getActivityIcon(activity.action)}"></i>
            </div>
            <div class="activity-details">
                <div class="activity-title">
                    ${activity.page} ${activity.action ? `- ${activity.action}` : ''}
                </div>
                <div class="activity-meta">
                    <span class="activity-time">${formatTimeAgo(new Date(activity.time))}</span>
                    <span class="activity-session">Session: ${activity.session_id}</span>
                </div>
            </div>
        </div>
    `).join('');
    
    // Update charts if they exist
    if (window.dashboardCharts) {
        updateCharts(data);
    } else {
        createCharts(data);
    }
}

// Create Charts
function createCharts(data) {
    window.dashboardCharts = {};
    
    // Daily Activity Chart
    const dailyCtx = document.getElementById('dailyActivityChart');
    if (dailyCtx) {
        const dailyLabels = data.stats.daily_activity.map(item => 
            new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );
        const dailyData = data.stats.daily_activity.map(item => item.count);
        
        window.dashboardCharts.daily = new Chart(dailyCtx, {
            type: 'line',
            data: {
                labels: dailyLabels,
                datasets: [{
                    label: 'Page Views',
                    data: dailyData,
                    borderColor: '#4a6fa5',
                    backgroundColor: 'rgba(74, 111, 165, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
    
    // User Flow Chart
    const flowCtx = document.getElementById('userFlowChart');
    if (flowCtx && data.user_flow) {
        const flowLabels = data.user_flow.map(item => item.transition);
        const flowData = data.user_flow.map(item => item.count);
        
        window.dashboardCharts.flow = new Chart(flowCtx, {
            type: 'bar',
            data: {
                labels: flowLabels,
                datasets: [{
                    label: 'Transitions',
                    data: flowData,
                    backgroundColor: '#4a6fa5'
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
}

// Update Charts
function updateCharts(data) {
    // Update daily activity chart
    if (window.dashboardCharts.daily) {
        const dailyLabels = data.stats.daily_activity.map(item => 
            new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );
        const dailyData = data.stats.daily_activity.map(item => item.count);
        
        window.dashboardCharts.daily.data.labels = dailyLabels;
        window.dashboardCharts.daily.data.datasets[0].data = dailyData;
        window.dashboardCharts.daily.update();
    }
}

// Helper Functions
function getActivityIcon(action) {
    const icons = {
        'upload': 'cloud-upload-alt',
        'preprocess': 'cogs',
        'compare': 'robot',
        'download': 'download',
        'start': 'play',
        'view': 'eye'
    };
    return icons[action] || 'circle';
}

function formatTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
}

// Start real-time updates
function startRealtimeUpdates() {
    // Update every 30 seconds
    setInterval(async () => {
        try {
            const response = await fetch('/api/analytics/realtime');
            if (response.ok) {
                const data = await response.json();
                updateRealtimeStats(data);
            }
        } catch (error) {
            console.error('Failed to fetch real-time stats:', error);
        }
    }, 30000);
}

// Update real-time stats
function updateRealtimeStats(data) {
    if (data.last_5_minutes) {
        document.getElementById('activeSessions').textContent = 
            data.last_5_minutes.active_sessions;
        document.getElementById('recentPageViews').textContent = 
            data.last_5_minutes.page_views;
    }
}

// Export Analytics Data
async function exportAnalytics() {
    try {
        const response = await fetch('/api/analytics/export', {
            headers: {
                'X-Admin-Token': adminToken
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
            
            showNotification('Analytics exported successfully!', 'success');
        } else {
            showNotification('Failed to export analytics', 'error');
        }
    } catch (error) {
        showNotification('Export failed', 'error');
    }
}

// Cleanup old data
async function cleanupData() {
    if (!confirm('Are you sure you want to delete analytics data older than 90 days?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/analytics/cleanup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': adminToken
            },
            body: JSON.stringify({ days: 90 })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(data.message || 'Cleanup completed', 'success');
            loadDashboardData(); // Refresh
        } else {
            showNotification('Cleanup failed', 'error');
        }
    } catch (error) {
        showNotification('Cleanup failed', 'error');
    }
}

// Refresh Dashboard
function refreshDashboard() {
    loadDashboardData();
    showNotification('Dashboard refreshed', 'success');
}

// Notification System
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add to admin.html button events
window.exportAnalytics = exportAnalytics;
window.cleanupData = cleanupData;
window.refreshDashboard = refreshDashboard;