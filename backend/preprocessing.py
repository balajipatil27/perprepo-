import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder, OneHotEncoder
import json

class DataPreprocessor:
    def __init__(self, df):
        self.df = df.copy()
        self.original_df = df.copy()
        self.steps = []
        self.report = {}
        
    def generate_report(self):
        report = {
            'original_shape': self.original_df.shape,
            'processed_shape': self.df.shape,
            'columns_dropped': len(self.original_df.columns) - len(self.df.columns),
            'duplicates_removed': len(self.original_df) - len(self.df),
            'steps': self.steps,
            'missing_values_before': self.original_df.isnull().sum().to_dict(),
            'missing_values_after': self.df.isnull().sum().to_dict(),
            'data_types': self.df.dtypes.astype(str).to_dict()
        }
        return report
    
    def drop_high_missing_columns(self, threshold=0.5):
        """Drop columns with more than threshold% missing values"""
        original_cols = len(self.df.columns)
        missing_percent = self.df.isnull().sum() / len(self.df)
        cols_to_drop = missing_percent[missing_percent > threshold].index.tolist()
        
        if cols_to_drop:
            self.df = self.df.drop(columns=cols_to_drop)
            self.steps.append({
                'step': 'drop_high_missing',
                'details': f'Dropped {len(cols_to_drop)} columns with >{threshold*100}% missing values',
                'columns': cols_to_drop
            })
            
        return self.df
    
    def remove_duplicates(self):
        """Remove duplicate rows"""
        duplicates = self.df.duplicated().sum()
        if duplicates > 0:
            self.df = self.df.drop_duplicates()
            self.steps.append({
                'step': 'remove_duplicates',
                'details': f'Removed {duplicates} duplicate rows'
            })
        return self.df
    
    def change_data_type(self, column, new_type):
        """Change data type of a specific column"""
        if column in self.df.columns:
            try:
                if new_type == 'numeric':
                    self.df[column] = pd.to_numeric(self.df[column], errors='coerce')
                elif new_type == 'datetime':
                    self.df[column] = pd.to_datetime(self.df[column], errors='coerce')
                elif new_type == 'string':
                    self.df[column] = self.df[column].astype(str)
                    
                self.steps.append({
                    'step': 'change_data_type',
                    'details': f'Changed {column} to {new_type}',
                    'column': column,
                    'new_type': new_type
                })
            except Exception as e:
                raise ValueError(f"Failed to convert {column} to {new_type}: {str(e)}")
        return self.df
    
    def handle_missing_values(self, column, method='mean'):
        """Fill missing values with mean, median, or mode"""
        if column in self.df.columns:
            if method == 'mean':
                fill_value = self.df[column].mean()
            elif method == 'median':
                fill_value = self.df[column].median()
            elif method == 'mode':
                fill_value = self.df[column].mode()[0] if not self.df[column].mode().empty else 0
            else:
                fill_value = method
                
            missing_count = self.df[column].isnull().sum()
            self.df[column] = self.df[column].fillna(fill_value)
            
            self.steps.append({
                'step': 'fill_missing',
                'details': f'Filled {missing_count} missing values in {column} with {method}',
                'column': column,
                'method': method,
                'missing_count': int(missing_count)
            })
        return self.df
    
    def remove_outliers(self, column, method='iqr'):
        """Remove outliers using IQR method"""
        if column in self.df.columns and self.df[column].dtype in ['int64', 'float64']:
            Q1 = self.df[column].quantile(0.25)
            Q3 = self.df[column].quantile(0.75)
            IQR = Q3 - Q1
            
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            
            outliers = self.df[(self.df[column] < lower_bound) | (self.df[column] > upper_bound)]
            original_len = len(self.df)
            self.df = self.df[(self.df[column] >= lower_bound) & (self.df[column] <= upper_bound)]
            
            removed = original_len - len(self.df)
            if removed > 0:
                self.steps.append({
                    'step': 'remove_outliers',
                    'details': f'Removed {removed} outliers from {column} using IQR method',
                    'column': column,
                    'method': method,
                    'removed_count': int(removed)
                })
        return self.df
    
    def encode_categorical(self, column, method='label'):
        """Apply label encoding or one-hot encoding to categorical columns"""
        if column in self.df.columns:
            if method == 'label':
                encoder = LabelEncoder()
                self.df[column] = encoder.fit_transform(self.df[column])
                encoding_type = 'Label Encoding'
            elif method == 'onehot':
                encoded = pd.get_dummies(self.df[column], prefix=column)
                self.df = pd.concat([self.df.drop(columns=[column]), encoded], axis=1)
                encoding_type = 'One-Hot Encoding'
            
            self.steps.append({
                'step': 'encode_categorical',
                'details': f'Applied {encoding_type} to {column}',
                'column': column,
                'method': method
            })
        return self.df
    
    def get_column_info(self):
        """Get information about each column"""
        info = []
        for col in self.df.columns:
            col_info = {
                'name': col,
                'type': str(self.df[col].dtype),
                'missing': int(self.df[col].isnull().sum()),
                'unique': int(self.df[col].nunique()),
                'suggested_actions': []
            }
            
            # Suggest actions based on column type
            if self.df[col].isnull().sum() > 0:
                col_info['suggested_actions'].append('fill_missing')
            
            if self.df[col].dtype == 'object' and self.df[col].nunique() < 20:
                col_info['suggested_actions'].extend(['label_encode', 'onehot_encode'])
            
            if self.df[col].dtype in ['int64', 'float64']:
                col_info['suggested_actions'].append('remove_outliers')
            
            info.append(col_info)
        
        return info