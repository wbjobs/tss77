import numpy as np
from scipy.spatial.distance import euclidean


def dtw_distance(ts1, ts2, window=None):
    n, m = len(ts1), len(ts2)
    if window is None:
        window = max(n, m)
    window = max(window, abs(n - m))

    dtw_matrix = np.full((n + 1, m + 1), np.inf)
    dtw_matrix[0, 0] = 0

    for i in range(1, n + 1):
        for j in range(max(1, i - window), min(m + 1, i + window + 1)):
            cost = abs(ts1[i - 1] - ts2[j - 1])
            dtw_matrix[i, j] = cost + min(
                dtw_matrix[i - 1, j],
                dtw_matrix[i, j - 1],
                dtw_matrix[i - 1, j - 1]
            )

    return dtw_matrix[n, m]


def normalize(ts):
    ts = np.array(ts, dtype=np.float64)
    mean = np.mean(ts)
    std = np.std(ts)
    if std == 0:
        return np.zeros_like(ts)
    return (ts - mean) / std


def find_matches(time_series, template, threshold=None, top_k=10, step=1):
    if len(template) >= len(time_series):
        return []

    ts_norm = normalize(time_series)
    template_norm = normalize(template)

    template_len = len(template)
    ts_len = len(time_series)

    matches = []
    distances = []

    for i in range(0, ts_len - template_len + 1, step):
        segment = ts_norm[i:i + template_len]
        dist = dtw_distance(segment, template_norm)
        distances.append((i, dist))

    distances.sort(key=lambda x: x[1])

    if threshold is not None:
        distances = [(idx, d) for idx, d in distances if d <= threshold]

    top_matches = distances[:top_k]

    used_indices = set()
    for start_idx, dist in top_matches:
        overlap = False
        for used_start in used_indices:
            if abs(start_idx - used_start) < template_len * 0.5:
                overlap = True
                break
        if not overlap:
            used_indices.add(start_idx)
            matches.append({
                'start_index': start_idx,
                'end_index': start_idx + template_len - 1,
                'distance': float(dist),
                'similarity': float(1.0 / (1.0 + dist))
            })

    return matches


def sliding_window_dtw(time_series, template_length, threshold=None, top_k=10, step=5):
    if template_length >= len(time_series):
        return []

    ts_norm = normalize(time_series)
    ts_len = len(time_series)

    windows = []
    for i in range(0, ts_len - template_length + 1, step):
        windows.append((i, ts_norm[i:i + template_length]))

    distances = []
    for i, (idx1, w1) in enumerate(windows):
        for j, (idx2, w2) in enumerate(windows):
            if j <= i:
                continue
            if abs(idx1 - idx2) < template_length:
                continue
            dist = dtw_distance(w1, w2)
            if threshold is None or dist <= threshold:
                distances.append({
                    'start1': idx1,
                    'end1': idx1 + template_length - 1,
                    'start2': idx2,
                    'end2': idx2 + template_length - 1,
                    'distance': float(dist),
                    'similarity': float(1.0 / (1.0 + dist))
                })

    distances.sort(key=lambda x: x['distance'])
    return distances[:top_k]
