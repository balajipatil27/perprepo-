from flask import Flask, request, jsonify, send_file, make_response
from flask_cors import CORS
import pandas as pd
import numpy as np
import uuid
import os
import json
import time
import threading
from werkzeug.utils import secure_filename
from datetime import datetime, timedelta
import traceback

# Import our modules
from database import db, Dataset, ProcessingJob
from analytics import SimpleAnalytics
from preprocessing import DataPreprocessor
from models import ModelComparator

# Initialize Flask app
app = Flask(__name__)

# =========== FIX 1: Use simpler CORS config ===========
# Instead of resources={r"/*": {"origins": "*"}}, use:
CORS(app, origins=["https://cool-liger-905e74.netlify.app", "http://localhost:3000", "http://localhost:5000"])

# OR to allow all origins (for testing):
# CORS(app)

# =========== FIX 2: Add specific headers ===========
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', 'https://cool-liger-905e74.netlify.app')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Token')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

# Rest of your code remains the same...

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///datasets.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['PROCESSED_FOLDER'] = 'processed'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max

# Create necessary directories
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['PROCESSED_FOLDER'], exist_ok=True)

# Initialize extensions
db.init_app(app)
analytics = SimpleAnalytics('analytics_data.json')

# Create tables
with app.app_context():
    db.create_all()

# Global storage for jobs
processing_jobs = {}

# ==================== HELPER FUNCTIONS ====================

def get_or_create_session_id():
    """Get or create a session ID from cookies or generate new"""
    session_id = request.cookies.get('session_id')
    if not session_id:
        session_id = str(uuid.uuid4())
    return session_id

def save_uploaded_file(file):
    """Save uploaded file and return filepath"""
    if file.filename == '':
        raise ValueError("No file selected")
    
    # Generate unique filename
    file_id = str(uuid.uuid4())
    original_filename = secure_filename(file.filename)
    filename = f"{file_id}_{original_filename}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    # Save file
    file.save(filepath)
    
    return filepath, original_filename, file_id

def read_dataset_file(filepath):
    """Read dataset file based on extension"""
    if filepath.endswith('.csv'):
        return pd.read_csv(filepath)
    elif filepath.endswith('.xlsx'):
        return pd.read_excel(filepath, engine='openpyxl')
    elif filepath.endswith('.xls'):
        return pd.read_excel(filepath)
    else:
        raise ValueError("Unsupported file format. Use CSV or Excel files.")

def track_request(action, page, details=None):
    """Track API request"""
    try:
        session_id = get_or_create_session_id()
        analytics.track_page_view(session_id, page, action, details)
    except:
        pass  # Silently fail tracking

def create_response(data, status=200, session_id=None):
    """Create standardized response"""
    response = jsonify(data)
    if session_id and not request.cookies.get('session_id'):
        response.set_cookie('session_id', session_id, max_age=30*24*60*60)
    return response, status

# ==================== API ROUTES ====================

@app.route('/')
def home():
    """Home endpoint"""
    return create_response({
        'message': 'DataPrePro API',
        'status': 'running',
        'version': '1.0.0',
        'endpoints': {
            'GET /': 'API info',
            'GET /health': 'Health check',
            'POST /upload': 'Upload dataset',
            'GET /dataset/<id>/info': 'Get dataset info',
            'POST /dataset/<id>/preprocess': 'Preprocess dataset',
            'GET /job/<id>/status': 'Get job status',
            'POST /dataset/<id>/compare': 'Compare models',
            'GET /download/<filename>': 'Download file',
            'GET /api/analytics/dashboard': 'Analytics dashboard',
            'GET /api/analytics/export': 'Export analytics'
        }
    })

@app.route('/health')
def health_check():
    """Health check endpoint"""
    return create_response({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'database': 'connected',
        'analytics': 'active'
    })

@app.route('/upload', methods=['POST'])
def upload_dataset():
    """Upload a dataset file"""
    try:
        if 'file' not in request.files:
            return create_response({'error': 'No file uploaded'}, 400)
        
        file = request.files['file']
        session_id = get_or_create_session_id()
        
        # Save file
        filepath, original_filename, file_id = save_uploaded_file(file)
        
        # Read dataset to get info
        try:
            df = read_dataset_file(filepath)
        except Exception as e:
            os.remove(filepath)
            return create_response({'error': f'Error reading file: {str(e)}'}, 400)
        
        # Save dataset info to database
        dataset = Dataset(
            id=file_id,
            filename=filepath,
            original_filename=original_filename,
            file_size=os.path.getsize(filepath),
            upload_time=datetime.utcnow()
        )
        db.session.add(dataset)
        db.session.commit()
        
        # Track upload
        analytics.track_dataset_action(
            session_id=session_id,
            dataset_id=file_id,
            action='upload',
            rows=len(df),
            columns=len(df.columns),
            file_size=os.path.getsize(filepath)
        )
        
        # Get column info
        preprocessor = DataPreprocessor(df)
        column_info = preprocessor.get_column_info()
        
        return create_response({
            'success': True,
            'dataset_id': file_id,
            'filename': original_filename,
            'rows': len(df),
            'columns': len(df.columns),
            'column_info': column_info,
            'preview': df.head(10).to_dict('records'),
            'message': 'Dataset uploaded successfully'
        }, session_id=session_id)
        
    except Exception as e:
        return create_response({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc() if app.debug else None
        }, 500)

@app.route('/dataset/<dataset_id>/info', methods=['GET'])
def get_dataset_info(dataset_id):
    """Get information about a dataset"""
    try:
        dataset = Dataset.query.get(dataset_id)
        if not dataset:
            return create_response({'error': 'Dataset not found'}, 404)
        
        # Read dataset
        df = read_dataset_file(dataset.filename)
        
        # Get detailed info
        preprocessor = DataPreprocessor(df)
        column_info = preprocessor.get_column_info()
        
        # Track view
        session_id = get_or_create_session_id()
        track_request('view', 'dataset_info', {'dataset_id': dataset_id})
        
        return create_response({
            'success': True,
            'dataset_id': dataset_id,
            'filename': dataset.original_filename,
            'upload_time': dataset.upload_time.isoformat() if dataset.upload_time else None,
            'file_size': dataset.file_size,
            'rows': len(df),
            'columns': len(df.columns),
            'column_info': column_info,
            'missing_values': int(df.isnull().sum().sum()),
            'duplicates': int(df.duplicated().sum()),
            'preview': df.head(5).to_dict('records'),
            'summary': {
                'numeric_columns': len(df.select_dtypes(include=[np.number]).columns),
                'categorical_columns': len(df.select_dtypes(include=['object']).columns),
                'date_columns': len(df.select_dtypes(include=['datetime']).columns)
            }
        })
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

@app.route('/dataset/<dataset_id>/preprocess', methods=['POST'])
def preprocess_dataset(dataset_id):
    """Start preprocessing a dataset"""
    try:
        dataset = Dataset.query.get(dataset_id)
        if not dataset:
            return create_response({'error': 'Dataset not found'}, 404)
        
        # Get preprocessing steps from request
        data = request.json or {}
        steps = data.get('steps', [])
        
        # Create job
        job_id = str(uuid.uuid4())
        processing_jobs[job_id] = {
            'id': job_id,
            'dataset_id': dataset_id,
            'status': 'processing',
            'progress': 0,
            'result': None,
            'error': None,
            'start_time': time.time(),
            'created_at': datetime.utcnow()
        }
        
        # Save job to database
        job = ProcessingJob(
            id=job_id,
            dataset_id=dataset_id,
            status='processing'
        )
        db.session.add(job)
        db.session.commit()
        
        # Start processing in background thread
        thread = threading.Thread(
            target=_process_dataset_background,
            args=(job_id, dataset_id, steps)
        )
        thread.daemon = True
        thread.start()
        
        # Track preprocessing start
        session_id = get_or_create_session_id()
        track_request('start', 'preprocessing', {
            'dataset_id': dataset_id,
            'steps_count': len(steps)
        })
        
        return create_response({
            'success': True,
            'job_id': job_id,
            'message': 'Preprocessing started',
            'status_url': f'/job/{job_id}/status'
        })
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

def _process_dataset_background(job_id, dataset_id, steps):
    """Background processing function"""
    try:
        # Update progress
        processing_jobs[job_id]['progress'] = 10
        
        # Load dataset
        dataset = Dataset.query.get(dataset_id)
        df = read_dataset_file(dataset.filename)
        
        # Apply preprocessing
        preprocessor = DataPreprocessor(df)
        processing_jobs[job_id]['progress'] = 30
        
        # Apply user steps
        if steps:
            preprocessor.apply_preprocessing_steps(steps)
        
        processing_jobs[job_id]['progress'] = 70
        
        # Save processed dataset
        processed_filename = f"processed_{dataset_id}.csv"
        processed_path = os.path.join(app.config['PROCESSED_FOLDER'], processed_filename)
        preprocessor.df.to_csv(processed_path, index=False)
        
        # Generate report
        report = preprocessor.generate_report()
        
        # Update job status
        processing_jobs[job_id]['progress'] = 100
        processing_jobs[job_id]['status'] = 'completed'
        processing_jobs[job_id]['result'] = {
            'processed_file': processed_filename,
            'report': report,
            'download_url': f'/download/{processed_filename}',
            'processed_shape': preprocessor.df.shape
        }
        processing_jobs[job_id]['completed_at'] = datetime.utcnow()
        
        # Update database job
        job = ProcessingJob.query.get(job_id)
        if job:
            job.status = 'completed'
            job.progress = 100
            job.results = json.dumps(processing_jobs[job_id]['result'])
            job.completed_at = datetime.utcnow()
            db.session.commit()
        
        # Track completion
        processing_time = time.time() - processing_jobs[job_id]['start_time']
        session_id = get_or_create_session_id()
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
        # Handle error
        processing_jobs[job_id]['status'] = 'failed'
        processing_jobs[job_id]['error'] = str(e)
        processing_jobs[job_id]['completed_at'] = datetime.utcnow()
        
        # Update database job
        job = ProcessingJob.query.get(job_id)
        if job:
            job.status = 'failed'
            job.results = json.dumps({'error': str(e)})
            job.completed_at = datetime.utcnow()
            db.session.commit()

@app.route('/job/<job_id>/status', methods=['GET'])
def get_job_status(job_id):
    """Get status of a processing job"""
    if job_id not in processing_jobs:
        job = ProcessingJob.query.get(job_id)
        if not job:
            return create_response({'error': 'Job not found'}, 404)
        
        # Try to reconstruct from database
        job_data = {
            'id': job.id,
            'dataset_id': job.dataset_id,
            'status': job.status,
            'progress': job.progress,
            'created_at': job.created_at.isoformat() if job.created_at else None,
            'completed_at': job.completed_at.isoformat() if job.completed_at else None
        }
        
        if job.results:
            try:
                job_data['result'] = json.loads(job.results)
            except:
                job_data['result'] = job.results
        
        return create_response(job_data)
    
    job_data = processing_jobs[job_id].copy()
    
    # Convert datetime objects to strings for JSON serialization
    if 'created_at' in job_data and isinstance(job_data['created_at'], datetime):
        job_data['created_at'] = job_data['created_at'].isoformat()
    if 'completed_at' in job_data and isinstance(job_data['completed_at'], datetime):
        job_data['completed_at'] = job_data['completed_at'].isoformat()
    
    return create_response(job_data)

@app.route('/dataset/<dataset_id>/compare', methods=['POST'])
def compare_models(dataset_id):
    """Compare models before and after preprocessing"""
    try:
        dataset = Dataset.query.get(dataset_id)
        if not dataset:
            return create_response({'error': 'Dataset not found'}, 404)
        
        data = request.json or {}
        processed_file = data.get('processed_file')
        target_column = data.get('target_column')
        
        if not processed_file:
            return create_response({'error': 'Processed file not specified'}, 400)
        
        # Load original dataset
        original_df = read_dataset_file(dataset.filename)
        
        # Load processed dataset
        processed_path = os.path.join(app.config['PROCESSED_FOLDER'], processed_file)
        if not os.path.exists(processed_path):
            return create_response({'error': 'Processed file not found'}, 404)
        
        processed_df = pd.read_csv(processed_path)
        
        # Compare models
        comparator = ModelComparator()
        comparison_result = comparator.compare_datasets(
            original_df, processed_df, target_column
        )
        
        if comparison_result['status'] == 'error':
            return create_response({'error': comparison_result.get('error', 'Comparison failed')}, 500)
        
        # Track comparison
        session_id = get_or_create_session_id()
        analytics.track_dataset_action(
            session_id=session_id,
            dataset_id=dataset_id,
            action='compare',
            processing_time=1.0,  # Estimate
            rows=len(original_df),
            columns=len(original_df.columns)
        )
        
        return create_response({
            'success': True,
            'comparison': comparison_result['comparison'],
            'problem_type': comparison_result['problem_type'],
            'target_column': comparison_result['target_column'],
            'original_shape': comparison_result['original_data_shape'],
            'processed_shape': comparison_result['processed_data_shape']
        })
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    """Download a file"""
    try:
        # Check in processed folder first
        filepath = os.path.join(app.config['PROCESSED_FOLDER'], filename)
        if not os.path.exists(filepath):
            # Check in uploads folder
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            if not os.path.exists(filepath):
                return create_response({'error': 'File not found'}, 404)
        
        # Track download
        session_id = get_or_create_session_id()
        track_request('download', 'file_download', {'filename': filename})
        
        # Extract dataset ID from filename for tracking
        if filename.startswith('processed_'):
            dataset_id = filename.replace('processed_', '').replace('.csv', '')
            analytics.track_dataset_action(
                session_id=session_id,
                dataset_id=dataset_id,
                action='download'
            )
        
        return send_file(filepath, as_attachment=True)
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

# ==================== ANALYTICS ENDPOINTS ====================

@app.route('/api/analytics/dashboard', methods=['GET'])
def get_analytics_dashboard():
    """Get analytics dashboard data (requires admin token)"""
    try:
        # Simple authentication (in production, use proper auth)
        auth_token = request.headers.get('X-Admin-Token')
        if not auth_token or auth_token != 'admin123':  # CHANGE THIS IN PRODUCTION
            return create_response({'error': 'Unauthorized'}, 401)
        
        # Get stats
        stats = analytics.get_dashboard_stats(days=30)
        
        # Get recent jobs from database
        recent_jobs = ProcessingJob.query.order_by(
            ProcessingJob.created_at.desc()
        ).limit(10).all()
        
        jobs_data = []
        for job in recent_jobs:
            jobs_data.append({
                'id': job.id[:8],
                'dataset_id': job.dataset_id[:8] if job.dataset_id else None,
                'status': job.status,
                'progress': job.progress,
                'created_at': job.created_at.isoformat() if job.created_at else None,
                'completed_at': job.completed_at.isoformat() if job.completed_at else None
            })
        
        return create_response({
            'success': True,
            'stats': stats,
            'recent_jobs': jobs_data,
            'total_datasets_db': Dataset.query.count(),
            'total_jobs_db': ProcessingJob.query.count(),
            'generated_at': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

@app.route('/api/analytics/export', methods=['GET'])
def export_analytics():
    """Export analytics data as CSV (requires admin token)"""
    try:
        # Simple authentication
        auth_token = request.headers.get('X-Admin-Token')
        if not auth_token or auth_token != 'admin123':  # CHANGE THIS IN PRODUCTION
            return create_response({'error': 'Unauthorized'}, 401)
        
        # Get format parameter
        format_type = request.args.get('format', 'csv')
        
        # Export data
        exported_data = analytics.export_analytics(format=format_type)
        
        if not exported_data:
            return create_response({'error': 'No data to export'}, 404)
        
        if format_type == 'csv':
            response = make_response(exported_data)
            response.headers['Content-Type'] = 'text/csv'
            response.headers['Content-Disposition'] = \
                f'attachment; filename=analytics_export_{datetime.utcnow().strftime("%Y%m%d_%H%M%S")}.csv'
            return response
        
        elif format_type == 'json':
            return create_response(json.loads(exported_data))
        
        else:
            return create_response({'data': exported_data})
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

@app.route('/api/analytics/cleanup', methods=['POST'])
def cleanup_analytics():
    """Clean up old analytics data (requires admin token)"""
    try:
        # Simple authentication
        auth_token = request.headers.get('X-Admin-Token')
        if not auth_token or auth_token != 'admin123':  # CHANGE THIS IN PRODUCTION
            return create_response({'error': 'Unauthorized'}, 401)
        
        data = request.json or {}
        days = data.get('days', 90)
        
        success = analytics.cleanup_old_data(days=days)
        
        if success:
            return create_response({
                'success': True,
                'message': f'Cleaned up data older than {days} days'
            })
        else:
            return create_response({'error': 'Cleanup failed'}, 500)
        
    except Exception as e:
        return create_response({'error': str(e)}, 500)

@app.route('/api/track', methods=['POST'])
def track_event():
    """Track custom events from frontend"""
    try:
        data = request.json or {}
        session_id = data.get('session_id', get_or_create_session_id())
        page = data.get('page', 'unknown')
        action = data.get('action')
        details = data.get('details', {})
        
        success = analytics.track_page_view(session_id, page, action, details)
        
        response_data = {'success': success, 'session_id': session_id}
        
        # Set session cookie if new session
        response = jsonify(response_data)
        if not request.cookies.get('session_id'):
            response.set_cookie('session_id', session_id, max_age=30*24*60*60)
        
        return response, 200
        
    except Exception as e:
        return create_response({'success': False, 'error': str(e)}, 400)

# ==================== ERROR HANDLERS ====================

@app.errorhandler(404)
def not_found(error):
    return create_response({'error': 'Not found'}, 404)

@app.errorhandler(500)
def internal_error(error):
    return create_response({'error': 'Internal server error'}, 500)

@app.errorhandler(413)
def too_large(error):
    return create_response({'error': 'File too large (max 100MB)'}, 413)

# ==================== MAIN EXECUTION ====================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
