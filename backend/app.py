from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pandas as pd
import numpy as np
import uuid
import os
import json
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta
import time
import threading

from preprocessing import DataPreprocessor
from models import ModelComparator
from database import db, Dataset, ProcessingJob
from analytics import AnalyticsTracker

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///datasets.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Initialize database
db.init_app(app)
analytics = AnalyticsTracker(db)

# Create tables
with app.app_context():
    db.create_all()

# Global variables
processing_jobs = {}

# Helper to generate session ID
def get_or_create_session():
    """Get or create session ID from cookie"""
    session_id = request.cookies.get('session_id')
    if not session_id:
        session_id = str(uuid.uuid4())
    return session_id

# Track page view decorator
def track_page_view(page_name):
    def decorator(func):
        def wrapper(*args, **kwargs):
            session_id = get_or_create_session()
            analytics.track_page_view(session_id, page_name)
            return func(*args, **kwargs)
        wrapper.__name__ = func.__name__
        return wrapper
    return decorator

# API Routes
@app.route('/')
@track_page_view('home')
def home():
    return jsonify({
        'message': 'Data Preprocessing API', 
        'status': 'running',
        'version': '1.0.0'
    })

@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'total_sessions': analytics.UserSession.query.count()
    })

@app.route('/upload', methods=['POST'])
def upload_dataset():
    """Upload a dataset file"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Generate unique ID
    dataset_id = str(uuid.uuid4())
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{dataset_id}_{filename}")
    
    # Save file
    file.save(filepath)
    
    try:
        # Read file
        if filename.endswith('.csv'):
            df = pd.read_csv(filepath)
        elif filename.endswith(('.xls', '.xlsx')):
            df = pd.read_excel(filepath)
        else:
            return jsonify({'error': 'Unsupported file format'}), 400
        
        # Store in database
        dataset = Dataset(
            id=dataset_id,
            filename=filepath,
            original_filename=filename,
            file_size=os.path.getsize(filepath),
            processed=False
        )
        db.session.add(dataset)
        db.session.commit()
        
        # Track upload
        session_id = get_or_create_session()
        analytics.track_dataset_action(
            session_id=session_id,
            dataset_id=dataset_id,
            action='upload',
            rows=len(df),
            columns=len(df.columns)
        )
        
        # Return info
        info = {
            'dataset_id': dataset_id,
            'filename': filename,
            'rows': len(df),
            'columns': len(df.columns),
            'columns_list': list(df.columns),
            'dtypes': df.dtypes.astype(str).to_dict(),
            'missing_values': df.isnull().sum().to_dict()
        }
        
        return jsonify(info)
        
    except Exception as e:
        return jsonify({'error': f'Error reading file: {str(e)}'}), 500

@app.route('/dataset/<dataset_id>/info', methods=['GET'])
def get_dataset_info(dataset_id):
    """Get information about uploaded dataset"""
    dataset = Dataset.query.get(dataset_id)
    if not dataset or not os.path.exists(dataset.filename):
        return jsonify({'error': 'Dataset not found'}), 404
    
    try:
        if dataset.filename.endswith('.csv'):
            df = pd.read_csv(dataset.filename)
        else:
            df = pd.read_excel(dataset.filename)
        
        preprocessor = DataPreprocessor(df)
        column_info = preprocessor.get_column_info()
        
        return jsonify({
            'dataset_id': dataset_id,
            'shape': df.shape,
            'columns': list(df.columns),
            'column_info': column_info,
            'missing_summary': {
                'total_missing': int(df.isnull().sum().sum()),
                'columns_with_missing': df.isnull().sum().to_dict()
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/dataset/<dataset_id>/preprocess', methods=['POST'])
def preprocess_dataset(dataset_id):
    """Apply preprocessing steps"""
    data = request.json
    steps = data.get('steps', [])
    
    # Track preprocessing start
    session_id = get_or_create_session()
    analytics.track_page_view(session_id, 'preprocessing', 'start')
    
    # Start background job
    job_id = str(uuid.uuid4())
    processing_jobs[job_id] = {
        'status': 'processing',
        'progress': 0,
        'result': None,
        'start_time': time.time()
    }
    
    thread = threading.Thread(
        target=process_dataset_background,
        args=(dataset_id, steps, job_id, session_id)
    )
    thread.start()
    
    return jsonify({
        'job_id': job_id,
        'message': 'Processing started',
        'status_url': f'/job/{job_id}/status'
    })

def process_dataset_background(dataset_id, steps, job_id, session_id):
    """Background processing"""
    try:
        dataset = Dataset.query.get(dataset_id)
        if not dataset:
            raise Exception("Dataset not found")
        
        # Load data
        if dataset.filename.endswith('.csv'):
            df = pd.read_csv(dataset.filename)
        else:
            df = pd.read_excel(dataset.filename)
        
        preprocessor = DataPreprocessor(df)
        processing_jobs[job_id]['progress'] = 10
        
        # Apply steps
        preprocessor.drop_high_missing_columns(threshold=0.5)
        processing_jobs[job_id]['progress'] = 30
        
        preprocessor.remove_duplicates()
        processing_jobs[job_id]['progress'] = 50
        
        for i, step in enumerate(steps):
            action = step.get('action')
            column = step.get('column')
            method = step.get('method')
            
            if action == 'change_type':
                preprocessor.change_data_type(column, method)
            elif action == 'fill_missing':
                preprocessor.handle_missing_values(column, method)
            elif action == 'encode':
                preprocessor.encode_categorical(column, method)
            elif action == 'remove_outliers':
                preprocessor.remove_outliers(column)
            
            progress = 50 + (i / len(steps)) * 40
            processing_jobs[job_id]['progress'] = int(progress)
        
        # Save processed data
        processed_filename = f"processed_{dataset_id}.csv"
        processed_path = os.path.join(app.config['UPLOAD_FOLDER'], processed_filename)
        preprocessor.df.to_csv(processed_path, index=False)
        
        # Generate report
        report = preprocessor.generate_report()
        
        processing_jobs[job_id]['progress'] = 100
        processing_jobs[job_id]['status'] = 'completed'
        processing_jobs[job_id]['result'] = {
            'processed_file': processed_filename,
            'report': report,
            'download_url': f'/download/{processed_filename}'
        }
        
        # Track completion
        processing_time = time.time() - processing_jobs[job_id]['start_time']
        analytics.track_dataset_action(
            session_id=session_id,
            dataset_id=dataset_id,
            action='preprocess',
            processing_time=processing_time,
            rows=len(df),
            columns=len(df.columns),
            steps_count=len(steps)
        )
        
    except Exception as e:
        processing_jobs[job_id]['status'] = 'error'
        processing_jobs[job_id]['error'] = str(e)

@app.route('/job/<job_id>/status', methods=['GET'])
def get_job_status(job_id):
    """Get status of a processing job"""
    if job_id not in processing_jobs:
        return jsonify({'error': 'Job not found'}), 404
    
    job_info = processing_jobs[job_id]
    return jsonify({
        'job_id': job_id,
        'status': job_info['status'],
        'progress': job_info.get('progress', 0),
        'result': job_info.get('result'),
        'error': job_info.get('error')
    })

@app.route('/dataset/<dataset_id>/compare', methods=['POST'])
def compare_models(dataset_id):
    """Compare models before and after preprocessing"""
    data = request.json
    processed_file = data.get('processed_file')
    target_column = data.get('target_column')
    
    # Track comparison start
    session_id = get_or_create_session()
    analytics.track_page_view(session_id, 'model_comparison', 'start')
    
    try:
        # Load datasets
        dataset = Dataset.query.get(dataset_id)
        if not dataset:
            return jsonify({'error': 'Dataset not found'}), 404
        
        original_df = pd.read_csv(dataset.filename) if dataset.filename.endswith('.csv') else pd.read_excel(dataset.filename)
        
        processed_path = os.path.join(app.config['UPLOAD_FOLDER'], processed_file)
        if not os.path.exists(processed_path):
            return jsonify({'error': 'Processed file not found'}), 404
        
        processed_df = pd.read_csv(processed_path)
        
        # Run comparisons
        comparator = ModelComparator()
        
        # Original data
        X_orig, y_orig, problem_type_orig, target_col = comparator.prepare_data(original_df, target_column)
        original_results = comparator.evaluate_models(X_orig, y_orig, problem_type_orig)
        
        # Processed data
        X_proc, y_proc, problem_type_proc, _ = comparator.prepare_data(processed_df, target_col)
        processed_results = comparator.evaluate_models(X_proc, y_proc, problem_type_proc)
        
        # Combine results
        comparison = []
        for i in range(min(len(original_results), len(processed_results))):
            orig = original_results[i]
            proc = processed_results[i]
            
            if isinstance(orig['score'], (int, float)) and isinstance(proc['score'], (int, float)):
                improvement = round(float(proc['score']) - float(orig['score']), 4)
            else:
                improvement = 'N/A'
            
            comparison.append({
                'model': orig['model'],
                'original': orig['score'],
                'processed': proc['score'],
                'improvement': improvement,
                'metric': orig['metric']
            })
        
        # Track completion
        analytics.track_dataset_action(
            session_id=session_id,
            dataset_id=dataset_id,
            action='compare'
        )
        
        return jsonify({
            'comparison': comparison,
            'problem_type': problem_type_orig,
            'target_column': target_col
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    """Download processed dataset"""
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    
    # Track download
    session_id = get_or_create_session()
    # Extract dataset_id from filename
    if filename.startswith('processed_'):
        dataset_id = filename.replace('processed_', '').replace('.csv', '')
        analytics.track_dataset_action(
            session_id=session_id,
            dataset_id=dataset_id,
            action='download'
        )
    
    return send_file(filepath, as_attachment=True)

# ANALYTICS ENDPOINTS
@app.route('/api/analytics/dashboard', methods=['GET'])
def get_analytics_dashboard():
    """Get analytics dashboard data"""
    # Simple authentication (in production, use proper auth)
    auth_token = request.headers.get('X-Admin-Token')
    if not auth_token or auth_token != 'admin123':  # Change this in production
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        stats = analytics.get_dashboard_stats(days=30)
        user_flow = analytics.get_user_flow()
        
        return jsonify({
            'success': True,
            'stats': stats,
            'user_flow': user_flow,
            'generated_at': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/realtime', methods=['GET'])
def get_realtime_analytics():
    """Get real-time analytics"""
    # Last 5 minutes
    five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
    
    recent_views = analytics.PageView.query.filter(
        analytics.PageView.timestamp >= five_minutes_ago
    ).count()
    
    active_sessions = analytics.UserSession.query.filter(
        analytics.UserSession.last_activity >= five_minutes_ago
    ).count()
    
    return jsonify({
        'last_5_minutes': {
            'page_views': recent_views,
            'active_sessions': active_sessions
        },
        'current_time': datetime.utcnow().isoformat()
    })

@app.route('/api/analytics/export', methods=['GET'])
def export_analytics_data():
    """Export analytics data as CSV"""
    auth_token = request.headers.get('X-Admin-Token')
    if not auth_token or auth_token != 'admin123':  # Change this in production
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        csv_data = analytics.export_analytics(format='csv')
        
        # Create response
        response = app.response_class(
            response=csv_data,
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment;filename=analytics_export_{datetime.utcnow().strftime("%Y%m%d")}.csv'}
        )
        
        return response
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/cleanup', methods=['POST'])
def cleanup_analytics():
    """Clean up old analytics data"""
    auth_token = request.headers.get('X-Admin-Token')
    if not auth_token or auth_token != 'admin123':  # Change this in production
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        days = request.json.get('days', 90)
        success = analytics.cleanup_old_data(days=days)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'Cleaned up data older than {days} days'
            })
        else:
            return jsonify({'error': 'Cleanup failed'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

with app.app_context():
    # This will create all tables including analytics tables
    from analytics import AnalyticsTracker
    db.create_all()
    print("All tables created successfully")


# Add this test route to app.py
@app.route('/test-analytics')
def test_analytics():
    session_id = str(uuid.uuid4())
    analytics.track_page_view(session_id, 'test_page', 'test_action')
    analytics.track_dataset_action(session_id, 'test_dataset', 'upload', rows=100, columns=10)
    return jsonify({'message': 'Test tracking completed'})


# Track endpoint for frontend
@app.route('/api/track', methods=['POST'])
def track_event():
    """Track events from frontend"""
    try:
        data = request.json
        session_id = data.get('session_id')
        page = data.get('page', 'unknown')
        action = data.get('action')
        
        if session_id:
            analytics.track_page_view(session_id, page, action)
        
        return jsonify({'success': True})
    except:
        return jsonify({'success': False}), 400

if __name__ == '__main__':
    app.run(debug=True, port=5000)