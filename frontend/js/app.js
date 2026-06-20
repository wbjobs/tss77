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
}

function handleBrushSelected(params) {
    if (!params.batch || params.batch.length === 0) return;

    const brushArea = params.batch[0];
    if (!brushArea.areas || brushArea.areas.length === 0) {
        clearTemplate();
        return;
    }

    const area = brushArea.areas[0];
    if (area.coordRange) {
        const [startX, endX] = area.coordRange[0];
        selectTemplateByRange(startX, endX);
    }
}

function selectTemplateByRange(startTime, endTime) {
    if (!timeSeriesData.timestamps.length) return;

    let startIndex = 0;
    let endIndex = timeSeriesData.timestamps.length - 1;

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

    if (endIndex - startIndex < 5) {
        return;
    }

    templateData = {
        timestamps: timeSeriesData.timestamps.slice(startIndex, endIndex + 1),
        values: timeSeriesData.values.slice(startIndex, endIndex + 1),
        startIndex: startIndex,
        endIndex: endIndex
    };

    updateTemplateDisplay();
    highlightTemplateOnChart(startIndex, endIndex);
}

function updateTemplateDisplay() {
    const len = templateData.values.length;
    document.getElementById('templateStatus').textContent = len > 0 ? '已选择' : '未选择';
    document.getElementById('templateLength').textContent = len > 0 ? len + ' 个点' : '--';
    document.getElementById('templateRange').textContent = len > 0
        ? `${templateData.timestamps[0].toFixed(1)} ~ ${templateData.timestamps[len - 1].toFixed(1)}`
        : '--';

    document.getElementById('btnMatch').disabled = len === 0;

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
    updateTemplateDisplay();
    clearMatchResults();

    mainChart.dispatchAction({
        type: 'brush',
        command: 'clear',
        areas: []
    });

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
    if (!currentDatasetId || templateData.values.length === 0) return;

    const topK = parseInt(document.getElementById('topK').value) || 10;
    const step = parseInt(document.getElementById('step').value) || 1;
    const thresholdInput = document.getElementById('threshold').value;
    const threshold = thresholdInput ? parseFloat(thresholdInput) : null;
    const templateName = document.getElementById('templateName').value || '';

    const btn = document.getElementById('btnMatch');
    btn.disabled = true;
    btn.textContent = '匹配中...';

    fetch(`${API_BASE}/datasets/${currentDatasetId}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            template: templateData.values,
            template_timestamps: templateData.timestamps,
            top_k: topK,
            step: step,
            threshold: threshold,
            template_name: templateName
        })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                matchResults = data.matches;
                selectedMatchIndex = -1;
                renderMatchResults();
                highlightMatchesOnChart();
            } else {
                alert('匹配失败: ' + data.error);
            }
        })
        .catch(err => {
            console.error('匹配失败:', err);
            alert('匹配失败，请检查后端服务');
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
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
