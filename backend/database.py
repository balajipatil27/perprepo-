from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import uuid

db = SQLAlchemy()

class Dataset(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = db.Column(db.String(500), nullable=False)
    original_filename = db.Column(db.String(500), nullable=False)
    file_size = db.Column(db.Integer)
    upload_time = db.Column(db.DateTime, default=datetime.utcnow)
    processed = db.Column(db.Boolean, default=False)
    preprocessing_steps = db.Column(db.Text, default='[]')
    
    def __repr__(self):
        return f"<Dataset {self.original_filename}>"

class ProcessingJob(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    dataset_id = db.Column(db.String(36))
    status = db.Column(db.String(20), default='pending')  # pending, processing, completed, failed
    progress = db.Column(db.Integer, default=0)
    results = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime)
    
    def __repr__(self):
        return f"<ProcessingJob {self.id} - {self.status}>"