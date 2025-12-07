import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder
import json

class DataPreprocessor:
    def __init__(self, df):
        self.original_df = df.copy()
        self.df = df.copy()
        self.steps = []
        self.report = {
            'original_shape': self.original_df.shape,
            'processed_shape': None,
            'steps_applied': [],
            'columns_removed': [],
            'duplicates_removed': 0,
            'missing_values_filled': {},
            'outliers_removed': {},
            'encodings_applied': {}
        }
    
    def generate_report(self):
        """Generate preprocessing report"""
        self.report['processed_shape'] = self.df.shape
        self.report['steps_applied'] = self.steps
        return self.report
    
    def get_column_info(self):
        """Get information about each column"""
        column_info = []
        
        for col in self.df.columns:
            col_data = self.df[col]
            col_info = {
                'name': col,
                'type': str(col_data.dtype),
                'missing': int(col_data.isnull().sum()),
                'missing_percent': round((col_data.isnull().sum() / len(col_data)) * 100, 2),
                'unique': int(col_data.nunique()),
                'sample_values': col_data.dropna().head(5).tolist() if col_data.nunique() > 0 else [],
                'suggested_actions': []
            }
            
            # Suggest actions based on column characteristics
            if col_info['missing_percent'] > 50:
                col_info['suggested_actions'].append('drop_column')
            elif col_info['missing_percent'] > 0:
                col_info['suggested_actions'].append('fill_missing')
            
            if col_data.dtype == 'object' and col_info['unique'] < 20:
                col_info['suggested_actions'].extend(['label_encode', 'onehot_encode'])
            
            if col_data.dtype in ['int64', 'float64']:
                col_info['suggested_actions'].append('remove_outliers')
                if col_info['unique'] < 10:
                    col_info['suggested_actions'].append('convert_to_categorical')
            
            column_info.append(col_info)
        
        return column_info
    
    def drop_high_missing_columns(self, threshold=0.5):
        """Drop columns with more than threshold% missing values"""
        missing_percent = self.df.isnull().sum() / len(self.df)
        cols_to_drop = missing_percent[missing_percent > threshold].index.tolist()
        
        if cols_to_drop:
            self.df = self.df.drop(columns=cols_to_drop)
            self.steps.append({
                'step': 'drop_high_missing',
                'details': f'Dropped {len(cols_to_drop)} columns with >{threshold*100}% missing values',
                'columns': cols_to_drop
            })
            self.report['columns_removed'].extend(cols_to_drop)
        
        return self.df
    
    def remove_duplicates(self):
        """Remove duplicate rows"""
        duplicates_count = self.df.duplicated().sum()
        
        if duplicates_count > 0:
            self.df = self.df.drop_duplicates()
            self.steps.append({
                'step': 'remove_duplicates',
                'details': f'Removed {duplicates_count} duplicate rows'
            })
            self.report['duplicates_removed'] = duplicates_count
        
        return self.df
    
    def change_data_type(self, column, new_type):
        """Change data type of a column"""
        if column not in self.df.columns:
            raise ValueError(f"Column '{column}' not found")
        
        try:
            if new_type == 'numeric':
                self.df[column] = pd.to_numeric(self.df[column], errors='coerce')
            elif new_type == 'integer':
                self.df[column] = pd.to_numeric(self.df[column], errors='coerce').astype('Int64')
            elif new_type == 'float':
                self.df[column] = pd.to_numeric(self.df[column], errors='coerce').astype(float)
            elif new_type == 'datetime':
                self.df[column] = pd.to_datetime(self.df[column], errors='coerce')
            elif new_type == 'string':
                self.df[column] = self.df[column].astype(str)
            elif new_type == 'category':
                self.df[column] = self.df[column].astype('category')
            
            self.steps.append({
                'step': 'change_data_type',
                'details': f'Changed {column} to {new_type}',
                'column': column,
                'new_type': new_type
            })
            
            return self.df
            
        except Exception as e:
            raise ValueError(f"Failed to convert {column} to {new_type}: {str(e)}")
    
    def fill_missing_values(self, column, method='mean', custom_value=None):
        """Fill missing values in a column"""
        if column not in self.df.columns:
            raise ValueError(f"Column '{column}' not found")
        
        missing_count = self.df[column].isnull().sum()
        
        if missing_count == 0:
            return self.df
        
        if method == 'mean' and self.df[column].dtype in ['int64', 'float64']:
            fill_value = self.df[column].mean()
        elif method == 'median' and self.df[column].dtype in ['int64', 'float64']:
            fill_value = self.df[column].median()
        elif method == 'mode':
            mode_result = self.df[column].mode()
            fill_value = mode_result[0] if not mode_result.empty else None
        elif method == 'custom' and custom_value is not None:
            fill_value = custom_value
        elif method == 'forward_fill':
            self.df[column] = self.df[column].ffill()
            fill_value = None
        elif method == 'backward_fill':
            self.df[column] = self.df[column].bfill()
            fill_value = None
        else:
            fill_value = 0 if self.df[column].dtype in ['int64', 'float64'] else ''
        
        if fill_value is not None:
            self.df[column] = self.df[column].fillna(fill_value)
        
        self.steps.append({
            'step': 'fill_missing',
            'details': f'Filled {missing_count} missing values in {column} with {method}',
            'column': column,
            'method': method,
            'missing_count': missing_count,
            'fill_value': str(fill_value) if fill_value is not None else 'N/A'
        })
        
        if column not in self.report['missing_values_filled']:
            self.report['missing_values_filled'][column] = []
        
        self.report['missing_values_filled'][column].append({
            'method': method,
            'count': missing_count,
            'value': str(fill_value) if fill_value is not None else 'N/A'
        })
        
        return self.df
    
    def remove_outliers(self, column, method='iqr'):
        """Remove outliers from a column using IQR method"""
        if column not in self.df.columns or self.df[column].dtype not in ['int64', 'float64']:
            return self.df
        
        Q1 = self.df[column].quantile(0.25)
        Q3 = self.df[column].quantile(0.75)
        IQR = Q3 - Q1
        
        lower_bound = Q1 - 1.5 * IQR
        upper_bound = Q3 + 1.5 * IQR
        
        outliers = self.df[(self.df[column] < lower_bound) | (self.df[column] > upper_bound)]
        outlier_count = len(outliers)
        
        if outlier_count > 0:
            original_len = len(self.df)
            self.df = self.df[(self.df[column] >= lower_bound) & (self.df[column] <= upper_bound)]
            removed = original_len - len(self.df)
            
            self.steps.append({
                'step': 'remove_outliers',
                'details': f'Removed {removed} outliers from {column} using IQR method',
                'column': column,
                'method': method,
                'removed_count': removed,
                'lower_bound': round(lower_bound, 2),
                'upper_bound': round(upper_bound, 2)
            })
            
            self.report['outliers_removed'][column] = removed
        
        return self.df
    
    def encode_categorical(self, column, method='label'):
        """Encode categorical columns"""
        if column not in self.df.columns or self.df[column].dtype != 'object':
            raise ValueError(f"Column '{column}' is not categorical")
        
        if method == 'label':
            encoder = LabelEncoder()
            self.df[column] = encoder.fit_transform(self.df[column].astype(str))
            encoding_type = 'Label Encoding'
            mapping = dict(zip(encoder.classes_, encoder.transform(encoder.classes_)))
        
        elif method == 'onehot':
            # For one-hot encoding, we need to handle it differently
            # This is a simplified version
            dummies = pd.get_dummies(self.df[column], prefix=column, dummy_na=True)
            self.df = pd.concat([self.df.drop(columns=[column]), dummies], axis=1)
            encoding_type = 'One-Hot Encoding'
            mapping = {f"{column}_{val}": val for val in dummies.columns}
        
        self.steps.append({
            'step': 'encode_categorical',
            'details': f'Applied {encoding_type} to {column}',
            'column': column,
            'method': method,
            'encoding_type': encoding_type
        })
        
        self.report['encodings_applied'][column] = {
            'method': method,
            'type': encoding_type,
            'mapping': mapping if method == 'label' else list(mapping.keys())
        }
        
        return self.df
    
    def apply_preprocessing_steps(self, steps):
        """Apply a list of preprocessing steps"""
        for step in steps:
            action = step.get('action')
            column = step.get('column')
            method = step.get('method')
            value = step.get('value')
            
            if action == 'change_type':
                self.change_data_type(column, method)
            elif action == 'fill_missing':
                self.fill_missing_values(column, method, value)
            elif action == 'encode':
                self.encode_categorical(column, method)
            elif action == 'remove_outliers':
                self.remove_outliers(column)
            elif action == 'drop_column':
                if column in self.df.columns:
                    self.df = self.df.drop(columns=[column])
                    self.steps.append({
                        'step': 'drop_column',
                        'details': f'Dropped column: {column}',
                        'column': column
                    })
        
        # Apply automatic steps at the end
        self.drop_high_missing_columns(threshold=0.5)
        self.remove_duplicates()
        
        return self.df