import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score, mean_absolute_error
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
        self.models_info = {
            'Linear Regression': {
                'type': 'regression',
                'description': 'Linear model for regression'
            },
            'Logistic Regression': {
                'type': 'classification',
                'description': 'Linear model for classification'
            },
            'Random Forest': {
                'type': 'both',
                'description': 'Ensemble of decision trees'
            },
            'Decision Tree': {
                'type': 'both',
                'description': 'Tree-based model'
            },
            'SVM': {
                'type': 'both',
                'description': 'Support Vector Machine'
            },
            'K-Means': {
                'type': 'clustering',
                'description': 'Clustering algorithm'
            }
        }
    
    def prepare_data(self, df, target_column=None):
        """Prepare data for modeling"""
        df = df.copy().dropna()
        
        if len(df) < 10:
            raise ValueError("Dataset too small after cleaning")
        
        # If no target column specified, try to find one
        if target_column is None or target_column not in df.columns:
            # Try to find a column with few unique values (potential target)
            unique_counts = {col: df[col].nunique() for col in df.columns}
            # Choose column with 2-20 unique values
            potential_targets = [col for col, count in unique_counts.items() if 2 <= count <= 20]
            target_column = potential_targets[0] if potential_targets else df.columns[-1]
        
        # Separate features and target
        X = df.drop(columns=[target_column])
        y = df[target_column]
        
        # Handle categorical features
        for col in X.columns:
            if X[col].dtype == 'object':
                le = LabelEncoder()
                X[col] = le.fit_transform(X[col].astype(str))
        
        # Handle categorical target
        if y.dtype == 'object' or y.nunique() < 10:
            le = LabelEncoder()
            y = le.fit_transform(y.astype(str))
            problem_type = 'classification'
        else:
            problem_type = 'regression'
        
        # Remove any remaining NaN values
        X = X.fillna(X.mean() if X.select_dtypes(include=[np.number]).shape[1] > 0 else 0)
        
        # Scale features for some models
        if problem_type == 'classification' and X.select_dtypes(include=[np.number]).shape[1] > 0:
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X.select_dtypes(include=[np.number]))
            X[X.select_dtypes(include=[np.number]).columns] = X_scaled
        
        return X, y, problem_type, target_column
    
    def evaluate_models(self, X, y, problem_type, test_size=0.2):
        """Evaluate multiple models"""
        if len(X) < 20:
            raise ValueError("Not enough data for model evaluation")
        
        results = []
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )
        
        # Define models based on problem type
        if problem_type == 'classification':
            models = [
                ('Logistic Regression', LogisticRegression(max_iter=1000)),
                ('Random Forest', RandomForestClassifier(n_estimators=100, random_state=42)),
                ('Decision Tree', DecisionTreeClassifier(random_state=42)),
                ('SVM', SVC(kernel='linear', random_state=42))
            ]
            metric_name = 'Accuracy'
            
        else:  # regression
            models = [
                ('Linear Regression', LinearRegression()),
                ('Random Forest', RandomForestRegressor(n_estimators=100, random_state=42)),
                ('Decision Tree', DecisionTreeRegressor(random_state=42)),
                ('SVM', SVR(kernel='linear'))
            ]
            metric_name = 'R² Score'
        
        # Train and evaluate each model
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
                    # Add additional metrics for regression
                    mse = mean_squared_error(y_test, y_pred)
                    mae = mean_absolute_error(y_test, y_pred)
                
                result = {
                    'model': name,
                    'score': round(score, 4),
                    'metric': metric,
                    'status': 'success'
                }
                
                if problem_type == 'regression':
                    result['mse'] = round(mse, 4)
                    result['mae'] = round(mae, 4)
                
                results.append(result)
                
            except Exception as e:
                results.append({
                    'model': name,
                    'score': 'Error',
                    'metric': str(e)[:100],
                    'status': 'error'
                })
        
        # Try K-Means clustering (for both problem types)
        try:
            # Determine optimal number of clusters
            n_clusters = min(10, len(np.unique(y)))
            if n_clusters > 1:
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                clusters = kmeans.fit_predict(X)
                
                # Calculate silhouette score if possible
                if len(np.unique(clusters)) > 1:
                    from sklearn.metrics import silhouette_score
                    try:
                        silhouette = silhouette_score(X, clusters)
                        results.append({
                            'model': 'K-Means',
                            'score': round(silhouette, 4),
                            'metric': 'Silhouette Score',
                            'status': 'success',
                            'n_clusters': n_clusters
                        })
                    except:
                        pass
                        
        except Exception as e:
            # Silently fail for K-Means
            pass
        
        return results
    
    def compare_datasets(self, original_df, processed_df, target_column=None):
        """Compare model performance between original and processed datasets"""
        try:
            # Prepare original data
            X_orig, y_orig, problem_type_orig, target_col = self.prepare_data(original_df, target_column)
            original_results = self.evaluate_models(X_orig, y_orig, problem_type_orig)
            
            # Prepare processed data
            X_proc, y_proc, problem_type_proc, _ = self.prepare_data(processed_df, target_col)
            processed_results = self.evaluate_models(X_proc, y_proc, problem_type_proc)
            
            # Create comparison table
            comparison = []
            model_names = set([r['model'] for r in original_results if r['status'] == 'success'] +
                            [r['model'] for r in processed_results if r['status'] == 'success'])
            
            for model_name in model_names:
                orig_result = next((r for r in original_results if r['model'] == model_name and r['status'] == 'success'), None)
                proc_result = next((r for r in processed_results if r['model'] == model_name and r['status'] == 'success'), None)
                
                if orig_result and proc_result:
                    try:
                        orig_score = float(orig_result['score']) if isinstance(orig_result['score'], (int, float, np.number)) else 0
                        proc_score = float(proc_result['score']) if isinstance(proc_result['score'], (int, float, np.number)) else 0
                        improvement = proc_score - orig_score
                    except:
                        improvement = 'N/A'
                    
                    comparison.append({
                        'model': model_name,
                        'original': orig_result['score'],
                        'processed': proc_result['score'],
                        'improvement': improvement if isinstance(improvement, (int, float)) else 'N/A',
                        'metric': orig_result['metric'],
                        'status': 'success'
                    })
            
            return {
                'comparison': comparison,
                'problem_type': problem_type_orig,
                'target_column': target_col,
                'original_data_shape': original_df.shape,
                'processed_data_shape': processed_df.shape,
                'status': 'success'
            }
            
        except Exception as e:
            return {
                'comparison': [],
                'problem_type': 'unknown',
                'target_column': target_column or 'unknown',
                'error': str(e),
                'status': 'error'
            }