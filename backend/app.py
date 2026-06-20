from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import sys

sys.path.append(os.path.dirname(__file__))

from data_manager import (
    init_db, create_dataset, delete_dataset, get_time_series,
    get_datasets, get_dataset_info, save_match_result,
    get_match_results, generate_sample_data, insert_time_series
)
from dtw_matcher import find_matches, normalize

app = Flask(__name__)
CORS(app)

init_db()


@app.route('/api/datasets', methods=['GET'])
def list_datasets():
    datasets = get_datasets()
    return jsonify({'success': True, 'datasets': datasets})


@app.route('/api/datasets', methods=['POST'])
def create_new_dataset():
    data = request.json
    name = data.get('name')
    description = data.get('description', '')

    if not name:
        return jsonify({'success': False, 'error': 'Name is required'}), 400

    dataset_id = create_dataset(name, description)
    return jsonify({'success': True, 'dataset_id': dataset_id})


@app.route('/api/datasets/<int:dataset_id>', methods=['DELETE'])
def remove_dataset(dataset_id):
    delete_dataset(dataset_id)
    return jsonify({'success': True})


@app.route('/api/datasets/<int:dataset_id>', methods=['GET'])
def dataset_detail(dataset_id):
    info = get_dataset_info(dataset_id)
    if not info:
        return jsonify({'success': False, 'error': 'Dataset not found'}), 404
    return jsonify({'success': True, 'dataset': info})


@app.route('/api/datasets/<int:dataset_id>/data', methods=['GET'])
def get_data(dataset_id):
    start = request.args.get('start', type=float)
    end = request.args.get('end', type=float)

    data = get_time_series(dataset_id, start, end)
    return jsonify({
        'success': True,
        'timestamps': data['timestamps'],
        'values': data['values'],
        'count': len(data['timestamps'])
    })


@app.route('/api/datasets/<int:dataset_id>/data', methods=['POST'])
def upload_data(dataset_id):
    data = request.json
    timestamps = data.get('timestamps', [])
    values = data.get('values', [])

    if not timestamps or not values:
        return jsonify({'success': False, 'error': 'timestamps and values are required'}), 400

    if len(timestamps) != len(values):
        return jsonify({'success': False, 'error': 'timestamps and values must have same length'}), 400

    insert_time_series(dataset_id, timestamps, values)
    return jsonify({'success': True, 'count': len(timestamps)})


@app.route('/api/datasets/<int:dataset_id>/match', methods=['POST'])
def match_pattern(dataset_id):
    data = request.json
    template_values = data.get('template', [])
    template_timestamps = data.get('template_timestamps', [])
    threshold = data.get('threshold')
    top_k = data.get('top_k', 10)
    step = data.get('step', 1)
    amplitude_tolerance = data.get('amplitude_tolerance')
    template_name = data.get('template_name', '')

    if not template_values:
        return jsonify({'success': False, 'error': '模板数据不能为空'}), 400

    if len(template_values) < 5:
        return jsonify({'success': False, 'error': '模板数据点过少，至少需要5个点'}), 400

    try:
        template_values = [float(v) for v in template_values]
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': '模板数据包含无效数值'}), 400

    if any(not (float('-inf') < v < float('inf')) for v in template_values):
        return jsonify({'success': False, 'error': '模板数据包含无效数值'}), 400

    all_same = all(v == template_values[0] for v in template_values)
    if all_same:
        return jsonify({'success': False, 'error': '模板数据无变化，无法进行匹配'}), 400

    if not isinstance(top_k, int) or top_k < 1:
        return jsonify({'success': False, 'error': '最大匹配数必须是正整数'}), 400

    if not isinstance(step, int) or step < 1:
        return jsonify({'success': False, 'error': '步长必须是正整数'}), 400

    if threshold is not None:
        try:
            threshold = float(threshold)
            if threshold < 0:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': '距离阈值无效'}), 400

    if amplitude_tolerance is not None:
        try:
            amplitude_tolerance = float(amplitude_tolerance)
            if amplitude_tolerance < 0 or amplitude_tolerance > 1000:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': '幅度偏差百分比无效（0-1000）'}), 400

    ts_data = get_time_series(dataset_id)
    if not ts_data['values']:
        return jsonify({'success': False, 'error': '数据集中无数据'}), 400

    if len(template_values) >= len(ts_data['values']):
        return jsonify({'success': False, 'error': '模板长度不能大于等于时序数据总长度'}), 400

    matches = find_matches(
        ts_data['values'],
        template_values,
        threshold=threshold,
        top_k=top_k,
        step=step,
        amplitude_tolerance=amplitude_tolerance
    )

    template_min = min(template_values)
    template_max = max(template_values)

    results = []
    for match in matches:
        result = {
            'start_index': match['start_index'],
            'end_index': match['end_index'],
            'start_time': ts_data['timestamps'][match['start_index']],
            'end_time': ts_data['timestamps'][match['end_index']],
            'distance': match['distance'],
            'similarity': match['similarity'],
            'values': ts_data['values'][match['start_index']:match['end_index'] + 1]
        }
        if amplitude_tolerance is not None:
            result['segment_min'] = match.get('segment_min')
            result['segment_max'] = match.get('segment_max')
            result['template_min'] = template_min
            result['template_max'] = template_max
            result['amplitude_tolerance'] = amplitude_tolerance
        results.append(result)

    if template_name:
        save_match_result(dataset_id, template_name, results)

    response = {
        'success': True,
        'matches': results,
        'count': len(results),
        'template_length': len(template_values),
        'template_min': template_min,
        'template_max': template_max
    }
    if amplitude_tolerance is not None:
        response['amplitude_tolerance'] = amplitude_tolerance
        tolerance_range = (template_max - template_min) * amplitude_tolerance / 100
        response['allowed_min'] = template_min - tolerance_range
        response['allowed_max'] = template_max + tolerance_range

    return jsonify(response)


@app.route('/api/datasets/<int:dataset_id>/match-results', methods=['GET'])
def list_match_results(dataset_id):
    results = get_match_results(dataset_id)
    return jsonify({'success': True, 'results': results})


@app.route('/api/generate-sample', methods=['POST'])
def generate_sample():
    data = request.json or {}
    name = data.get('name', 'sample_data')
    dataset_id = generate_sample_data(name)
    return jsonify({'success': True, 'dataset_id': dataset_id})


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Time series pattern matching API is running'})


if __name__ == '__main__':
    sample_exists = any(d['name'] == 'sample_data' for d in get_datasets())
    if not sample_exists:
        generate_sample_data()

    app.run(host='0.0.0.0', port=5000, debug=True)
