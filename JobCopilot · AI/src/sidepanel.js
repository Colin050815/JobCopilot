// ===== 侧边栏交互 =====
const $ = (id) => document.getElementById(id);
const CFG_FIELDS = ['muskApiKey', 'gptModel', 'resumeText', 'keyword', 'city', 'count'];
const DEFAULT_MODEL = 'gpt-5.6-terra';
let selectedResumeFile = null;

// 折叠
document.querySelectorAll('.card-h[data-toggle]').forEach(h => {
  h.addEventListener('click', () => {
    const body = $(h.dataset.toggle);
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  });
});

// 载入配置
chrome.storage.local.get(CFG_FIELDS.concat(['resumeImage']), (d) => {
  CFG_FIELDS.forEach(f => { if (d[f] !== undefined && $(f)) $(f).value = d[f]; });
  if (!d.gptModel) $('gptModel').value = DEFAULT_MODEL;
  if (d.resumeImage) showImg(d.resumeImage);
});

function showImg(dataUrl) { $('imgPrev').innerHTML = '<img src="' + dataUrl + '">'; }

$('resumeImg').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { showImg(ev.target.result); chrome.storage.local.set({ resumeImage: ev.target.result }); };
  reader.readAsDataURL(file);
});

function setParseStatus(text, level) {
  const status = $('resumeParseStatus');
  status.textContent = text;
  status.className = 'parse-status' + (level ? ' ' + level : '');
}

function setButtonBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
  }
}

$('resumeFile').addEventListener('change', (event) => {
  selectedResumeFile = event.target.files[0] || null;
  $('btnOcrResume').hidden = true;
  if (!selectedResumeFile) {
    setParseStatus('PDF、DOCX、TXT、MD 在本机解析；扫描 PDF/图片需单独确认后发送 MuskAI。');
    return;
  }
  const kind = globalThis.ResumeParserCore
    ? globalThis.ResumeParserCore.fileKind(selectedResumeFile)
    : '';
  if (kind === 'image') {
    $('btnOcrResume').hidden = false;
    setParseStatus('图片不会自动上传。点击“使用 MuskAI OCR”并确认后才会发送识别。', 'warn');
  } else {
    setParseStatus('已选择 ' + selectedResumeFile.name + '，点击“本地解析到文本框”。');
  }
});

$('btnParseResume').addEventListener('click', async () => {
  if (!selectedResumeFile) return setParseStatus('请先选择简历文件', 'error');
  if (!globalThis.resumeParser) return setParseStatus('解析组件尚未就绪，请稍候或重新加载扩展', 'error');

  const button = $('btnParseResume');
  setButtonBusy(button, true, '解析中…');
  $('btnOcrResume').hidden = true;
  try {
    const result = await globalThis.resumeParser.parse(selectedResumeFile);
    if (result.needsOcr) {
      $('btnOcrResume').hidden = false;
      const label = result.format === 'pdf' ? '扫描版或文字过少的 PDF' : '图片简历';
      setParseStatus(label + ' 需要 MuskAI OCR。只有点击右侧按钮并确认后才会上传。', 'warn');
      return;
    }
    $('resumeText').value = result.text;
    const pageInfo = result.pageCount ? '，共 ' + result.pageCount + ' 页' : '';
    setParseStatus('本地解析成功' + pageInfo + '，已填入简历文字；请检查内容后保存。', 'success');
    addLog('简历已在本机解析：' + selectedResumeFile.name, 'success');
  } catch (error) {
    setParseStatus(error.message || '简历解析失败', 'error');
    addLog(error.message || '简历解析失败', 'error');
  } finally {
    setButtonBusy(button, false);
  }
});

$('btnOcrResume').addEventListener('click', async () => {
  if (!selectedResumeFile) return setParseStatus('请先选择扫描 PDF 或图片', 'error');
  if (!globalThis.resumeParser) return setParseStatus('解析组件尚未就绪，请稍候或重新加载扩展', 'error');
  if (!$('muskApiKey').value.trim()) return setParseStatus('请先填写 MuskAI API Key', 'error');
  if (!confirm('将把扫描 PDF 页面或图片发送到 MuskAI 进行文字识别，是否继续？')) return;

  await saveCfgSync();
  const button = $('btnOcrResume');
  setButtonBusy(button, true, 'OCR 识别中…');
  try {
    setParseStatus('正在本机渲染扫描件，随后发送 MuskAI 识别…', 'warn');
    const images = await globalThis.resumeParser.prepareOcrImages(selectedResumeFile);
    const result = await sendRuntimeMessage({ type: 'OCR_RESUME', images: images });
    if (!result || !result.ok) throw new Error((result && result.error) || 'MuskAI OCR 失败');
    $('resumeText').value = result.text;
    setParseStatus('MuskAI OCR 成功，已填入简历文字；请检查内容后保存。', 'success');
    addLog('简历 OCR 完成：' + result.model, 'success');
  } catch (error) {
    setParseStatus(error.message || 'MuskAI OCR 失败', 'error');
    addLog(error.message || 'MuskAI OCR 失败', 'error');
  } finally {
    setButtonBusy(button, false);
  }
});

function readFormCfg() {
  const obj = {};
  CFG_FIELDS.forEach(f => { obj[f] = $(f).value.trim ? $(f).value.trim() : $(f).value; });
  return obj;
}

$('saveCfg').addEventListener('click', () => {
  const obj = readFormCfg();
  chrome.storage.local.set(obj, () => { const s = $('saved'); s.style.display = 'inline'; setTimeout(() => s.style.display = 'none', 1500); });
});

function saveCfgSync() {
  return new Promise(res => {
    chrome.storage.local.set(readFormCfg(), res);
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

$('btnTestAI').addEventListener('click', async () => {
  await saveCfgSync();
  if (!$('muskApiKey').value.trim()) return addLog('请先填写 MuskAI API Key', 'error');

  const button = $('btnTestAI');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '测试中…';
  addLog('正在测试 MuskAI ' + $('gptModel').value + ' 连接…', 'info');
  try {
    const result = await sendRuntimeMessage({ type: 'TEST_AI' });
    if (!result || !result.ok) throw new Error((result && result.error) || '连接测试失败');
    addLog('AI 连接成功：' + result.model, 'success');
  } catch (error) {
    addLog(error.message || 'AI 连接测试失败', 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

// 运行控制
$('btnCollect').addEventListener('click', async () => {
  await saveCfgSync();
  if (!$('muskApiKey').value.trim()) return addLog('请先填 MuskAI API Key', 'error');
  if (!$('keyword').value.trim()) return addLog('请先填岗位关键词', 'error');
  $('reviewCard').style.display = 'none';
  setRunning(true);
  chrome.runtime.sendMessage({ type: 'START_COLLECT' });
});

$('btnDeliver').addEventListener('click', () => {
  const ids = Array.from(document.querySelectorAll('.job-item input:checked')).map(c => c.dataset.id);
  if (!ids.length) return addLog('请至少勾选一个岗位', 'error');
  setRunning(true);
  addLog('开始投递 ' + ids.length + ' 个岗位', 'info');
  chrome.runtime.sendMessage({ type: 'START_DELIVER', jobIds: ids });
});

$('btnPause').addEventListener('click', () => {
  if ($('btnPause').textContent === '暂停') { $('btnPause').textContent = '继续'; chrome.runtime.sendMessage({ type: 'PAUSE' }); }
  else { $('btnPause').textContent = '暂停'; chrome.runtime.sendMessage({ type: 'RESUME' }); }
});
$('btnStop').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'STOP' }); setRunning(false); });
$('btnReset').addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'RESET' }); $('reviewCard').style.display = 'none'; setRunning(false); });
$('clearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

$('selAll').addEventListener('change', (e) => {
  document.querySelectorAll('.job-item:not(.skip) input').forEach(c => c.checked = e.target.checked);
});

function setRunning(running) {
  $('btnCollect').disabled = running;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;
  if (!running) $('btnPause').textContent = '暂停';
}

// 渲染审核列表
function renderReview(screened) {
  const matched = screened.filter(j => j.match);
  const skipped = screened.filter(j => !j.match);
  $('reviewCount').textContent = '匹配 ' + matched.length + ' / ' + screened.length;
  let html = '';
  matched.forEach(j => {
    html += '<div class="job-item"><input type="checkbox" checked data-id="' + esc(j.id) + '">'
      + '<div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + renderJobMeta(j)
      + '<div class="job-reason m">✓ ' + esc(j.reason) + '</div></div></div>';
  });
  skipped.forEach(j => {
    html += '<div class="job-item skip"><input type="checkbox" disabled data-id="' + esc(j.id) + '">'
      + '<div class="job-main"><div class="job-title">' + esc(j.name) + '</div>'
      + renderJobMeta(j)
      + '<div class="job-reason s">✗ ' + esc(j.reason) + '</div></div></div>';
  });
  $('reviewList').innerHTML = html || '<div class="job-sub">无岗位</div>';
  $('reviewCard').style.display = 'block';
}
function renderJobMeta(job) {
  const salaryFallback = job.salaryUnavailable ? '需在 BOSS 查看' : '未获取';
  const fields = [
    ['公司', job.company || '未获取', !job.company],
    ['薪资', job.salary || salaryFallback, !job.salary],
    ['地区', job.area || '未获取', !job.area]
  ];
  return '<div class="job-meta">' + fields.map(field => {
    return '<span class="' + (field[2] ? 'missing' : '') + '"><b>' +
      field[0] + '：</b>' + esc(field[1]) + '</span>';
  }).join('') + '</div>';
}
function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// 消息接收
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG') addLog(msg.text, msg.level);
  if (msg.type === 'PROGRESS') $('progText').textContent = (msg.label ? msg.label + ' ' : '') + msg.cur + '/' + msg.total;
  if (msg.type === 'PHASE') {
    const map = { idle: '未开始', collecting: '收集中', screening: 'AI筛选中', review: '待审核', delivering: '投递中', done: '已完成' };
    $('phaseText').textContent = map[msg.phase] || msg.phase;
    if (msg.phase === 'review' || msg.phase === 'done' || msg.phase === 'idle') setRunning(false);
  }
  if (msg.type === 'SCREENED') renderReview(msg.screened);
  if (msg.type === 'DONE') { setRunning(false); $('progText').textContent = ''; }
});

function addLog(text, level) {
  level = level || 'info';
  const now = new Date();
  const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  const el = document.createElement('div');
  el.className = 'log-item ' + level;
  el.innerHTML = '<span class="log-time">[' + t + ']</span>' + esc(text);
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}
