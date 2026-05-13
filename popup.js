// BrowseMind Popup 脚本 - 展示浏览数据统计（图表增强版）

let currentChart = null;
let chartData = null;
let attentionChart = null;
let dataSync = new DataSync();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const chartAnimation = prefersReducedMotion ? false : undefined;
function getChartPalette() {
  const cs = getComputedStyle(document.documentElement);
  return [1,2,3,4,5,6].map(i => cs.getPropertyValue(`--chart-${i}`).trim());
}
// getPreferences(), DEFAULT_PREFERENCES, escapeHtml are defined in dataSync.js

async function initDataSync() {
  const preferences = await getPreferences();
  dataSync = new DataSync(preferences.apiBaseUrl);
  return dataSync;
}

document.addEventListener('DOMContentLoaded', loadData);
document.getElementById('refreshBtn').addEventListener('click', loadData);
document.getElementById('syncBtn').addEventListener('click', syncToCloud);
document.getElementById('aiAnalysisBtn').addEventListener('click', showAIAnalysis);
document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('addGoalBtn').addEventListener('click', openGoalModal);
document.getElementById('closeGoalModal').addEventListener('click', closeGoalModal);
document.getElementById('saveGoalBtn').addEventListener('click', saveGoal);
document.querySelectorAll('.chart-tab').forEach(btn => {
  btn.addEventListener('click', () => switchChart(btn.dataset.chart, btn));
});

const loadingMessages = ['正在唤醒分析引擎...', '整理你的浏览足迹...', '数据马上就绪...'];
let _loadingMsgTimer = null;
function startLoadingRotation() {
  const el = document.getElementById('loadingMsg');
  if (!el) return;
  let i = 0;
  _loadingMsgTimer = setInterval(() => { i = (i + 1) % loadingMessages.length; el.textContent = loadingMessages[i]; }, 1800);
}
function stopLoadingRotation() { clearInterval(_loadingMsgTimer); _loadingMsgTimer = null; }

async function loadData() {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const emptyState = document.getElementById('emptyState');

  loading.style.display = 'block';
  content.style.display = 'none';
  emptyState.style.display = 'none';
  startLoadingRotation();

  try {
    await initDataSync();
    // Batch all storage reads into one call
    const storage = await chrome.storage.local.get(['browsingData', 'classificationOverrides', 'themeMode']);
    const { themeMode = 'light' } = storage;
    const html = document.documentElement;
    if (themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
    const browsingData = storage.browsingData || [];

    if (browsingData.length === 0) {
      stopLoadingRotation(); loading.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    // 数据处理和分类
    const processor = new DataProcessor(browsingData);
    const cleanedData = processor.clean().getData();

    const classificationOverrides = storage.classificationOverrides || {};
    const classifier = new WebsiteClassifier(classificationOverrides);
    const classifiedData = classifier.classifyBatch(cleanedData);

    // 统计分析
    const analyzer = new StatisticsAnalyzer(classifiedData);
    const categoryStats = analyzer.analyzeByCategory();
    const todayStats = analyzer.getTodayStats();
    const hourlyDist = analyzer.getHourlyDistribution();
    const preferences = await getPreferences();
    const dailyTrend = calculateDailyTrend(classifiedData, preferences.analysisDays);
    // Update analysis window labels
    document.getElementById('categoryStatsLabel').textContent = `${preferences.analysisDays} 天`;
    document.getElementById('weeklyStatsLabel').textContent = `${preferences.analysisDays} 天`;

    // 保存数据供图表使用
    chartData = {
      categoryStats,
      todayStats,
      hourlyDist,
      dailyTrend,
      classifier
    };

    // 计算基础统计（使用已清洗和分类的数据，避免重复计算）
    const stats = calculateStats(classifiedData);

    // 更新UI
    updateUI(stats, classifiedData, categoryStats, todayStats, classifier);

    // 绘制默认图表（饼图）
    drawPieChart();

    // 加载目标和高级分析
    await loadGoals();
    await loadAdvancedAnalysis();

    stopLoadingRotation(); loading.style.display = 'none';
    content.style.display = 'block';
    content.querySelectorAll('.stat-bar, .chart-card, .section').forEach((el, i) => {
      el.style.animationDelay = `${i * 0.06}s`;
      el.classList.add('fade-in');
    });
  } catch (error) {
    console.error('加载数据失败:', error);
    stopLoadingRotation(); loading.style.display = 'none';
    emptyState.style.display = 'block';
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

function calculateStats(data) {
  const today = new Date().toISOString().split('T')[0];

  // 今日数据
  const todayData = data.filter(r => r.date === today);
  const todayVisits = todayData.length;
  const todayDuration = todayData.reduce((sum, r) => sum + (r.duration || 0), 0);

  // 当前窗口数据
  const totalVisits = data.length;
  const uniqueSites = new Set(data.map(r => r.domain).filter(Boolean)).size;

  return {
    todayVisits,
    todayDuration,
    totalVisits,
    uniqueSites
  };
}

// 计算每日趋势
function calculateDailyTrend(data, days = 7) {
  const dailyStats = {};

  data.forEach(record => {
    const date = record.date;
    if (!dailyStats[date]) {
      dailyStats[date] = {
        date,
        duration: 0,
        visits: 0
      };
    }
    dailyStats[date].duration += record.duration || 0;
    dailyStats[date].visits++;
  });

  // 转换为数组并排序
  return Object.values(dailyStats)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);
}

function updateUI(stats, data, categoryStats, todayStats, classifier) {
  // 更新统计数字
  document.getElementById('todayVisits').textContent = stats.todayVisits;
  document.getElementById('todayDuration').textContent = formatDuration(stats.todayDuration);
  document.getElementById('totalVisits').textContent = stats.totalVisits;
  document.getElementById('uniqueSites').textContent = stats.uniqueSites;

  // 更新分类统计（7天）
  updateCategoryStats(categoryStats, classifier);

  // 更新今日分类统计
  updateTodayCategoryStats(todayStats, classifier);

  // 显示最近访问记录（最新10条）
  const recentRecords = data
    .sort((a, b) => b.visitTime - a.visitTime)
    .slice(0, 10);

  const recordsContainer = document.getElementById('recentRecords');
  recordsContainer.innerHTML = recentRecords.map(record => {
    const domain = extractDomain(record.url);
    const time = formatTime(record.visitTime);
    const duration = record.duration > 0 ? ` · ${formatDuration(record.duration)}` : '';

    return `
      <div class="record-item">
        <div class="record-title">${escapeHtml(record.title || domain)}</div>
        <div class="record-meta">${domain} · ${time}${duration}</div>
      </div>
    `;
  }).join('');
}

// 更新分类统计（7天）
function updateCategoryStats(categoryStats, classifier) {
  const container = document.getElementById('categoryStats');
  const categories = classifier.getAllCategories();

  container.innerHTML = categoryStats.map(stat => {
    const categoryInfo = categories[stat.category] || { name: '其他', icon: '📦', color: '#90919e' };
    const percentage = parseFloat(stat.percentage);

    return `
      <div class="category-item">
        <span class="category-dot" style="background:${categoryInfo.color || '#90919e'}"></span>
        <span class="category-name">${categoryInfo.name}</span>
        <span class="category-meta">${percentage}%</span>
        <div style="flex:0 0 auto;text-align:right;">
          <div class="category-meta">${formatDuration(stat.totalDuration)}</div>
        </div>
      </div>
      <div class="category-bar" style="margin:0 0 4px 17px;">
        <div class="category-bar-fill" style="width: ${percentage}%"></div>
      </div>
    `;
  }).join('');
}

// 更新今日分类统计
function updateTodayCategoryStats(todayStats, classifier) {
  const container = document.getElementById('todayCategoryStats');
  const categories = classifier.getAllCategories();

  if (todayStats.length === 0) {
    container.innerHTML = '<div class="empty-line">今日暂无数据</div>';
    return;
  }

  container.innerHTML = todayStats.slice(0, 5).map(stat => {
    const categoryInfo = categories[stat.category] || { name: '其他', icon: '📦', color: '#90919e' };
    const percentage = parseFloat(stat.percentage);

    return `
      <div class="category-item-compact">
        <span class="category-dot" style="background:${categoryInfo.color || '#90919e'};width:6px;height:6px;border-radius:50%;flex-shrink:0;"></span>
        <span class="category-name">${categoryInfo.name}</span>
        <span class="category-value">${percentage}%</span>
      </div>
    `;
  }).join('');
}

// 切换图表
function switchChart(type, activeButton) {
  // 更新按钮状态
  document.querySelectorAll('.chart-tab').forEach(btn => {
    btn.classList.remove('active');
  });
  if (activeButton) {
    activeButton.classList.add('active');
  }

  // 绘制对应图表
  if (type === 'pie') {
    drawPieChart();
  } else if (type === 'bar') {
    drawBarChart();
  } else if (type === 'line') {
    drawLineChart();
  }
}

// 绘制饼图 - 分类占比
function drawPieChart() {
  if (!chartData) return;

  const { categoryStats, classifier } = chartData;
  const categories = classifier.getAllCategories();

  // 准备数据
  const labels = categoryStats.map(stat => {
    const info = categories[stat.category] || { name: '其他', icon: '📦' };
    return `${info.icon} ${info.name}`;
  });

  const data = categoryStats.map(stat => stat.totalDuration / 60); // 转换为分钟

  const colors = getChartPalette();

  destroyChart();

  const ctx = document.getElementById('mainChart').getContext('2d');
  currentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 10,
            font: { size: 11 },
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const minutes = Math.round(context.parsed);
              return ` ${formatDuration(minutes * 60)}`;
            }
          }
        }
      }
    }
  });
}

// 绘制柱状图 - 时间分布
function drawBarChart() {
  if (!chartData) return;

  const { hourlyDist } = chartData;

  // 准备数据（只显示有数据的小时）
  const activeHours = hourlyDist.filter(h => h.duration > 0);
  const labels = activeHours.map(h => `${h.hour}:00`);
  const data = activeHours.map(h => h.duration / 60); // 转换为分钟

  destroyChart();

  const ctx = document.getElementById('mainChart').getContext('2d');
  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '浏览时长（分钟）',
        data: data,
        backgroundColor: colors[0] + 'b3',
        borderRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${formatDuration(context.parsed.y * 60)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 }
          }
        },
        x: {
          ticks: {
            font: { size: 10 }
          }
        }
      }
    }
  });
}

// 绘制折线图 - 每日趋势
function drawLineChart() {
  if (!chartData) return;

  const { dailyTrend } = chartData;

  // 准备数据
  const labels = dailyTrend.map(d => {
    const date = new Date(d.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const durationData = dailyTrend.map(d => d.duration / 60); // 分钟
  const visitsData = dailyTrend.map(d => d.visits);

  destroyChart();

  const ctx = document.getElementById('mainChart').getContext('2d');
  currentChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '浏览时长（分钟）',
          data: durationData,
          borderColor: colors[0],
          backgroundColor: colors[0] + '14',
          tension: 0.35,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: '访问次数',
          data: visitsData,
          borderColor: colors[1],
          backgroundColor: colors[1] + '14',
          tension: 0.35,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 8,
            font: { size: 10 },
            usePointStyle: true
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          ticks: { font: { size: 10 } }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { font: { size: 10 } }
        },
        x: {
          ticks: { font: { size: 10 } }
        }
      }
    }
  });
}

// 销毁当前图表
function destroyChart() {
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }
}

// 提取域名
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

// formatDuration() is defined in dataSync.js (shared with dashboard)

// 格式化时间
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 今天
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 7天内
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[date.getDay()] + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 更早
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

// HTML转义 — 使用 dataSync.js 中的 escapeHtml()

// 同步到云端
async function syncToCloud() {
  const syncBtn = document.getElementById('syncBtn');
  const originalText = syncBtn.textContent;

  try {
    syncBtn.textContent = '⏳ 同步中...';
    syncBtn.disabled = true;

    // 检查服务器连接
    const isConnected = await dataSync.checkConnection();
    if (!isConnected) {
      alert('❌ 无法连接到服务器\n请确保后端服务已启动：\ncd backend && python main.py');
      return;
    }

    // 同步数据
    const result = await dataSync.syncLocalData();

    if (result.success) {
      syncBtn.textContent = '✅ 同步成功';
      alert(`✅ 同步成功\n${result.message}`);
      await loadAdvancedAnalysis();
    }

  } catch (error) {
    console.error('同步失败:', error);
    syncBtn.textContent = '❌ 同步失败';
    alert(`❌ 同步失败\n${error.message}\n\n请确保后端服务已启动`);
  } finally {
    setTimeout(() => {
      syncBtn.textContent = originalText;
      syncBtn.disabled = false;
    }, 2000);
  }
}

// 显示 AI 分析
async function showAIAnalysis() {
  const modal = document.getElementById('aiAnalysisModal');
  const content = document.getElementById('aiAnalysisContent');

  // 显示加载状态
  modal.style.display = 'flex';
  content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>AI 正在分析中...</p></div>';

  try {
    // 检查服务器连接
    const isConnected = await dataSync.checkConnection();
    if (!isConnected) {
      content.innerHTML = '<p style="color: var(--red); text-align: center;">无法连接到服务器<br>请确保后端服务已启动</p>';
      return;
    }

    // 获取用户ID
    await dataSync.initUserId();

    const preferences = await getPreferences();

    const response = await fetch(
      `${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=${preferences.analysisDays}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      let detail = '分析失败';
      try { const err = await response.json(); detail = err.detail || detail; } catch {}
      throw new Error(detail);
    }

    const analysis = await response.json();

    // 显示分析结果
    displayAIAnalysis(analysis);

  } catch (error) {
    console.error('AI 分析失败:', error);
    content.innerHTML = `
      <p style="color: var(--red); text-align: center;">
        AI 分析失败<br>
        ${error.message}<br><br>
        ${error.message.includes('API') ? '请配置 AI_API_KEY 环境变量' : ''}
      </p>
    `;
  }
}

// 显示 AI 分析结果
function displayAIAnalysis(analysis) {
  const content = document.getElementById('aiAnalysisContent');

  // 颜色映射
  const pal = getChartPalette();
  const categoryColors = {
    learning: pal[0], coding: pal[1], entertainment: pal[3],
    social: pal[2], tools: pal[5], other: pal[4]
  };
  const categoryNames = {
    learning: '学习', coding: '编程', entertainment: '娱乐',
    social: '社交', tools: '工具', other: '其他'
  };

  // 1. 总结卡片
  let html = `
    <div class="ai-summary-card">
      <div class="ai-summary-label">行为总结</div>
      <p>${escapeHtml(analysis.summary || '暂无总结')}</p>
    </div>
  `;

  // 2. 分类占比条（如果有数据）
  const stats = analysis.category_stats || [];
  if (stats.length > 0) {
    const segments = stats.map(s => {
      const color = categoryColors[s.category] || pal[4];
      return `<div class="ai-stacked-segment" style="width:${s.percentage}%;background:${color}"></div>`;
    }).join('');
    const legend = stats.map(s => {
      const color = categoryColors[s.category] || pal[4];
      const name = categoryNames[s.category] || s.category;
      return `<span class="ai-legend-item"><span class="ai-legend-dot" style="background:${color}"></span>${name} <span class="ai-legend-pct">${s.percentage}%</span></span>`;
    }).join('');
    html += `
      <div class="ai-bar-chart">
        <div class="ai-bar-chart-title">时间分布</div>
        <div class="ai-stacked-bar">${segments}</div>
        <div class="ai-bar-legend">${legend}</div>
      </div>
    `;
  }

  // 3. 热门网站表格（如果有数据）
  const domains = analysis.top_domains || [];
  if (domains.length > 0) {
    const rows = domains.slice(0, 5).map((d, i) => `
      <tr>
        <td style="color:var(--muted);font-size:11px;">${i + 1}</td>
        <td class="domain-name">${escapeHtml(d.domain)}</td>
        <td>${d.visits} 次</td>
        <td class="domain-dur">${formatDuration(d.total_duration)}</td>
      </tr>
    `).join('');
    html += `
      <div class="ai-table-wrap">
        <div class="ai-table-title">热门网站 Top 5</div>
        <table class="ai-table">
          <thead><tr><th>#</th><th>网站</th><th>访问</th><th>时长</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // 4. 问题卡片
  const issues = analysis.issues || [];
  const issuesHtml = issues.map(issue =>
    `<li class="ai-issue-card">${escapeHtml(issue)}</li>`
  ).join('') || '<li class="ai-issue-card">暂未发现明显问题。</li>';

  // 5. 建议卡片
  const suggestions = analysis.suggestions || [];
  const suggestionsHtml = suggestions.map(s =>
    `<li class="ai-suggestion-card">${escapeHtml(s)}</li>`
  ).join('') || '<li class="ai-suggestion-card">暂无建议。</li>';

  html += `
    <ul class="ai-card-list">${issuesHtml}</ul>
    <ul class="ai-card-list">${suggestionsHtml}</ul>
  `;

  content.innerHTML = html;
}

// 关闭模态框
function closeModal() {
  document.getElementById('aiAnalysisModal').style.display = 'none';
}

// 点击模态框外部关闭
document.getElementById('aiAnalysisModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeModal();
  }
});

function displayAdvancedAnalysisEmptyState(message = '同步云端数据后将显示高级分析结果') {
  const blackholeContainer = document.getElementById('blackholeStats');
  const attentionStatsContainer = document.getElementById('attentionStats');

  blackholeContainer.innerHTML = `<p class="empty-line">${escapeHtml(message)}</p>`;
  attentionStatsContainer.innerHTML = `<p class="empty-line">${escapeHtml(message)}</p>`;

  if (attentionChart) {
    attentionChart.destroy();
    attentionChart = null;
  }
}

// 自动加载高级分析
async function loadAdvancedAnalysis() {
  try {
    const isConnected = await dataSync.checkConnection();
    if (!isConnected) {
      displayAdvancedAnalysisEmptyState('后端未连接，暂时无法加载高级分析');
      return;
    }

    await dataSync.initUserId();

    const preferences = await getPreferences();
    const response = await fetch(
      `${dataSync.apiBaseUrl}/api/advanced-analysis/${dataSync.userId}?days=${preferences.analysisDays}&blackhole_threshold=${preferences.blackholeThresholdMinutes}`
    );

    if (response.status === 404) {
      displayAdvancedAnalysisEmptyState('云端数据正在准备中，稍后再打开插件即可看到高级分析');
      return;
    }

    if (!response.ok) {
      let detail = '分析失败';
      try { const err = await response.json(); detail = err.detail || detail; } catch {}
      throw new Error(detail);
    }

    const analysis = await response.json();
    displayBlackholes(analysis.blackholes);
    displayAttentionCurve(analysis.attention_curve);
  } catch (error) {
    console.error('高级分析失败:', error);
    displayAdvancedAnalysisEmptyState('高级分析暂时不可用，请稍后重试');
  }
}

// 显示时间黑洞
function displayBlackholes(blackholes) {
  const container = document.getElementById('blackholeStats');

  if (!blackholes.top_blackholes || blackholes.top_blackholes.length === 0) {
    container.innerHTML = '<p class="empty-line" style="color:var(--green);">没有时间黑洞 — 你的浏览节奏很好</p>';
    return;
  }

  const wastePercentage = blackholes.waste_percentage;
  const totalWasted = formatDuration(blackholes.total_wasted_time);

  let html = `
    <div style="text-align: center; margin-bottom: 12px; padding: 8px; background: var(--red-soft); border-radius: 8px;">
      <div style="font-size: 20px; font-weight: 700; color: var(--red);">${wastePercentage}%</div>
      <div style="font-size: 11px; color: var(--muted);">浪费时间占比 · 共 ${totalWasted}</div>
    </div>
  `;

  html += blackholes.top_blackholes.slice(0, 3).map(bh => {
    return `
      <div class="blackhole-item">
        <div class="blackhole-header">
          <span class="blackhole-domain">${escapeHtml(bh.domain)}</span>
          <span class="blackhole-duration">${formatDuration(bh.total_duration)}</span>
        </div>
        <div class="blackhole-meta">
          ${bh.long_sessions_count} 次长时间访问 · 最长 ${formatDuration(bh.longest_session)}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// 显示注意力曲线
function displayAttentionCurve(attentionCurve) {
  const statsContainer = document.getElementById('attentionStats');

  // 显示统计信息
  const focusScore = attentionCurve.focus_score;
  const peakHours = attentionCurve.peak_hours;
  const recommendations = attentionCurve.recommendations;

  let statsHtml = `
    <div class="attention-stats">
      <div class="attention-stat-item">
        <div class="attention-stat-value">${focusScore}</div>
        <div class="attention-stat-label">专注度分数</div>
      </div>
      <div class="attention-stat-item">
        <div class="attention-stat-value">${peakHours.length}</div>
        <div class="attention-stat-label">高效时段</div>
      </div>
    </div>
  `;

  if (recommendations && recommendations.length > 0) {
    statsHtml += `
      <div style="margin-top: 12px; padding: 10px; background: var(--accent-soft); border-radius: 8px; font-size: 11px; color: var(--muted);">
        ${escapeHtml(recommendations[0])}
      </div>
    `;
  }

  statsContainer.innerHTML = statsHtml;

  // 绘制注意力曲线图
  drawAttentionChart(attentionCurve.hourly_focus);
}

// 绘制注意力曲线图
function drawAttentionChart(hourlyFocus) {
  // 销毁旧图表
  if (attentionChart) {
    attentionChart.destroy();
    attentionChart = null;
  }

  // 只显示有数据的小时
  const activeHours = hourlyFocus.filter(h => h.total_duration > 0);
  if (activeHours.length === 0) {
    const statsContainer = document.getElementById('attentionStats');
    statsContainer.innerHTML = '<p class="empty-line">暂无足够数据生成注意力曲线</p>';
    return;
  }

  const labels = activeHours.map(h => `${h.hour}:00`);
  const data = activeHours.map(h => h.score);

  const ctx = document.getElementById('attentionChart').getContext('2d');
  const attColors = getChartPalette();
  attentionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '专注度',
        data: data,
        borderColor: attColors[0],
        backgroundColor: attColors[0] + '14',
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: chartAnimation,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` 专注度: ${context.parsed.y.toFixed(1)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { font: { size: 9 } }
        },
        x: {
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

// ==================== 目标管理功能 ====================

async function loadGoals() {
  try {
    const { userId } = await chrome.storage.local.get('userId');
    if (!userId) return;

    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${userId}?date=${today}&is_active=1`);

    if (!response.ok) {
      console.error('获取目标失败');
      return;
    }

    const goals = await response.json();
    displayGoals(goals);
  } catch (error) {
    console.error('加载目标失败:', error);
  }
}

function displayGoals(goals) {
  const container = document.getElementById('goalsContainer');

  if (!goals || goals.length === 0) {
    container.innerHTML = '<p class="empty-line">还没有目标 — 设一个小目标开始追踪吧</p>';
    return;
  }

  container.innerHTML = goals.map(goal => {
    const percentage = goal.progress_percentage;
    const isWarning = percentage >= 80;
    const isAchieved = percentage >= 100;

    let statusClass = 'normal';
    let statusText = '进行中';
    if (isAchieved) {
      statusClass = 'achieved';
      statusText = '已完成';
    } else if (isWarning) {
      statusClass = 'warning';
      statusText = '即将超标';
    }

    const goalTypeMap = {
      'daily_learning': '学习时长',
      'daily_entertainment': '娱乐限制',
      'daily_coding': '编程时长',
      'daily_social': '社交限制'
    };

    return `
      <div class="goal-item ${isAchieved ? 'achieved' : ''}">
        <div class="goal-header">
          <span class="goal-type">${goalTypeMap[goal.goal_type] || goal.goal_type}</span>
          <div>
            <span class="goal-status ${statusClass}">${statusText}</span>
            <button class="goal-delete" data-goal-id="${goal.id}" aria-label="删除目标">×</button>
          </div>
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill ${isWarning ? 'warning' : ''}" style="width: ${Math.min(percentage, 100)}%"></div>
        </div>
        <div class="goal-meta">
          <span>${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)}</span>
          <span>${percentage.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }).join('');

  // 添加删除事件监听
  container.querySelectorAll('.goal-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const goalId = e.target.dataset.goalId;
      deleteGoal(goalId);
    });
  });
}

function openGoalModal() {
  document.getElementById('goalModal').style.display = 'flex';
}

function closeGoalModal() {
  document.getElementById('goalModal').style.display = 'none';
}

async function saveGoal() {
  try {
    const { userId } = await chrome.storage.local.get('userId');
    if (!userId) {
      alert('请先同步数据');
      return;
    }

    const goalType = document.getElementById('goalTypeSelect').value;
    const durationMinutes = parseInt(document.getElementById('goalDurationInput').value);

    if (!durationMinutes || durationMinutes <= 0) {
      alert('请输入有效的时长');
      return;
    }

    // 映射目标类型到分类
    const categoryMap = {
      'daily_learning': 'learning',
      'daily_entertainment': 'entertainment',
      'daily_coding': 'coding',
      'daily_social': 'social'
    };

    const today = new Date().toISOString().split('T')[0];

    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal_type: goalType,
        category: categoryMap[goalType],
        target_duration: durationMinutes * 60,
        date: today
      })
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.detail || '创建目标失败');
      return;
    }

    closeGoalModal();
    await loadGoals();
    alert('目标创建成功！');
  } catch (error) {
    console.error('保存目标失败:', error);
    alert('保存失败，请重试');
  }
}

async function deleteGoal(goalId) {
  if (!confirm('确定要删除这个目标吗？')) {
    return;
  }

  try {
    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      alert('删除失败');
      return;
    }

    await loadGoals();
  } catch (error) {
    console.error('删除目标失败:', error);
    alert('删除失败，请重试');
  }
}

async function updateGoalsProgress() {
  try {
    await initDataSync();
    const { userId } = await chrome.storage.local.get('userId');
    if (!userId) return;

    const today = new Date().toISOString().split('T')[0];

    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${userId}/update-progress?date=${encodeURIComponent(today)}`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('更新目标进度失败:', response.status, errorText);
      return;
    }

    const result = await response.json();

    // 处理通知
    if (result.data && result.data.notifications) {
      result.data.notifications.forEach(notif => {
        showNotification(notif.type, notif.message);
      });
    }

    await loadGoals();
  } catch (error) {
    console.error('更新目标进度失败:', error);
  }
}

function showNotification(type, message) {
  // Popup context cannot use chrome.notifications (MV3 restriction).
  // Log the notification so the user can see it in console, and
  // the background service worker handles actual system notifications.
  const prefix = type === 'achieved' ? '🎉 目标达成' : '⚠️ 时间提醒';
  console.log(`${prefix}: ${message}`);
}
