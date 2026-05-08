let trendChart = null;
let hourlyChart = null;

const palette = ['#516b48', '#d98c2b', '#a85338', '#3f5f7f', '#6b5678', '#8c7a5f'];

const formatDurationShort = (seconds) => {
  const total = Math.floor(seconds || 0);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours}h ${remain}m` : `${hours}h`;
};

const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
};

function calculateDailyTrend(data) {
  const dailyStats = {};
  data.forEach(record => {
    const date = record.date;
    if (!dailyStats[date]) dailyStats[date] = { date, visits: 0, duration: 0 };
    dailyStats[date].visits++;
    dailyStats[date].duration += record.duration || 0;
  });

  return Object.values(dailyStats)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-7);
}

function calculateTopDomains(data) {
  const domainMap = {};
  data.forEach(record => {
    if (!record.domain) return;
    if (!domainMap[record.domain]) {
      domainMap[record.domain] = { domain: record.domain, visits: 0, duration: 0 };
    }
    domainMap[record.domain].visits++;
    domainMap[record.domain].duration += record.duration || 0;
  });

  return Object.values(domainMap)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 8);
}

function renderMetrics(data) {
  const today = new Date().toISOString().split('T')[0];
  const todayData = data.filter(record => record.date === today);
  const todayDuration = todayData.reduce((sum, record) => sum + (record.duration || 0), 0);
  const uniqueSites = new Set(data.map(record => record.domain).filter(Boolean)).size;

  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long'
  });
  document.getElementById('metricTodayVisits').textContent = todayData.length;
  document.getElementById('metricTodayDuration').textContent = formatDurationShort(todayDuration);
  document.getElementById('metricWeekVisits').textContent = data.length;
  document.getElementById('metricUniqueSites').textContent = uniqueSites;
}

function renderCategoryList(categoryStats, classifier) {
  const container = document.getElementById('categoryList');
  if (!categoryStats.length) {
    container.innerHTML = '<div class="empty">还没有足够数据生成分类。</div>';
    return;
  }

  const categories = classifier.getAllCategories();
  container.innerHTML = categoryStats.map((stat, index) => {
    const info = categories[stat.category] || { name: '其他', icon: '◇' };
    const percentage = Number(stat.percentage || 0);
    return `
      <div class="category-row">
        <div><strong>${info.icon} ${escapeHtml(info.name)}</strong><div class="category-meta">${stat.visits} 次</div></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(percentage, 100)}%; background:${palette[index % palette.length]}"></div></div>
        <div class="category-meta">${percentage.toFixed(1)}%</div>
      </div>
    `;
  }).join('');
}

function renderDomainList(domains) {
  const container = document.getElementById('domainList');
  if (!domains.length) {
    container.innerHTML = '<div class="empty">暂无站点数据。</div>';
    return;
  }

  container.innerHTML = domains.map(domain => `
    <div class="domain-row">
      <div>
        <div class="domain-name">${escapeHtml(domain.domain)}</div>
        <div class="domain-meta">${domain.visits} 次访问</div>
      </div>
      <div class="domain-meta">${formatDurationShort(domain.duration)}</div>
    </div>
  `).join('');
}

function renderTrendChart(dailyTrend) {
  if (trendChart) trendChart.destroy();
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dailyTrend.map(item => {
        const date = new Date(item.date);
        return `${date.getMonth() + 1}/${date.getDate()}`;
      }),
      datasets: [
        {
          label: '时长（分钟）',
          data: dailyTrend.map(item => Math.round((item.duration || 0) / 60)),
          borderColor: '#516b48',
          backgroundColor: 'rgba(81,107,72,.12)',
          tension: .36,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: '访问次数',
          data: dailyTrend.map(item => item.visits),
          borderColor: '#d98c2b',
          backgroundColor: 'rgba(217,140,43,.12)',
          tension: .36,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(33,29,24,.08)' } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderHourlyChart(hourlyDist) {
  if (hourlyChart) hourlyChart.destroy();
  const active = hourlyDist.filter(item => item.duration > 0);
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: active.map(item => `${item.hour}:00`),
      datasets: [{
        label: '分钟',
        data: active.map(item => Math.round(item.duration / 60)),
        backgroundColor: active.map((_, index) => palette[index % palette.length]),
        borderRadius: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(33,29,24,.08)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

async function loadDashboard() {
  const statusNote = document.getElementById('statusNote');
  statusNote.textContent = '正在读取本地浏览数据...';

  try {
    const { browsingData = [] } = await chrome.storage.local.get('browsingData');
    if (!browsingData.length) {
      statusNote.textContent = '还没有浏览记录。先正常使用浏览器几分钟，再回来刷新仪表盘。';
      renderMetrics([]);
      renderCategoryList([], new WebsiteClassifier());
      renderDomainList([]);
      renderTrendChart([]);
      renderHourlyChart([]);
      return;
    }

    const processor = new DataProcessor(browsingData);
    const cleanedData = processor.clean().getData();
    const classifier = new WebsiteClassifier();
    const classifiedData = classifier.classifyBatch(cleanedData);
    const analyzer = new StatisticsAnalyzer(classifiedData);

    const categoryStats = analyzer.analyzeByCategory();
    const hourlyDist = analyzer.getHourlyDistribution();
    const dailyTrend = calculateDailyTrend(classifiedData);
    const topDomains = calculateTopDomains(classifiedData);

    renderMetrics(classifiedData);
    renderCategoryList(categoryStats, classifier);
    renderDomainList(topDomains);
    renderTrendChart(dailyTrend);
    renderHourlyChart(hourlyDist);

    const topCategory = categoryStats[0]
      ? `${classifier.getCategoryInfo(categoryStats[0].category).name}占比最高，约 ${Number(categoryStats[0].percentage).toFixed(1)}%。`
      : '分类数据正在积累。';
    statusNote.textContent = `已载入 ${classifiedData.length} 条记录。${topCategory}`;
  } catch (error) {
    console.error('仪表盘加载失败:', error);
    statusNote.textContent = `仪表盘加载失败：${error.message}`;
  }
}

document.addEventListener('DOMContentLoaded', loadDashboard);
document.getElementById('refreshDashboardBtn').addEventListener('click', loadDashboard);
