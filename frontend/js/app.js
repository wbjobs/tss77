const API_BASE = 'http://localhost:5000/api';

let currentDatasetId = null;
let timeSeriesData = { timestamps: [], values: [] };
let templateData = { timestamps: [], values: [], startIndex: 0, endIndex: 0 };
let matchResults = [];
let selectedMatchIndex = -1;
let brushSelection = null;

let mainChart = null;
let templateChart = null;
let compareChart = null;

let isBrushing = false;
let brushStartData = null;

function showToast(message, type = 'warning') {
    const icons = {
        warning: '⚠️',
        error: '❌',
        success: '✅',
        info: 'ℹ️'
    };

    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || '💬'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3000);
}

function validateTemplateData(template) {
    if (!template || !template.values || template.values.length === 0) {
        return { valid: false, reason: '模板数据为空' };
    }
    if (template.values.length < 5) {
        return { valid: false, reason: '模板数据点过少，至少需要5个点' };
    }
    if (template.values.some(v => isNaN(v) || !isFinite(v))) {
        return { valid: false, reason: '模板数据包含无效数值' };
    }
    const allSame = template.values.every(v => v === template.values[0]);
    if (allSame) {
        return { valid: false, reason: '模板数据无变化，无法进行匹配' };
    }
    return { valid: true };
}

document.addEventListener('DOMContentLoaded', function() {
    initCharts();
    loadDatasets();
    bindEvents();
});

function initCharts() {
    mainChart = echarts.init(document.getElementById('mainChart'));
    templateChart = echarts.init(document.getElementById('templateChart'));
    compareChart = echarts.init(document.getElementById('compareChart'));

    const mainOption = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' }
        },
        grid: {
            left: '50px',
            right: '20px',
            top: '30px',
            bottom: '40px'
        },
        xAxis: {
            type: 'value',
            name: '时间',
            scale: true
        },
        yAxis: {
            type: 'value',
            name: '数值',
            scale: true
        },
        dataZoom: [
            {
                type: 'inside',
                xAxisIndex: 0,
                start: 0,
                end: 100
            },
            {
                type: 'slider',
                xAxisIndex: 0,
                start: 0,
                end: 100,
                height: 20,
                bottom: 10
            }
        ],
        series: [
            {
                name: '时序数据',
                type: 'line',
                data: [],
                lineStyle: { width: 1, color: '#667eea' },
                showSymbol: false,
                sampling: 'lttb',
                large: true
            }
        ],
        brush: {
            toolbox: ['rect', 'clear'],
            brushLink: 'all',
            throttleType: 'debounce',
            throttleDelay: 300,
            xAxisIndex: 0,
            yAxisIndex: 0,
            inBrush: { symbol: 'circle' },
            outOfBrush: { symbol: 'circle' }
        },
        graphic: []
    };

    mainChart.setOption(mainOption);

    const templateOption = {
        grid: { left: '30px', right: '10px', top: '10px', bottom: '20px' },
        xAxis: { type: 'value', show: false },
        yAxis: { type: 'value', show: false, scale: true },
        series: [{
            type: 'line',
            data: [],
            lineStyle: { width: 1.5, color: '#764ba2' },
            showSymbol: false,
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(118, 75, 162, 0.3)' },
                    { offset: 1, color: 'rgba(118, 75, 162, 0.05)' }
                ])
            }
        }]
    };
    templateChart.setOption(templateOption);

    const compareOption = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' }
        },
        legend: {
            data: ['模板', '匹配片段'],
            top: 5
        },
        grid: {
            left: '50px',
            right: '20px',
            top: '40px',
            bottom: '30px'
        },
        xAxis: {
            type: 'value',
            name: '索引'
        },
        yAxis: {
            type: 'value',
            name: '数值 (归一化)'
        },
        series: [
            {
                name: '模板',
                type: 'line',
                data: [],
                lineStyle: { width: 2, color: '#764ba2' },
                showSymbol: false
            },
            {
                name: '匹配片段',
                type: 'line',
                data: [],
                lineStyle: { width: 2, color: '#52c41a' },
                showSymbol: false
            }
        ]
    };
    compareChart.setOption(compareOption);

    window.addEventListener('resize', function() {
        mainChart.resize();
        templateChart.resize();
        compareChart.resize();
    });

    mainChart.on('brushSelected', handleBrushSelected);
    mainChart.on('brushStart', function() {
        isBrushing = true;
    });
    mainChart.on('brushEnd', function(params) {
        if (!params || !params.areas || params.areas.length === 0) {
            if (isBrushing && templateData.values.length === 0) {
                showToast('请重新框选有效区域', 'warning');
            }
        }
        isBrushing = false;
    });
}

function handleBrushSelected(params) {
    if (!params || !params.batch || params.batch.length === 0) {
        if (isBrushing) {
            showToast('请重新框选有效区域', 'warning');
            isBrushing = false;
        }
        return;
    }

    const brushArea = params.batch[0];
    if (!brushArea.areas || brushArea.areas.length === 0) {
        if (isBrushing) {
            showToast('框选区域无效，请重新框选', 'warning');
            clearTemplate();
            isBrushing = false;
        }
        return;
    }

    const area = brushArea.areas[0];
    if (area.coordRange && area.coordRange.length > 0) {
        const [startX, endX] = area.coordRange[0];
        if (startX !== undefined && endX !== undefined && startX !== endX) {
            isBrushing = true;
            selectTemplateByRange(startX, endX);
        } else {
            showToast('请重新框选有效区域', 'warning');
            clearTemplate();
        }
    } else {
        if (isBrushing) {
            showToast('请重新框选有效区域', 'warning');
            clearTemplate();
        }
    }
}

function selectTemplateByRange(startTime, endTime) {
    if (!timeSeriesData.timestamps || timeSeriesData.timestamps.length === 0) {
        showToast('没有可用的时序数据', 'error');
        return false;
    }

    if (startTime === undefined || endTime === undefined || isNaN(startTime) || isNaN(endTime)) {
        showToast('请重新框选有效区域', 'warning');
        clearTemplate();
        return false;
    }

    if (startTime > endTime) {
        [startTime, endTime] = [endTime, startTime];
    }

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < timeSeriesData.timestamps.length; i++) {
        if (timeSeriesData.timestamps[i] >= startTime) {
            startIndex = i;
            break;
        }
    }

    for (let i = timeSeriesData.timestamps.length - 1; i >= 0; i--) {
        if (timeSeriesData.timestamps[i] <= endTime) {
            endIndex = i;
            break;
        }
    }

    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
        showToast('请重新框选有效区域', 'warning');
        clearTemplate();
        return false;
    }

    const pointCount = endIndex - startIndex + 1;
    if (pointCount < 5) {
        showToast('选中区域数据点过少（至少需要5个点），请扩大框选范围', 'warning');
        clearTemplate();
        return false;
    }

    const selectedValues = timeSeriesData.values.slice(startIndex, endIndex + 1);
    const validation = validateTemplateData({ values: selectedValues });
    if (!validation.valid) {
        showToast(validation.reason + '，请重新框选', 'warning');
        clearTemplate();
        return false;
    }

    templateData = {
        timestamps: timeSeriesData.timestamps.slice(startIndex, endIndex + 1),
        values: selectedValues,
        startIndex: startIndex,
        endIndex: endIndex
    };

    updateTemplateDisplay();
    highlightTemplateOnChart(startIndex, endIndex);
    return true;
}

function updateTemplateDisplay() {
    const len = templateData.values.length;
    document.getElementById('templateStatus').textContent = len > 0 ? '已选择' : '未选择';
    document.getElementById('templateLength').textContent = len > 0 ? len + ' 个点' : '--';
    document.getElementById('templateRange').textContent = len > 0
        ? `${templateData.timestamps[0].toFixed(1)} ~ ${templateData.timestamps[len - 1].toFixed(1)}`
        : '--';

    document.getElementById('btnMatch').disabled = len === 0;

    const ampCheckbox = document.getElementById('ampFilterEnabled');
    ampCheckbox.disabled = len === 0;

    updateAmplitudeLegend();

    if (len > 0) {
        const data = templateData.values.map((v, i) => [i, v]);
        templateChart.setOption({
            series: [{ data: data }]
        });
    } else {
        templateChart.setOption({
            series: [{ data: [] }]
        });
    }
}

function getAmplitudeTolerance() {
    const enabled = document.getElementById('ampFilterEnabled').checked;
    if (!enabled) return null;
    return parseFloat(document.getElementById('ampTolerance').value);
}

function updateAmplitudeDisplay() {
    const tolerance = getAmplitudeTolerance();
    const slider = document.getElementById('ampTolerance');
    const valueDisplay = document.getElementById('ampValueDisplay');
    const labelTip = document.getElementById('ampLabelTip');

    const currentValue = parseInt(slider.value);
    valueDisplay.textContent = currentValue + '%';
    labelTip.textContent = tolerance !== null ? `±${currentValue}%` : '不限制';

    const enabled = document.getElementById('ampFilterEnabled').checked;
    slider.disabled = !enabled;

    updateAmplitudeLegend();
}

function updateAmplitudeLegend() {
    const legend = document.getElementById('ampLegend');
    const enabled = document.getElementById('ampFilterEnabled').checked;
    const templateRangeText = document.getElementById('templateRangeText');
    const allowedRangeText = document.getElementById('allowedRangeText');

    if (!enabled || templateData.values.length === 0) {
        legend.style.display = 'none';
        return;
    }

    const tolerance = getAmplitudeTolerance();
    const tMin = Math.min(...templateData.values);
    const tMax = Math.max(...templateData.values);
    const tRange = tMax - tMin;
    const allowedMin = tMin - tRange * tolerance / 100;
    const allowedMax = tMax + tRange * tolerance / 100;

    templateRangeText.textContent = `模板: ${tMin.toFixed(1)} ~ ${tMax.toFixed(1)}`;
    allowedRangeText.textContent = `允许: ${allowedMin.toFixed(1)} ~ ${allowedMax.toFixed(1)}`;
    legend.style.display = 'flex';
}

let amplitudeDebounceTimer = null;
function onAmplitudeChanged() {
    updateAmplitudeDisplay();

    if (amplitudeDebounceTimer) {
        clearTimeout(amplitudeDebounceTimer);
    }

    const tolerance = getAmplitudeTolerance();
    const hasValidTemplate = templateData.values.length >= 5;

    if (hasValidTemplate && matchResults.length > 0) {
        amplitudeDebounceTimer = setTimeout(() => {
            autoReMatch();
        }, 300);
    }
}

function autoReMatch() {
    if (!currentDatasetId || templateData.values.length === 0) return;

    const validation = validateTemplateData(templateData);
    if (!validation.valid) return;

    const topK = parseInt(document.getElementById('topK').value) || 10;
    const step = parseInt(document.getElementById('step').value) || 1;
    const thresholdInput = document.getElementById('threshold').value;
    const threshold = thresholdInput ? parseFloat(thresholdInput) : null;
    const amplitudeTolerance = getAmplitudeTolerance();
    const templateName = document.getElementById('templateName').value || '';

    const payload = {
        template: templateData.values,
        template_timestamps: templateData.timestamps,
        top_k: topK,
        step: step,
        template_name: templateName
    };
    if (threshold !== null) payload.threshold = threshold;
    if (amplitudeTolerance !== null) payload.amplitude_tolerance = amplitudeTolerance;

    fetch(`${API_BASE}/datasets/${currentDatasetId}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                matchResults = data.matches;
                selectedMatchIndex = -1;
                renderMatchResults();
                highlightMatchesOnChart();

                const amp = data.amplitude_tolerance;
                if (amp !== undefined) {
                    const tip = document.getElementById('ampLabelTip');
                    tip.textContent = `±${amp}% | ${data.count} 匹配`;
                }
            } else {
                showToast('重新匹配失败: ' + (data.error || '未知错误'), 'error');
            }
        })
        .catch(err => {
            console.error('自动重新匹配失败:', err);
            showToast('自动重新匹配失败', 'error');
        });
}

function highlightTemplateOnChart(startIdx, endIdx) {
    const startTime = timeSeriesData.timestamps[startIdx];
    const endTime = timeSeriesData.timestamps[endIdx];
    const minVal = Math.min(...timeSeriesData.values);
    const maxVal = Math.max(...timeSeriesData.values);

    mainChart.setOption({
        graphic: [{
            type: 'rect',
            left: 0,
            top: 0,
            shape: {
                x: startTime,
                y: minVal,
                width: endTime - startTime,
                height: maxVal - minVal
            },
            style: {
                fill: 'rgba(118, 75, 162, 0.15)',
                stroke: '#764ba2',
                lineWidth: 2,
                lineDash: [5, 3]
            },
            silent: true,
            z: 100
        }]
    });
}

function clearTemplate() {
    templateData = { timestamps: [], values: [], startIndex: 0, endIndex: 0 };
    brushSelection = null;
    isBrushing = false;
    updateTemplateDisplay();
    clearMatchResults();

    try {
        mainChart.dispatchAction({
            type: 'brush',
            command: 'clear',
            areas: []
        });
    } catch (e) {
        console.warn('清除brush失败:', e);
    }

    mainChart.setOption({
        graphic: []
    });
}

function clearMatchResults() {
    matchResults = [];
    selectedMatchIndex = -1;
    renderMatchResults();
    compareChart.setOption({
        series: [
            { data: [] },
            { data: [] }
        ]
    });
    document.getElementById('compareHint').textContent = '选择匹配结果查看对比';
}

function loadDatasets() {
    fetch(`${API_BASE}/datasets`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                renderDatasetList(data.datasets);
                if (data.datasets.length > 0) {
                    selectDataset(data.datasets[0].id);
                }
            }
        })
        .catch(err => {
            console.error('加载数据集失败:', err);
            document.getElementById('datasetList').innerHTML =
                '<div class="empty-state">加载失败<br><small>请确保后端服务运行在 localhost:5000</small></div>';
        });
}

function renderDatasetList(datasets) {
    const container = document.getElementById('datasetList');
    if (datasets.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无数据集</div>';
        return;
    }

    container.innerHTML = datasets.map(ds => `
        <div class="dataset-item ${ds.id === currentDatasetId ? 'active' : ''}" data-id="${ds.id}">
            <div class="name">${escapeHtml(ds.name)}</div>
            <div class="meta">${ds.data_count} 个数据点</div>
        </div>
    `).join('');

    container.querySelectorAll('.dataset-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = parseInt(item.dataset.id);
            selectDataset(id);
        });
    });
}

function selectDataset(datasetId) {
    currentDatasetId = datasetId;
    clearTemplate();
    clearMatchResults();

    const items = document.querySelectorAll('.dataset-item');
    items.forEach(item => {
        item.classList.toggle('active', parseInt(item.dataset.id) === datasetId);
    });

    fetch(`${API_BASE}/datasets/${datasetId}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                document.getElementById('chartTitle').textContent = data.dataset.name;
            }
        });

    loadTimeSeriesData(datasetId);
}

function loadTimeSeriesData(datasetId) {
    fetch(`${API_BASE}/datasets/${datasetId}/data`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                timeSeriesData = {
                    timestamps: data.timestamps,
                    values: data.values
                };
                renderMainChart();
            }
        })
        .catch(err => {
            console.error('加载数据失败:', err);
        });
}

function renderMainChart() {
    const data = timeSeriesData.timestamps.map((t, i) => [t, timeSeriesData.values[i]]);

    mainChart.setOption({
        series: [{
            name: '时序数据',
            data: data
        }]
    });

    if (matchResults.length > 0) {
        highlightMatchesOnChart();
    }
}

function highlightMatchesOnChart() {
    const markAreas = matchResults.map((match, idx) => {
        const startTime = timeSeriesData.timestamps[match.start_index];
        const endTime = timeSeriesData.timestamps[match.end_index];
        return [
            {
                name: `匹配 ${idx + 1}`,
                xAxis: startTime,
                itemStyle: {
                    color: idx === selectedMatchIndex
                        ? 'rgba(82, 196, 26, 0.3)'
                        : 'rgba(82, 196, 26, 0.1)'
                }
            },
            { xAxis: endTime }
        ];
    });

    mainChart.setOption({
        series: [{
            markArea: {
                silent: false,
                data: markAreas
            }
        }]
    });
}

function startMatch() {
    if (!currentDatasetId) {
        showToast('请先选择一个数据集', 'warning');
        return;
    }

    const validation = validateTemplateData(templateData);
    if (!validation.valid) {
        showToast(validation.reason + '，请重新框选有效区域', 'warning');
        return;
    }

    if (!timeSeriesData || !timeSeriesData.values || timeSeriesData.values.length === 0) {
        showToast('时序数据为空，无法进行匹配', 'error');
        return;
    }

    if (templateData.values.length >= timeSeriesData.values.length) {
        showToast('模板长度不能大于等于时序数据总长度', 'warning');
        return;
    }

    const topK = parseInt(document.getElementById('topK').value) || 10;
    const step = parseInt(document.getElementById('step').value) || 1;
    const thresholdInput = document.getElementById('threshold').value;
    const threshold = thresholdInput ? parseFloat(thresholdInput) : null;
    const amplitudeTolerance = getAmplitudeTolerance();
    const templateName = document.getElementById('templateName').value || '';

    if (topK < 1) {
        showToast('最大匹配数必须大于0', 'warning');
        return;
    }
    if (step < 1) {
        showToast('步长必须大于0', 'warning');
        return;
    }
    if (threshold !== null && (isNaN(threshold) || threshold < 0)) {
        showToast('距离阈值无效', 'warning');
        return;
    }

    const btn = document.getElementById('btnMatch');
    btn.disabled = true;
    btn.textContent = '匹配中...';

    const payload = {
        template: templateData.values,
        template_timestamps: templateData.timestamps,
        top_k: topK,
        step: step,
        template_name: templateName
    };
    if (threshold !== null) payload.threshold = threshold;
    if (amplitudeTolerance !== null) payload.amplitude_tolerance = amplitudeTolerance;

    fetch(`${API_BASE}/datasets/${currentDatasetId}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                matchResults = data.matches;
                selectedMatchIndex = -1;
                renderMatchResults();
                highlightMatchesOnChart();
                if (data.count > 0) {
                    let msg = `匹配完成，找到 ${data.count} 个相似模式`;
                    if (data.amplitude_tolerance !== undefined) {
                        msg += ` (幅度±${data.amplitude_tolerance}%)`;
                    }
                    showToast(msg, 'success');
                } else {
                    let msg = '未找到相似的模式';
                    if (data.amplitude_tolerance !== undefined) {
                        msg += `，请尝试放宽幅度容忍度或更换模板`;
                    } else {
                        msg += '，请尝试调整参数或更换模板';
                    }
                    showToast(msg, 'info');
                }
            } else {
                showToast('匹配失败: ' + (data.error || '未知错误'), 'error');
            }
        })
        .catch(err => {
            console.error('匹配失败:', err);
            showToast('匹配失败，请检查后端服务', 'error');
        })
        .finally(() => {
            btn.disabled = false;
            btn.textContent = '开始匹配';
        });
}

function renderMatchResults() {
    const container = document.getElementById('matchResults');

    if (matchResults.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无匹配结果</div>';
        return;
    }

    container.innerHTML = matchResults.map((match, idx) => `
        <div class="match-item ${idx === selectedMatchIndex ? 'selected' : ''}" data-index="${idx}">
            <div class="match-header">
                <span class="match-index">#${idx + 1}</span>
                <span class="match-similarity">相似度: ${(match.similarity * 100).toFixed(1)}%</span>
            </div>
            <div class="match-range">
                位置: ${match.start_time.toFixed(1)} ~ ${match.end_time.toFixed(1)}
            </div>
            <div class="match-range">
                距离: ${match.distance.toFixed(2)}
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.match-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index);
            selectMatch(idx);
        });
    });
}

function selectMatch(index) {
    selectedMatchIndex = index;
    renderMatchResults();
    highlightMatchesOnChart();

    const match = matchResults[index];

    const templateNorm = normalizeArray(templateData.values);
    const matchNorm = normalizeArray(match.values);

    const templateSeries = templateNorm.map((v, i) => [i, v]);
    const matchSeries = matchNorm.map((v, i) => [i, v]);

    compareChart.setOption({
        series: [
            { name: '模板', data: templateSeries },
            { name: '匹配片段', data: matchSeries }
        ]
    });

    document.getElementById('compareHint').textContent =
        `匹配 #${index + 1} - 相似度: ${(match.similarity * 100).toFixed(1)}%`;

    const startTime = timeSeriesData.timestamps[match.start_index];
    const endTime = timeSeriesData.timestamps[match.end_index];
    const midTime = (startTime + endTime) / 2;
    const range = endTime - startTime;

    mainChart.dispatchAction({
        type: 'dataZoom',
        startValue: midTime - range * 3,
        endValue: midTime + range * 3
    });
}

function normalizeArray(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    if (std === 0) return arr.map(() => 0);
    return arr.map(v => (v - mean) / std);
}

function generateSampleData() {
    const btn = document.getElementById('btnGenerateSample');
    btn.disabled = true;
    btn.textContent = '生成中...';

    fetch(`${API_BASE}/generate-sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'sample_data_' + Date.now() })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                loadDatasets();
            } else {
                alert('生成失败: ' + data.error);
            }
        })
        .catch(err => {
            console.error('生成失败:', err);
            alert('生成失败，请检查后端服务');
        })
        .finally(() => {
            btn.disabled = false;
            btn.textContent = '生成示例数据';
        });
}

function showUploadModal() {
    document.getElementById('uploadModal').style.display = 'flex';
}

function hideUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
}

function uploadData() {
    const name = document.getElementById('uploadDatasetName').value.trim();
    const desc = document.getElementById('uploadDatasetDesc').value.trim();
    const format = document.getElementById('uploadFormat').value;
    const dataText = document.getElementById('uploadData').value.trim();

    if (!name) {
        alert('请输入数据集名称');
        return;
    }

    if (!dataText) {
        alert('请输入数据内容或上传文件');
        return;
    }

    let timestamps, values;
    try {
        if (format === 'json') {
            const data = JSON.parse(dataText);
            timestamps = data.timestamps || data.timestamp || [];
            values = data.values || data.value || [];
        } else {
            const lines = dataText.split('\n').filter(l => l.trim());
            timestamps = [];
            values = [];
            for (let i = 0; i < lines.length; i++) {
                const parts = lines[i].split(/[,;\t]/);
                if (parts.length >= 2) {
                    timestamps.push(parseFloat(parts[0]));
                    values.push(parseFloat(parts[1]));
                }
            }
        }
    } catch (e) {
        alert('数据格式解析失败: ' + e.message);
        return;
    }

    if (timestamps.length === 0 || values.length === 0) {
        alert('没有有效数据');
        return;
    }

    fetch(`${API_BASE}/datasets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc })
    })
        .then(r => r.json())
        .then(data => {
            if (!data.success) throw new Error(data.error);

            return fetch(`${API_BASE}/datasets/${data.dataset_id}/data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamps, values })
            });
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                hideUploadModal();
                loadDatasets();
                alert('上传成功');
            } else {
                throw new Error(data.error);
            }
        })
        .catch(err => {
            console.error('上传失败:', err);
            alert('上传失败: ' + err.message);
        });
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('uploadData').value = e.target.result;
    };
    reader.readAsText(file);
}

function bindEvents() {
    document.getElementById('btnGenerateSample').addEventListener('click', generateSampleData);
    document.getElementById('btnUploadData').addEventListener('click', showUploadModal);
    document.getElementById('btnMatch').addEventListener('click', startMatch);
    document.getElementById('btnClearTemplate').addEventListener('click', clearTemplate);
    document.getElementById('btnResetZoom').addEventListener('click', () => {
        mainChart.dispatchAction({
            type: 'dataZoom',
            start: 0,
            end: 100
        });
    });

    document.getElementById('closeModal').addEventListener('click', hideUploadModal);
    document.getElementById('cancelUpload').addEventListener('click', hideUploadModal);
    document.getElementById('confirmUpload').addEventListener('click', uploadData);
    document.getElementById('uploadFile').addEventListener('change', handleFileUpload);

    document.getElementById('uploadModal').addEventListener('click', function(e) {
        if (e.target === this) hideUploadModal();
    });

    const ampCheckbox = document.getElementById('ampFilterEnabled');
    ampCheckbox.addEventListener('change', function() {
        onAmplitudeChanged();
        if (this.checked && matchResults.length > 0) {
            showToast('已启用幅度过滤，正在重新匹配...', 'info');
        }
    });

    const ampSlider = document.getElementById('ampTolerance');
    ampSlider.addEventListener('input', onAmplitudeChanged);
    ampSlider.addEventListener('change', function() {
        if (matchResults.length > 0) {
            showToast(`幅度容忍度调整为 ±${this.value}%，已自动重新匹配`, 'info');
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
