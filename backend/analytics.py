from datetime import datetime, timedelta
import uuid
from flask import request
import json

class AnalyticsTracker:
    def __init__(self, db):
        self.db = db
    
    # Simple models for analytics
    class PageView(db.Model):
        id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        session_id = db.Column(db.String(36), nullable=False)
        page = db.Column(db.String(100), nullable=False)
        action = db.Column(db.String(100))
        timestamp = db.Column(db.DateTime, default=datetime.utcnow)
        user_agent = db.Column(db.Text)
        referrer = db.Column(db.String(500))
        duration = db.Column(db.Float)  # Time spent on page in seconds
        
    class DatasetAction(db.Model):
        id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        session_id = db.Column(db.String(36), nullable=False)
        dataset_id = db.Column(db.String(36))
        action = db.Column(db.String(50))  # upload, preprocess, download, compare
        timestamp = db.Column(db.DateTime, default=datetime.utcnow)
        processing_time = db.Column(db.Float)
        rows = db.Column(db.Integer)
        columns = db.Column(db.Integer)
        steps_count = db.Column(db.Integer)
        
    class UserSession(db.Model):
        id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        start_time = db.Column(db.DateTime, default=datetime.utcnow)
        last_activity = db.Column(db.DateTime, default=datetime.utcnow)
        pages_visited = db.Column(db.Integer, default=0)
        dataset_uploads = db.Column(db.Integer, default=0)
        total_processing_time = db.Column(db.Float, default=0)
        is_active = db.Column(db.Boolean, default=True)
        
    # Basic tracking methods
    def track_page_view(self, session_id, page, action=None, duration=0):
        """Track a page view"""
        page_view = self.PageView(
            session_id=session_id,
            page=page,
            action=action,
            user_agent=request.user_agent.string if request.user_agent else None,
            referrer=request.referrer,
            duration=duration
        )
        
        self.db.session.add(page_view)
        
        # Update session
        session = self.UserSession.query.get(session_id)
        if session:
            session.last_activity = datetime.utcnow()
            session.pages_visited += 1
        else:
            session = self.UserSession(
                id=session_id,
                last_activity=datetime.utcnow(),
                pages_visited=1
            )
            self.db.session.add(session)
        
        try:
            self.db.session.commit()
        except:
            self.db.session.rollback()
        
        return page_view
    
    def track_dataset_action(self, session_id, dataset_id, action, **kwargs):
        """Track dataset-related actions"""
        action_record = self.DatasetAction(
            session_id=session_id,
            dataset_id=dataset_id,
            action=action,
            processing_time=kwargs.get('processing_time'),
            rows=kwargs.get('rows'),
            columns=kwargs.get('columns'),
            steps_count=kwargs.get('steps_count')
        )
        
        self.db.session.add(action_record)
        
        # Update session stats
        session = self.UserSession.query.get(session_id)
        if session:
            if action == 'upload':
                session.dataset_uploads += 1
            if kwargs.get('processing_time'):
                session.total_processing_time += kwargs['processing_time']
        
        try:
            self.db.session.commit()
        except:
            self.db.session.rollback()
        
        return action_record
    
    def get_dashboard_stats(self, days=30):
        """Get statistics for admin dashboard"""
        stats = {}
        
        # Date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days)
        
        # Basic counts
        stats['total_sessions'] = self.UserSession.query.count()
        stats['total_page_views'] = self.PageView.query.count()
        stats['total_datasets'] = self.DatasetAction.query.filter_by(action='upload').count()
        
        # Today's stats
        today = datetime.utcnow().date()
        stats['today_sessions'] = self.UserSession.query.filter(
            self.UserSession.start_time >= today
        ).count()
        
        stats['today_page_views'] = self.PageView.query.filter(
            self.PageView.timestamp >= today
        ).count()
        
        # Active sessions (last 30 minutes)
        active_time = datetime.utcnow() - timedelta(minutes=30)
        stats['active_sessions'] = self.UserSession.query.filter(
            self.UserSession.last_activity >= active_time
        ).count()
        
        # Popular pages
        from sqlalchemy import func
        popular_pages = self.PageView.query.with_entities(
            self.PageView.page,
            func.count(self.PageView.page).label('views')
        ).group_by(self.PageView.page).order_by(func.count(self.PageView.page).desc()).limit(10).all()
        
        stats['popular_pages'] = [{'page': p[0], 'views': p[1]} for p in popular_pages]
        
        # Dataset statistics
        stats['total_preprocessing'] = self.DatasetAction.query.filter_by(action='preprocess').count()
        stats['total_comparisons'] = self.DatasetAction.query.filter_by(action='compare').count()
        stats['total_downloads'] = self.DatasetAction.query.filter_by(action='download').count()
        
        # Daily activity for chart
        daily_activity = self.PageView.query.with_entities(
            func.date(self.PageView.timestamp).label('date'),
            func.count('*').label('count')
        ).filter(
            self.PageView.timestamp >= start_date
        ).group_by('date').order_by('date').all()
        
        stats['daily_activity'] = [{'date': d[0].isoformat() if d[0] else '', 'count': d[1]} for d in daily_activity]
        
        # Recent activity (last 50)
        recent_activity = self.PageView.query.order_by(
            self.PageView.timestamp.desc()
        ).limit(50).all()
        
        stats['recent_activity'] = [{
            'page': r.page,
            'action': r.action,
            'time': r.timestamp.isoformat(),
            'session_id': r.session_id[:8]  # Short ID for display
        } for r in recent_activity]
        
        # Processing stats
        processing_stats = self.DatasetAction.query.with_entities(
            func.avg(self.DatasetAction.processing_time).label('avg_time'),
            func.avg(self.DatasetAction.rows).label('avg_rows'),
            func.avg(self.DatasetAction.columns).label('avg_columns'),
            func.max(self.DatasetAction.rows).label('max_rows')
        ).filter(
            self.DatasetAction.processing_time.isnot(None)
        ).first()
        
        stats['processing_stats'] = {
            'avg_processing_time': float(processing_stats[0] or 0),
            'avg_rows': float(processing_stats[1] or 0),
            'avg_columns': float(processing_stats[2] or 0),
            'max_rows': int(processing_stats[3] or 0)
        }
        
        return stats
    
    def get_user_flow(self):
        """Get user flow between pages"""
        from sqlalchemy import func
        
        # Get sequence of pages per session
        sessions = self.PageView.query.with_entities(
            self.PageView.session_id,
            self.PageView.page,
            func.row_number().over(
                partition_by=self.PageView.session_id,
                order_by=self.PageView.timestamp
            ).label('sequence')
        ).order_by(
            self.PageView.session_id,
            self.PageView.timestamp
        ).all()
        
        # Count transitions
        transitions = {}
        for i in range(len(sessions) - 1):
            if sessions[i].session_id == sessions[i + 1].session_id:
                transition = f"{sessions[i].page} → {sessions[i + 1].page}"
                transitions[transition] = transitions.get(transition, 0) + 1
        
        # Sort by frequency
        sorted_transitions = sorted(transitions.items(), key=lambda x: x[1], reverse=True)[:20]
        
        return [{'transition': t[0], 'count': t[1]} for t in sorted_transitions]
    
    def cleanup_old_data(self, days=90):
        """Clean up data older than specified days"""
        cutoff_date = datetime.utcnow() - timedelta(days=days)
        
        try:
            # Delete old page views
            self.PageView.query.filter(
                self.PageView.timestamp < cutoff_date
            ).delete()
            
            # Delete old dataset actions
            self.DatasetAction.query.filter(
                self.DatasetAction.timestamp < cutoff_date
            ).delete()
            
            # Delete old inactive sessions
            self.UserSession.query.filter(
                self.UserSession.last_activity < cutoff_date
            ).delete()
            
            self.db.session.commit()
            return True
        except Exception as e:
            self.db.session.rollback()
            print(f"Cleanup error: {e}")
            return False
    
    def export_analytics(self, format='csv'):
        """Export analytics data"""
        import pandas as pd
        from io import StringIO
        
        # Get all page views
        page_views = self.PageView.query.all()
        
        # Convert to list of dicts
        data = []
        for pv in page_views:
            data.append({
                'timestamp': pv.timestamp.isoformat(),
                'session_id': pv.session_id,
                'page': pv.page,
                'action': pv.action,
                'duration': pv.duration,
                'referrer': pv.referrer
            })
        
        # Create DataFrame
        df = pd.DataFrame(data)
        
        if format == 'csv':
            return df.to_csv(index=False)
        elif format == 'json':
            return df.to_json(orient='records')
        else:
            return df.to_string()