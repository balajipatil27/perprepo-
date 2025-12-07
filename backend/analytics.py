from datetime import datetime, timedelta
import uuid
import json
import pandas as pd
from io import StringIO

class SimpleAnalytics:
    def __init__(self, storage_file='analytics_data.json'):
        self.storage_file = storage_file
        self.data = self._load_data()
    
    def _load_data(self):
        """Load analytics data from JSON file"""
        try:
            with open(self.storage_file, 'r') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {
                'page_views': [],
                'dataset_actions': [],
                'user_sessions': {},
                'created_at': datetime.utcnow().isoformat()
            }
    
    def _save_data(self):
        """Save analytics data to JSON file"""
        try:
            with open(self.storage_file, 'w') as f:
                json.dump(self.data, f, indent=2, default=str)
            return True
        except Exception as e:
            print(f"Error saving analytics data: {e}")
            return False
    
    def track_page_view(self, session_id, page, action=None, details=None):
        """Track a page view or action"""
        try:
            page_view = {
                'id': str(uuid.uuid4()),
                'session_id': session_id,
                'page': page,
                'action': action,
                'details': details or {},
                'timestamp': datetime.utcnow().isoformat(),
                'date': datetime.utcnow().date().isoformat()
            }
            
            self.data['page_views'].append(page_view)
            
            # Update or create user session
            if session_id not in self.data['user_sessions']:
                self.data['user_sessions'][session_id] = {
                    'id': session_id,
                    'first_seen': datetime.utcnow().isoformat(),
                    'last_seen': datetime.utcnow().isoformat(),
                    'total_views': 0,
                    'pages_visited': [],
                    'dataset_uploads': 0
                }
            
            session = self.data['user_sessions'][session_id]
            session['last_seen'] = datetime.utcnow().isoformat()
            session['total_views'] += 1
            
            if page not in session['pages_visited']:
                session['pages_visited'].append(page)
            
            return self._save_data()
            
        except Exception as e:
            print(f"Error tracking page view: {e}")
            return False
    
    def track_dataset_action(self, session_id, dataset_id, action, **kwargs):
        """Track dataset-related actions"""
        try:
            action_record = {
                'id': str(uuid.uuid4()),
                'session_id': session_id,
                'dataset_id': dataset_id,
                'action': action,
                'timestamp': datetime.utcnow().isoformat(),
                'processing_time': kwargs.get('processing_time'),
                'rows': kwargs.get('rows'),
                'columns': kwargs.get('columns'),
                'steps_count': kwargs.get('steps_count'),
                'file_size': kwargs.get('file_size')
            }
            
            self.data['dataset_actions'].append(action_record)
            
            # Update session stats if needed
            if action == 'upload' and session_id in self.data['user_sessions']:
                self.data['user_sessions'][session_id]['dataset_uploads'] += 1
            
            return self._save_data()
            
        except Exception as e:
            print(f"Error tracking dataset action: {e}")
            return False
    
    def get_dashboard_stats(self, days=30):
        """Get comprehensive dashboard statistics"""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            cutoff_iso = cutoff_date.isoformat()
            
            # Filter recent data
            recent_views = [
                v for v in self.data['page_views']
                if v['timestamp'] > cutoff_iso
            ]
            
            recent_actions = [
                a for a in self.data['dataset_actions']
                if a['timestamp'] > cutoff_iso
            ]
            
            # Today's date
            today = datetime.utcnow().date().isoformat()
            
            # Calculate stats
            stats = {
                # Overall stats
                'total_sessions': len(self.data['user_sessions']),
                'total_page_views': len(self.data['page_views']),
                'total_datasets': len([a for a in self.data['dataset_actions'] if a['action'] == 'upload']),
                
                # Today's stats
                'today_sessions': len([
                    s for s in self.data['user_sessions'].values()
                    if s.get('last_seen', '').startswith(today)
                ]),
                'today_page_views': len([v for v in self.data['page_views'] if v.get('date') == today]),
                'today_datasets': len([a for a in self.data['dataset_actions'] 
                                      if a['action'] == 'upload' and a.get('timestamp', '').startswith(today)]),
                
                # Recent activity
                'active_sessions_5min': len([
                    s for s in self.data['user_sessions'].values()
                    if datetime.fromisoformat(s['last_seen'].replace('Z', '+00:00')) > 
                    datetime.utcnow() - timedelta(minutes=5)
                ]),
                
                # Dataset statistics
                'total_preprocessing': len([a for a in self.data['dataset_actions'] if a['action'] == 'preprocess']),
                'total_comparisons': len([a for a in self.data['dataset_actions'] if a['action'] == 'compare']),
                'total_downloads': len([a for a in self.data['dataset_actions'] if a['action'] == 'download']),
                
                # Popular pages
                'popular_pages': self._get_popular_pages(),
                
                # Recent activity for feed
                'recent_activity': self._get_recent_activity(limit=20),
                
                # Daily activity for charts
                'daily_activity': self._get_daily_activity(days=days),
                
                # Dataset processing stats
                'processing_stats': self._get_processing_stats()
            }
            
            return stats
            
        except Exception as e:
            print(f"Error getting dashboard stats: {e}")
            # Return empty stats structure
            return self._get_empty_stats()
    
    def _get_popular_pages(self):
        """Get most visited pages"""
        from collections import Counter
        page_counts = Counter([v['page'] for v in self.data['page_views']])
        return [{'page': page, 'views': count} for page, count in page_counts.most_common(10)]
    
    def _get_recent_activity(self, limit=20):
        """Get recent activity for feed"""
        all_activities = []
        
        # Combine page views and dataset actions
        for view in self.data['page_views'][-limit*2:]:
            all_activities.append({
                'type': 'page_view',
                'session_id': view['session_id'][:8],
                'page': view['page'],
                'action': view['action'],
                'timestamp': view['timestamp'],
                'details': view.get('details', {})
            })
        
        for action in self.data['dataset_actions'][-limit*2:]:
            all_activities.append({
                'type': 'dataset_action',
                'session_id': action['session_id'][:8],
                'action': action['action'],
                'dataset_id': action['dataset_id'][:8],
                'timestamp': action['timestamp'],
                'details': {
                    'rows': action.get('rows'),
                    'columns': action.get('columns')
                }
            })
        
        # Sort by timestamp and limit
        all_activities.sort(key=lambda x: x['timestamp'], reverse=True)
        return all_activities[:limit]
    
    def _get_daily_activity(self, days=30):
        """Get daily activity counts for charts"""
        from collections import defaultdict
        
        daily_counts = defaultdict(int)
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        for view in self.data['page_views']:
            view_date = datetime.fromisoformat(view['timestamp'].replace('Z', '+00:00')).date()
            if view_date >= cutoff_date.date():
                daily_counts[view_date.isoformat()] += 1
        
        # Fill missing days with 0
        result = []
        for i in range(days):
            date = (datetime.utcnow() - timedelta(days=i)).date()
            date_str = date.isoformat()
            result.append({
                'date': date_str,
                'count': daily_counts.get(date_str, 0)
            })
        
        result.sort(key=lambda x: x['date'])
        return result
    
    def _get_processing_stats(self):
        """Get dataset processing statistics"""
        processing_actions = [a for a in self.data['dataset_actions'] if a['action'] in ['preprocess', 'compare']]
        
        if not processing_actions:
            return {
                'avg_processing_time': 0,
                'avg_rows': 0,
                'avg_columns': 0,
                'max_rows': 0,
                'total_processing_time': 0
            }
        
        total_time = sum(a.get('processing_time', 0) for a in processing_actions)
        total_rows = sum(a.get('rows', 0) for a in processing_actions)
        total_columns = sum(a.get('columns', 0) for a in processing_actions)
        max_rows = max(a.get('rows', 0) for a in processing_actions)
        
        count = len(processing_actions)
        
        return {
            'avg_processing_time': round(total_time / count, 2) if count > 0 else 0,
            'avg_rows': round(total_rows / count, 0) if count > 0 else 0,
            'avg_columns': round(total_columns / count, 1) if count > 0 else 0,
            'max_rows': max_rows,
            'total_processing_time': round(total_time, 2)
        }
    
    def _get_empty_stats(self):
        """Return empty stats structure"""
        return {
            'total_sessions': 0,
            'total_page_views': 0,
            'total_datasets': 0,
            'today_sessions': 0,
            'today_page_views': 0,
            'today_datasets': 0,
            'active_sessions_5min': 0,
            'total_preprocessing': 0,
            'total_comparisons': 0,
            'total_downloads': 0,
            'popular_pages': [],
            'recent_activity': [],
            'daily_activity': [],
            'processing_stats': {
                'avg_processing_time': 0,
                'avg_rows': 0,
                'avg_columns': 0,
                'max_rows': 0,
                'total_processing_time': 0
            }
        }
    
    def export_analytics(self, format='csv'):
        """Export analytics data"""
        try:
            # Prepare data for export
            export_data = []
            
            for view in self.data['page_views']:
                export_data.append({
                    'Type': 'Page View',
                    'Session ID': view['session_id'],
                    'Page': view['page'],
                    'Action': view['action'] or '',
                    'Timestamp': view['timestamp'],
                    'Details': json.dumps(view.get('details', {}))
                })
            
            for action in self.data['dataset_actions']:
                export_data.append({
                    'Type': 'Dataset Action',
                    'Session ID': action['session_id'],
                    'Dataset ID': action['dataset_id'],
                    'Action': action['action'],
                    'Timestamp': action['timestamp'],
                    'Rows': action.get('rows', ''),
                    'Columns': action.get('columns', ''),
                    'Processing Time': action.get('processing_time', '')
                })
            
            df = pd.DataFrame(export_data)
            
            if format == 'csv':
                return df.to_csv(index=False)
            elif format == 'json':
                return df.to_json(orient='records', indent=2)
            else:
                return df.to_string()
                
        except Exception as e:
            print(f"Error exporting analytics: {e}")
            return ""
    
    def cleanup_old_data(self, days=90):
        """Clean up data older than specified days"""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            cutoff_iso = cutoff_date.isoformat()
            
            # Filter out old data
            self.data['page_views'] = [
                v for v in self.data['page_views']
                if v['timestamp'] > cutoff_iso
            ]
            
            self.data['dataset_actions'] = [
                a for a in self.data['dataset_actions']
                if a['timestamp'] > cutoff_iso
            ]
            
            # Clean up old sessions with no recent activity
            self.data['user_sessions'] = {
                sid: session for sid, session in self.data['user_sessions'].items()
                if session['last_seen'] > cutoff_iso
            }
            
            return self._save_data()
            
        except Exception as e:
            print(f"Error cleaning up old data: {e}")
            return False