from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Dataset(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    file_size = db.Column(db.Integer)
    upload_time = db.Column(db.DateTime, default=datetime.utcnow)
    processed = db.Column(db.Boolean, default=False)
    preprocessing_steps = db.Column(db.Text)
    
class ProcessingJob(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    dataset_id = db.Column(db.String(36), db.ForeignKey('dataset.id'))
    status = db.Column(db.String(50), default='pending')
    progress = db.Column(db.Integer, default=0)
    results = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime)