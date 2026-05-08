const DEFAULT_API_BASE_URL = 'http://localhost:8000';
const categoryMap = {
  daily_learning: 'learning',
  daily_entertainment: 'entertainment',
  daily_coding: 'coding',
  daily_social: 'social'
};
const goalTypeNames = {
  daily_learning: '每日学习时长',
  daily_entertainment: '每日娱乐时长限制',
  daily_coding: '每日编程时长',
  daily_social: '每日社交时长限制'
};

let dataSync = null;

function todayString() {
  return new Date().toISOString().split('T')[0];
}

function formatDuration(seconds) {
  const total = Math.floor(seconds || 0);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours} 小时 ${remain} 分钟` : `${hours} 小时`;
}

function log(message) {
  const box = document.getElementById('logBox');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  box.textContent = `[${time}] ${message}\n${box.textContent}`;
}

function setNote(message, type = 'info') {
  const note = document.getElementById('operationNote');
  note.style.display = 'block';
  note.className = `note ${type === 'success' ? 'success' : type === 'danger' ? 'danger' : ''}`;
  note.textContent = message;
}

async function getApiBaseUrl() {
  const { apiBaseUrl } = await chrome.storage.local.get('apiBaseUrl');
  return apiBaseUrl || DEFAULT_API_BASE_URL;
}

async function initDataSync() {
  const apiBaseUrl = await getApiBaseUrl();
  document.getElementById('apiBaseUrlInput').value = apiBaseUrl;
  dataSync = new DataSync(apiBaseUrl);
  return dataSync;
}

async function refreshStatus() {
  await initDataSync();
  const { browsingData = [], userId, lastSyncTime } = await chrome.storage.local.get(['browsingData', 'userId', 'lastSyncTime']);
  const connected = await dataSync.checkConnection();

  document.getElementById('localCount').textContent = browsingData.length;
  document.getElementById('userIdShort').textContent = userId ? userId.slice(0, 10) + '…' : '未生成';
  document.getElementById('serverStatus').textContent = connected ? '正常' : '离线';
  document.getElementById('serverStatus').style.color = connected ? '#188038' : '#d93025';

  const syncText = lastSyncTime ? `上次同步：${new Date(lastSyncTime).toLocaleString('zh-CN')}` : '尚未同步。';
  document.getElementById('statusNote').textContent = `${connected ? '后端连接正常。' : '无法连接后端，请检查服务或后端地址。'} ${syncText}`;

  await loadGoals();
  log(`状态已刷新：${browsingData.length} 条本地记录，后端${connected ? '可用' : '不可用'}`);
}

async function syncNow() {
  try {
    await initDataSync();
    log('开始同步本地数据...');
    const result = await dataSync.syncLocalData();
    setNote(result.message || '同步完成', 'success');
    log(`同步完成：${result.message || '成功'}`);
    await refreshStatus();
  } catch (error) {
    setNote(`同步失败：${error.message}`, 'danger');
    log(`同步失败：${error.message}`);
  }
}

async function runAIAnalysis() {
  try {
    await initDataSync();
    const connected = await dataSync.checkConnection();
    if (!connected) throw new Error('无法连接后端服务');

    await dataSync.initUserId();
    log('开始 AI 分析...');
    const response = await fetch(`${dataSync.apiBaseUrl}/api/ai-analysis/${dataSync.userId}?days=7`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'AI 分析失败');
    }

    const analysis = await response.json();
    setNote(`AI 分析完成：${analysis.summary}`, 'success');
    log(`AI 总结：${analysis.summary}`);
  } catch (error) {
    setNote(`AI 分析失败：${error.message}`, 'danger');
    log(`AI 分析失败：${error.message}`);
  }
}

async function createGoal() {
  try {
    await initDataSync();
    const connected = await dataSync.checkConnection();
    if (!connected) throw new Error('无法连接后端服务');

    await dataSync.initUserId();
    const goalType = document.getElementById('goalTypeSelect').value;
    const durationMinutes = parseInt(document.getElementById('goalDurationInput').value, 10);
    if (!durationMinutes || durationMinutes <= 0) throw new Error('请输入有效的目标时长');

    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal_type: goalType,
        category: categoryMap[goalType],
        target_duration: durationMinutes * 60,
        date: todayString()
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '创建目标失败');
    }

    setNote('目标已添加', 'success');
    log(`已添加目标：${goalTypeNames[goalType]} ${durationMinutes} 分钟`);
    await loadGoals();
  } catch (error) {
    setNote(`创建目标失败：${error.message}`, 'danger');
    log(`创建目标失败：${error.message}`);
  }
}

async function loadGoals() {
  const list = document.getElementById('goalList');
  try {
    await initDataSync();
    const connected = await dataSync.checkConnection();
    if (!connected) {
      list.innerHTML = '<div class="goal-card"><div><strong>后端未连接</strong><p>连接后端后可管理目标。</p></div></div>';
      return;
    }

    await dataSync.initUserId();
    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${dataSync.userId}?date=${todayString()}&is_active=1`);
    if (!response.ok) throw new Error('获取目标失败');

    const goals = await response.json();
    if (!goals.length) {
      list.innerHTML = '<div class="goal-card"><div><strong>暂无目标</strong><p>添加一个今日目标开始追踪。</p></div></div>';
      return;
    }

    list.innerHTML = goals.map(goal => `
      <div class="goal-card">
        <div>
          <strong>${goalTypeNames[goal.goal_type] || goal.goal_type}</strong>
          <p>${formatDuration(goal.current_progress)} / ${formatDuration(goal.target_duration)} · ${goal.progress_percentage.toFixed(1)}%</p>
        </div>
        <button class="danger" data-goal-id="${goal.id}">删除</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-goal-id]').forEach(button => {
      button.addEventListener('click', () => deleteGoal(button.dataset.goalId));
    });
  } catch (error) {
    list.innerHTML = `<div class="goal-card"><div><strong>加载失败</strong><p>${error.message}</p></div></div>`;
  }
}

async function deleteGoal(goalId) {
  if (!confirm('确定删除这个目标吗？')) return;

  try {
    const response = await fetch(`${dataSync.apiBaseUrl}/api/goals/${goalId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('删除失败');
    setNote('目标已删除', 'success');
    log(`已删除目标 #${goalId}`);
    await loadGoals();
  } catch (error) {
    setNote(`删除目标失败：${error.message}`, 'danger');
    log(`删除目标失败：${error.message}`);
  }
}

async function saveApiBaseUrl() {
  const value = document.getElementById('apiBaseUrlInput').value.trim() || DEFAULT_API_BASE_URL;
  await chrome.storage.local.set({ apiBaseUrl: value });
  await initDataSync();
  setNote('后端地址已保存', 'success');
  log(`后端地址已保存：${value}`);
  await refreshStatus();
}

async function resetApiBaseUrl() {
  await chrome.storage.local.set({ apiBaseUrl: DEFAULT_API_BASE_URL });
  await initDataSync();
  setNote('已恢复默认后端地址', 'success');
  log('已恢复默认后端地址');
  await refreshStatus();
}

async function testApiConnection() {
  await initDataSync();
  const connected = await dataSync.checkConnection();
  setNote(connected ? '连接成功' : '连接失败，请检查后端服务', connected ? 'success' : 'danger');
  log(connected ? '后端连接测试成功' : '后端连接测试失败');
}

async function exportJson() {
  const { browsingData = [] } = await chrome.storage.local.get('browsingData');
  const blob = new Blob([JSON.stringify(browsingData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `browsemind-${todayString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setNote('JSON 已导出', 'success');
  log(`已导出 ${browsingData.length} 条本地记录`);
}

async function clearLocalData() {
  if (!confirm('确定清空本地浏览数据吗？此操作不可恢复。')) return;
  await chrome.storage.local.set({ browsingData: [] });
  setNote('本地数据已清空', 'success');
  log('本地浏览数据已清空');
  await refreshStatus();
}

function bindEvents() {
  document.getElementById('refreshBtn').addEventListener('click', refreshStatus);
  document.getElementById('syncBtn').addEventListener('click', syncNow);
  document.getElementById('aiBtn').addEventListener('click', runAIAnalysis);
  document.getElementById('createGoalBtn').addEventListener('click', createGoal);
  document.getElementById('saveApiBtn').addEventListener('click', saveApiBaseUrl);
  document.getElementById('resetApiBtn').addEventListener('click', resetApiBaseUrl);
  document.getElementById('testApiBtn').addEventListener('click', testApiConnection);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
  document.getElementById('clearLocalBtn').addEventListener('click', clearLocalData);
  document.getElementById('openPopupHelpBtn').addEventListener('click', () => {
    setNote('Chrome 扩展弹窗无法由页面直接打开，请点击浏览器工具栏中的 BrowseMind 图标。');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await refreshStatus();
});
