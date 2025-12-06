import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.svm import SVC, SVR
from sklearn.cluster import KMeans
from sklearn.preprocessing import LabelEncoder
import warnings
warnings.filterwarnings('ignore')

class ModelComparator:
    def __init__(self):
        self.results = {}
        
    def prepare_data(self, df, target_column=None):
        """Prepare data for modeling"""
        df = df.copy()
        
        # If no target column specified, use last column
        if target_column is None or target_column not in df.columns:
            target_column = df.columns[-1]
        
        # Separate features and target
        X = df.drop(columns=[target_column])
        y = df[target_column]
        
        # Handle categorical features
        categorical_cols = X.select_dtypes(include=['object']).columns
        for col in categorical_cols:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str))
        
        # Handle categorical target
        if y.dtype == 'object':
            le = LabelEncoder()
            y = le.fit_transform(y.astype(str))
            problem_type = 'classification'
        else:
            problem_type = 'regression'
        
        # Fill any remaining NaN values
        X = X.fillna(X.mean())
        
        return X, y, problem_type, target_column
    
    def evaluate_models(self, X, y, problem_type):
        """Evaluate multiple models"""
        models = []
        
        if problem_type == 'classification':
            models = [
                ('Logistic Regression', LogisticRegression(max_iter=1000)),
                ('Random Forest', RandomForestClassifier(n_estimators=100)),
                ('Decision Tree', DecisionTreeClassifier()),
                ('SVM', SVC(kernel='linear'))
            ]
        else:  # regression
            models = [
                ('Linear Regression', LinearRegression()),
                ('Random Forest', RandomForestRegressor(n_estimators=100)),
                ('Decision Tree', DecisionTreeRegressor()),
                ('SVM', SVR(kernel='linear'))
            ]
        
        results = []
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        for name, model in models:
            try:
                model.fit(X_train, y_train)
                y_pred = model.predict(X_test)
                
                if problem_type == 'classification':
                    score = accuracy_score(y_test, y_pred)
                    metric = 'Accuracy'
                else:
                    score = r2_score(y_test, y_pred)
                    metric = 'R² Score'
                
                results.append({
                    'model': name,
                    'score': round(score, 4),
                    'metric': metric
                })
            except Exception as e:
                results.append({
                    'model': name,
                    'score': 'Error',
                    'metric': str(e)[:100]
                })
        
        # Add K-Means for both (clustering evaluation)
        try:
            kmeans = KMeans(n_clusters=min(10, len(np.unique(y))), random_state=42)
            clusters = kmeans.fit_predict(X)
            
            # Calculate silhouette score for clustering
            from sklearn.metrics import silhouette_score
            if len(np.unique(clusters)) > 1:
                silhouette = silhouette_score(X, clusters)
                results.append({
                    'model': 'K-Means',
                    'score': round(silhouette, 4),
                    'metric': 'Silhouette Score'
                })
        except:
            pass
        
        return results