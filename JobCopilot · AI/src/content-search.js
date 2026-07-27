// ===== 搜索页 content script：收集岗位 + 建立联系（立即沟通→继续沟通跳聊天页）=====
(function () {
  if (window.__bossToudiSearch) return;
  window.__bossToudiSearch = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const jobData = globalThis.JobDataCore;

  function getCards() { return Array.from(document.querySelectorAll(SELECTORS.jobs.jobCard)); }

  function readElementText(element, attributes) {
    if (!element) return '';
    for (const attribute of attributes || []) {
      const value = element.getAttribute && element.getAttribute(attribute);
      if (value && String(value).trim()) return String(value).trim();
    }
    return (element.innerText || element.textContent || '').trim();
  }

  function parseCard(card) {
    const nameEl = card.querySelector(SELECTORS.jobs.jobName);
    const salEl = card.querySelector(SELECTORS.jobs.jobSalary);
    const compEl = card.querySelector(SELECTORS.jobs.company);
    const areaEl = card.querySelector(SELECTORS.jobs.area);
    const linkEl = card.querySelector('a[href*="/job_detail/"]') || card.querySelector('a[ka][href]') || card.querySelector('a');
    const link = linkEl ? linkEl.href : '';
    const m = link.match(/job_detail\/([^.?]+)\.html/);
    const id = (m && m[1]) || ((nameEl ? nameEl.textContent.trim() : '') + '|' + (salEl ? salEl.textContent.trim() : ''));
    const tags = Array.from(card.querySelectorAll(SELECTORS.jobs.tagList)).map(t => t.textContent.trim()).filter(Boolean);
    const salaryRaw = readElementText(salEl, ['aria-label', 'title', 'data-salary', 'data-value']);
    const salaryObfuscated = jobData ? jobData.hasPrivateUseCharacters(salaryRaw) : false;
    return {
      id: id,
      name: readElementText(nameEl, ['aria-label', 'title']) || '未知岗位',
      salary: jobData ? jobData.readableSalary(salaryRaw) : salaryRaw,
      salaryRaw: salaryRaw,
      salaryObfuscated: salaryObfuscated,
      tags: tags,
      company: readElementText(compEl, ['aria-label', 'title', 'data-name', 'data-company']),
      area: readElementText(areaEl, ['aria-label', 'title', 'data-area', 'data-location']),
      link: link
    };
  }

  async function fetchApiJobs(count) {
    if (!jobData) return { jobs: [], warning: '岗位字段解析组件未加载，已回退到页面文字' };
    const pageSize = 30;
    const pageCount = Math.max(1, Math.ceil(Math.min(200, count || 20) / pageSize));
    const jobs = [];
    const seen = new Set();
    try {
      for (let page = 1; page <= pageCount; page++) {
        const query = jobData.buildSearchParams(location.search, page, pageSize);
        const response = await fetch('/wapi/zpgeek/search/joblist.json?' + query, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        if (payload.code !== 0) throw new Error(payload.message || payload.msg || ('code ' + payload.code));
        const pageJobs = jobData.extractApiJobs(payload, location.origin);
        for (const job of pageJobs) {
          const key = job.id || (job.name + '|' + job.company);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          jobs.push(job);
        }
        const hasMore = payload.zpData && payload.zpData.hasMore;
        if (!pageJobs.length || hasMore === false || jobs.length >= count) break;
        await sleep(180);
      }
      return { jobs: jobs, warning: '' };
    } catch (error) {
      return {
        jobs: jobs,
        warning: 'BOSS 明文薪资接口暂不可用（' + (error.message || '未知错误') + '），已回退到页面字段'
      };
    }
  }

  async function scrape(count) {
    const seen = {};
    const jobs = [];
    let stall = 0;
    for (let loop = 0; loop < 40 && jobs.length < count && stall < 4; loop++) {
      const cards = getCards();
      let added = 0;
      for (const c of cards) {
        const j = parseCard(c);
        if (j.id && !seen[j.id]) { seen[j.id] = 1; jobs.push(j); added++; if (jobs.length >= count) break; }
      }
      if (added === 0) stall++; else stall = 0;
      if (jobs.length >= count) break;
      window.scrollTo(0, document.body.scrollHeight);
      const container = document.querySelector('.job-list-container, .job-list-box, [class*="job-list"]');
      if (container) container.scrollTop = container.scrollHeight;
      await sleep(1200);
    }
    const apiResult = await fetchApiJobs(count);
    const merged = jobData
      ? jobData.mergeJobs(jobs, apiResult.jobs, count)
      : jobs.slice(0, count);
    return { jobs: merged, warning: apiResult.warning };
  }

  function findCardByJob(job) {
    const cards = getCards();
    for (const c of cards) { const j = parseCard(c); if (job.id && j.id === job.id) return c; }
    if (job.id) return null;
    for (const c of cards) {
      const j = parseCard(c);
      if (j.name === job.name && job.company && j.company === job.company) return c;
    }
    return null;
  }

  function waitFor(sel, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { clearInterval(iv); resolve(el); }
        else if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
      }, 200);
    });
  }

  // 等待出现文字完全匹配的可见元素（用于弹窗"继续沟通"按钮）
  function waitForText(texts, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const els = document.querySelectorAll('a, button, span, div');
        for (const el of els) {
          const tx = (el.textContent || '').trim();
          if (texts.indexOf(tx) >= 0 && el.offsetParent !== null) { clearInterval(iv); resolve(el); return; }
        }
        if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
      }, 200);
    });
  }

  // 点开卡片 → 抓取右侧详情面板的完整JD
  async function openJD(job) {
    const card = findCardByJob(job);
    if (!card) return { success: false, error: '未找到岗位卡片' };
    card.scrollIntoView({ block: 'center' });
    await sleep(400);
    card.click();
    await sleep(1600);
    let jd = '';
    const det = document.querySelector('.job-detail-box, [class*="job-detail"], .detail-content, .job-detail');
    if (det) jd = (det.innerText || '').trim();
    if (!jd) {
      const secs = document.querySelectorAll('.job-sec-text, [class*="job-sec"], [class*="job-desc"]');
      jd = Array.from(secs).map(s => (s.innerText || '').trim()).filter(Boolean).join('\n');
    }
    return { success: true, jd: jd.slice(0, 1800) };
  }

  // 卡片已打开 → 点立即沟通 → 弹窗点"继续沟通"（跳转聊天页）
  async function goChat(job) {
    const card = findCardByJob(job);
    if (!card) return { success: false, error: '未找到本轮精确岗位卡片' };
    const current = parseCard(card);
    if (!job.id || current.id !== job.id) return { success: false, error: '岗位 ID 校验失败' };
    card.scrollIntoView({ block: 'center' });
    await sleep(350);
    card.click();
    await sleep(1400);

    let btn = await waitFor(SELECTORS.jobs.immediateChatBtn, 5000);
    if (!btn) {
      const all = document.querySelectorAll('a, button, span');
      for (const el of all) {
        const tx = (el.textContent || '').trim();
        if (tx === '立即沟通' && el.offsetParent !== null) { btn = el; break; }
      }
    }
    if (!btn) return { success: false, error: '未找到立即沟通按钮' };
    btn.click();
    await sleep(1500);
    const go = await waitForText(['继续沟通'], 4000);
    if (go) {
      // 先让消息响应送达后台，再触发会使本页进入 BFCache 的导航。
      setTimeout(() => go.click(), 80);
      return { success: true, navigated: true };
    }
    return { success: true, navigated: false };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE') {
      scrape(msg.count || 20)
        .then(result => sendResponse({ success: true, jobs: result.jobs, warning: result.warning }))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'OPEN_JD') {
      openJD(msg.job).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'GO_CHAT' || msg.type === 'INITIATE' || msg.type === 'CREATE_CONV') {
      goChat(msg.job).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
})();
