import sqlite3
import json
import os
import numpy as np
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'timeseries.db')


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS datasets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            data_count INTEGER DEFAULT 0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS time_series_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_id INTEGER NOT NULL,
            timestamp REAL NOT NULL,
            value REAL NOT NULL,
            FOREIGN KEY (dataset_id) REFERENCES datasets(id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS match_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dataset_id INTEGER NOT NULL,
            template_name TEXT,
            match_data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (dataset_id) REFERENCES datasets(id)
        )
    ''')

    conn.commit()
    conn.close()


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_dataset(name, description=''):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO datasets (name, description) VALUES (?, ?)',
        (name, description)
    )
    dataset_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return dataset_id


def delete_dataset(dataset_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM time_series_points WHERE dataset_id = ?', (dataset_id,))
    cursor.execute('DELETE FROM match_results WHERE dataset_id = ?', (dataset_id,))
    cursor.execute('DELETE FROM datasets WHERE id = ?', (dataset_id,))
    conn.commit()
    conn.close()


def insert_time_series(dataset_id, timestamps, values):
    if len(timestamps) != len(values):
        raise ValueError("timestamps and values must have the same length")

    conn = get_db_connection()
    cursor = conn.cursor()

    data = [(dataset_id, float(t), float(v)) for t, v in zip(timestamps, values)]
    cursor.executemany(
        'INSERT INTO time_series_points (dataset_id, timestamp, value) VALUES (?, ?, ?)',
        data
    )

    cursor.execute(
        'UPDATE datasets SET data_count = data_count + ? WHERE id = ?',
        (len(values), dataset_id)
    )

    conn.commit()
    conn.close()


def get_time_series(dataset_id, start_time=None, end_time=None):
    conn = get_db_connection()
    cursor = conn.cursor()

    query = 'SELECT timestamp, value FROM time_series_points WHERE dataset_id = ?'
    params = [dataset_id]

    if start_time is not None:
        query += ' AND timestamp >= ?'
        params.append(float(start_time))
    if end_time is not None:
        query += ' AND timestamp <= ?'
        params.append(float(end_time))

    query += ' ORDER BY timestamp ASC'

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    timestamps = [row['timestamp'] for row in rows]
    values = [row['value'] for row in rows]

    return {'timestamps': timestamps, 'values': values}


def get_datasets():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, description, created_at, data_count FROM datasets ORDER BY created_at DESC')
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            'id': row['id'],
            'name': row['name'],
            'description': row['description'],
            'created_at': row['created_at'],
            'data_count': row['data_count']
        }
        for row in rows
    ]


def get_dataset_info(dataset_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM datasets WHERE id = ?', (dataset_id,))
    row = cursor.fetchone()
    conn.close()

    if row is None:
        return None

    return {
        'id': row['id'],
        'name': row['name'],
        'description': row['description'],
        'created_at': row['created_at'],
        'data_count': row['data_count']
    }


def save_match_result(dataset_id, template_name, match_data):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO match_results (dataset_id, template_name, match_data) VALUES (?, ?, ?)',
        (dataset_id, template_name, json.dumps(match_data))
    )
    result_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return result_id


def get_match_results(dataset_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT id, template_name, match_data, created_at FROM match_results WHERE dataset_id = ? ORDER BY created_at DESC',
        (dataset_id,)
    )
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            'id': row['id'],
            'template_name': row['template_name'],
            'match_data': json.loads(row['match_data']),
            'created_at': row['created_at']
        }
        for row in rows
    ]


def generate_sample_data(dataset_name='sample_data'):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('SELECT id FROM datasets WHERE name = ?', (dataset_name,))
    existing = cursor.fetchone()
    conn.close()

    if existing:
        return existing['id']

    dataset_id = create_dataset(dataset_name, 'Sample time series data with anomaly patterns')

    n_points = 5000
    timestamps = np.arange(n_points)
    values = np.zeros(n_points)

    base_trend = 50 + 0.01 * timestamps
    seasonal = 10 * np.sin(2 * np.pi * timestamps / 200) + 5 * np.sin(2 * np.pi * timestamps / 50)
    noise = np.random.normal(0, 2, n_points)

    values = base_trend + seasonal + noise

    anomaly_patterns = [
        {'start': 500, 'type': 'spike_up', 'amplitude': 30, 'duration': 20},
        {'start': 1200, 'type': 'spike_down', 'amplitude': -25, 'duration': 25},
        {'start': 2000, 'type': 'plateau', 'amplitude': 15, 'duration': 100},
        {'start': 2800, 'type': 'spike_up', 'amplitude': 35, 'duration': 18},
        {'start': 3500, 'type': 'dip', 'amplitude': -20, 'duration': 60},
        {'start': 4200, 'type': 'spike_up', 'amplitude': 28, 'duration': 22},
        {'start': 600, 'type': 'spike_up', 'amplitude': 32, 'duration': 19},
        {'start': 1500, 'type': 'dip', 'amplitude': -18, 'duration': 55},
        {'start': 2300, 'type': 'spike_down', 'amplitude': -30, 'duration': 21},
        {'start': 3200, 'type': 'plateau', 'amplitude': 12, 'duration': 90},
        {'start': 4000, 'type': 'spike_up', 'amplitude': 33, 'duration': 17},
        {'start': 4700, 'type': 'dip', 'amplitude': -22, 'duration': 50},
    ]

    for pattern in anomaly_patterns:
        start = pattern['start']
        duration = pattern['duration']
        amplitude = pattern['amplitude']
        ptype = pattern['type']

        if ptype in ['spike_up', 'spike_down']:
            x = np.linspace(0, np.pi, duration)
            shape = np.sin(x) * amplitude
        elif ptype == 'plateau':
            shape = np.full(duration, amplitude)
            edge = min(10, duration // 4)
            shape[:edge] = np.linspace(0, amplitude, edge)
            shape[-edge:] = np.linspace(amplitude, 0, edge)
        elif ptype == 'dip':
            x = np.linspace(0, 2 * np.pi, duration)
            shape = (np.cos(x) - 1) * (amplitude / 2)
        else:
            shape = np.full(duration, amplitude)

        end = min(start + duration, n_points)
        values[start:end] += shape[:end - start]

    insert_time_series(dataset_id, timestamps.tolist(), values.tolist())

    return dataset_id
