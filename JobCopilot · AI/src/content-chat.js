// ===== 聊天页 content script：打开会话 + 先发图片 + 再发招呼语 =====
(function () {
  if (window.__bossToudiChat) return;
  window.__bossToudiChat = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 多选择器找第一个可见元素
  function findVisible(selList) {
    for (const sel of selList) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')) return el;
      }
    }
    return null;
  }
  async function waitVisible(selList, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = findVisible(selList);
      if (el) return el;
      await sleep(250);
    }
    return null;
  }

  const INPUT_SELS = ['div#chat-input', '#chat-input', 'div.chat-input', '.chat-input[contenteditable]', '[contenteditable="true"]', 'textarea.input-area', '.chat-editor textarea', 'textarea[placeholder]', 'textarea'];
  const SEND_SELS = ['button.btn-send', '.btn-send', 'button[class*="send"]', '[class*="send-btn"]'];
  const IMG_SELS = ['.btn-sendimg input[type=file]', '.toolbar input[type=file]', 'input[type=file]'];
  const CHAT_LIST_SELS = [
    SELECTORS.chat.userList,
    '.user-list-content li',
    '[class*="chat-list"] li',
    '[class*="conversation-list"] li'
  ];

  function isVisible(element) {
    return Boolean(element && (element.offsetParent !== null || getComputedStyle(element).position === 'fixed'));
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getConversationItems() {
    const items = [];
    const seen = new Set();
    for (const selector of CHAT_LIST_SELS) {
      for (const item of document.querySelectorAll(selector)) {
        if (!isVisible(item) || seen.has(item)) continue;
        seen.add(item);
        items.push(item);
      }
    }
    return items;
  }

  function firstItemText(item, selectors) {
    for (const selector of selectors) {
      const element = item.querySelector(selector);
      const text = clean(element && (element.innerText || element.textContent));
      if (text) return text;
    }
    return '';
  }

  function readConversationItem(item, index) {
    const rawText = clean(item.innerText || item.textContent);
    const timeMatch = rawText.match(/(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}|\d{1,2}月\d{1,2}日)\s+\d{1,2}:\d{2}|(?:昨天\s*)?\d{1,2}:\d{2}/);
    const timeText = timeMatch ? timeMatch[0] : '';
    const preview = firstItemText(item, [
      '.last-msg',
      '.last-message',
      '[class*="last-msg"]',
      '[class*="last-message"]',
      '[class*="message-preview"]'
    ]) || (rawText.match(/\[送达\][\s\S]*$/) || [''])[0];
    const hrName = firstItemText(item, [
      '.geek-name',
      '.name-text',
      '.user-name',
      '[class*="user-name"]',
      '[class*="name-text"]'
    ]);
    const company = firstItemText(item, [
      '.company-name',
      '[class*="company-name"]',
      '[class*="brand-name"]'
    ]);
    const position = firstItemText(item, [
      '.position-name',
      '.job-name',
      '.job-title',
      '[class*="position-name"]',
      '[class*="job-name"]'
    ]);
    const identityText = clean(rawText
      .replace(preview, '')
      .replace(timeText, ''))
      .slice(0, 180);
    const dataKey = [
      'data-id',
      'data-conversation-id',
      'data-chat-id',
      'data-encrypt-job-id',
      'data-job-id'
    ].map(attribute => clean(item.getAttribute(attribute))).find(Boolean) || '';
    const jobLink = item.querySelector('a[href*="/job_detail/"]');
    const matchKey = identityText + '|' + timeText;
    return {
      id: dataKey ? 'chat:' + dataKey : 'chat-key:' + matchKey,
      dataKey: dataKey,
      matchKey: matchKey,
      hrName: hrName || identityText.split(' ')[0] || '未知 HR',
      company: company,
      position: position,
      timeText: timeText,
      preview: clean(preview),
      identityText: identityText,
      jobUrl: jobLink ? jobLink.href : ''
    };
  }

  function findActiveJobContext() {
    const listItems = getConversationItems();
    const outsideList = element => !listItems.some(item => item.contains(element));
    const links = Array.from(document.querySelectorAll('a[href*="/job_detail/"]'))
      .filter(element => isVisible(element) && outsideList(element));
    const textOutsideList = selectors => {
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (!isVisible(element) || !outsideList(element)) continue;
          const text = clean(element.innerText || element.textContent);
          if (text) return text;
        }
      }
      return '';
    };
    return {
      jobUrl: links[0] ? links[0].href : '',
      position: textOutsideList([
        '.position-name',
        '.job-name',
        '.job-title',
        '[class*="position-name"]',
        '[class*="job-name"]'
      ]),
      company: textOutsideList(['.company-name', '[class*="company-name"]', '[class*="brand-name"]'])
    };
  }

  function normalizedJobPath(value) {
    try {
      const url = new URL(value, location.origin);
      const match = url.pathname.match(/\/job_detail\/[^/?#]+/);
      return match ? match[0] : url.pathname;
    } catch (error) {
      return '';
    }
  }

  function itemShowsSelected(item) {
    if (!item) return false;
    if (item.getAttribute('aria-selected') === 'true' || item.getAttribute('data-selected') === 'true') {
      return true;
    }
    const tokens = clean(item.className).toLowerCase().split(/\s+/);
    return tokens.some(token => /^(active|selected|current|is-active|is-selected)$/.test(token));
  }

  async function confirmConversationTarget(item, target, timeout) {
    const wantedPath = normalizedJobPath(target && target.jobUrl);
    const startedAt = Date.now();
    while (Date.now() - startedAt < (timeout || 5000)) {
      if (itemShowsSelected(item)) return true;
      const context = findActiveJobContext();
      const currentPath = normalizedJobPath(context.jobUrl);
      if (wantedPath && currentPath && wantedPath === currentPath) return true;
      await sleep(250);
    }
    return false;
  }

  async function scanMobileConversations(params) {
    await waitVisible(CHAT_LIST_SELS, 8000);
    const all = getConversationItems().slice(0, 100).map(readConversationItem);
    const core = globalThis.MobileFollowupCore;
    if (!core) return { success: false, error: '手机投递扫描组件未加载' };
    const candidates = core.filterCandidates(all, params, new Date()).slice(0, 30);
    const enriched = [];
    for (const candidate of candidates) {
      const items = getConversationItems();
      let matches = [];
      if (candidate.dataKey) {
        matches = items.filter(item => {
          return [
            'data-id',
            'data-conversation-id',
            'data-chat-id',
            'data-encrypt-job-id',
            'data-job-id'
          ].some(attribute => clean(item.getAttribute(attribute)) === candidate.dataKey);
        });
      }
      if (!matches.length) {
        matches = items.filter((item, index) => readConversationItem(item, index).matchKey === candidate.matchKey);
      }
      if (matches.length !== 1) {
        enriched.push(Object.assign({}, candidate, { scanError: '会话标识不唯一，已跳过' }));
        continue;
      }
      matches[0].click();
      await sleep(900);
      const context = findActiveJobContext();
      enriched.push(Object.assign({}, candidate, {
        jobUrl: context.jobUrl || candidate.jobUrl,
        position: context.position || candidate.position,
        company: context.company || candidate.company
      }));
    }
    return { success: true, conversations: enriched, scannedCount: all.length };
  }

  async function sendMobileFollowup(target, text) {
    if (!target.jobUrl) {
      return { success: false, error: '目标会话缺少岗位链接，已阻止发送' };
    }
    const items = getConversationItems();
    let matches = [];
    if (target.dataKey) {
      matches = items.filter(item => {
        return [
          'data-id',
          'data-conversation-id',
          'data-chat-id',
          'data-encrypt-job-id',
          'data-job-id'
        ].some(attribute => clean(item.getAttribute(attribute)) === target.dataKey);
      });
    }
    if (!matches.length) {
      matches = items.filter((item, index) => readConversationItem(item, index).matchKey === target.matchKey);
    }
    if (matches.length !== 1) {
      return { success: false, error: '未能唯一定位目标会话，已阻止发送' };
    }
    matches[0].click();
    const confirmed = await confirmConversationTarget(matches[0], target, 6000);
    if (!confirmed) {
      return { success: false, error: '点击后无法确认当前会话对应目标岗位，已阻止发送' };
    }
    await sleep(300);
    const result = await sendText(text);
    if (!result.ok) return { success: false, uncertain: true, error: result.err };
    return { success: true };
  }

  // 诊断：把页面里可编辑元素结构dump成字符串（找不到输入框时回传，便于定位）
  function dumpInputs() {
    const out = [];
    document.querySelectorAll('[contenteditable="true"], textarea, div[id*="input"], div[class*="input"]').forEach((el, i) => {
      if (i < 8) out.push(el.tagName + '#' + (el.id || '') + '.' + (typeof el.className === 'string' ? el.className.slice(0, 40) : ''));
    });
    return out.join(' | ') || '无可编辑元素';
  }

  function dataURLtoFile(dataUrl, name) {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    if (!mimeMatch || !parts[1]) throw new Error('投递图片数据无效');
    const mime = mimeMatch[1];
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const extension = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png');
    return new File([arr], (name || 'resume') + '.' + extension, { type: mime });
  }

  async function openConversation(company, hrName, position) {
    await waitVisible([SELECTORS.chat.userList], 8000);
    const items = Array.from(document.querySelectorAll(SELECTORS.chat.userList));
    if (!items.length) return { ok: false, err: '会话列表为空' };
    let target = null;
    const ck = (company || '').replace(/\s/g, '');
    const hk = (hrName || '').replace(/\s/g, '');
    const pk = (position || '').replace(/\s/g, '');
    for (const li of items) {
      const tx = (li.textContent || '').replace(/\s/g, '');
      if (ck && tx.indexOf(ck) >= 0) { target = li; break; }
      if (pk && tx.indexOf(pk) >= 0) { target = li; break; }
      if (hk && tx.indexOf(hk) >= 0) { target = li; break; }
    }
    if (!target) target = items[0]; // 兜底：最新一条（刚建联的通常在顶部）
    target.click();
    await sleep(1600);
    return { ok: true };
  }

  async function sendImage(image, index) {
    if (!image) return true;
    const input = findVisible(IMG_SELS) || document.querySelector('input[type=file]');
    if (!input) return false;
    const file = dataURLtoFile(image, 'resume-page-' + (index + 1));
    const dt = new DataTransfer();
    dt.items.add(file);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    setter.call(input, dt.files);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2500);
    return true;
  }

  async function sendImages(images) {
    const list = (images || []).filter(Boolean);
    let sentCount = 0;
    for (let index = 0; index < list.length; index++) {
      const ok = await sendImage(list[index], index);
      if (!ok) return { ok: false, sentCount: sentCount };
      sentCount++;
      if (index < list.length - 1) await sleep(700);
    }
    return { ok: true, sentCount: sentCount };
  }

  function inputText(el) { return (el.isContentEditable || el.getAttribute('contenteditable') === 'true') ? (el.textContent || '') : (el.value || ''); }

  function pressEnter(el) {
    const opt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opt));
    el.dispatchEvent(new KeyboardEvent('keypress', opt));
    el.dispatchEvent(new KeyboardEvent('keyup', opt));
  }

  async function waitTextSendConfirmation(input, before, attempts) {
    for (let i = 0; i < attempts; i++) {
      await sleep(300);
      const cleared = !inputText(input).trim();
      const after = document.querySelectorAll(SELECTORS.chat.messageSent).length;
      if (cleared || after > before) return true;
    }
    return false;
  }

  async function sendText(greeting) {
    const input = await waitVisible(INPUT_SELS, 8000);
    if (!input) return { ok: false, err: '未找到输入框｜页面候选：' + dumpInputs() };
    input.focus();
    await sleep(300);
    const editable = input.isContentEditable || input.getAttribute('contenteditable') === 'true';
    if (editable) {
      input.textContent = greeting;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: greeting }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, greeting);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(700);
    if (!inputText(input).trim()) return { ok: false, err: '文字未填入输入框' };

    const before = document.querySelectorAll(SELECTORS.chat.messageSent).length;
    // 以回车为主发送
    pressEnter(input);
    if (await waitTextSendConfirmation(input, before, 8)) return { ok: true };

    // 回车在 2.4 秒内未触发发送时才点击按钮，避免同一段文字被发送两次
    const btn = findVisible(SEND_SELS);
    if (btn && !btn.classList.contains('disabled') && !btn.disabled) btn.click();
    if (await waitTextSendConfirmation(input, before, 8)) return { ok: true };
    return { ok: false, err: '发送未确认（输入框未清空、未见新气泡）' };
  }

  async function doSend(msg) {
    const oc = await openConversation(msg.company, msg.hrName, msg.position);
    if (!oc.ok) return { success: false, error: oc.err };
    const images = Array.isArray(msg.images) ? msg.images : (msg.image ? [msg.image] : []);
    const imageResult = await sendImages(images);
    if (!imageResult.ok) {
      return {
        success: false,
        uncertain: imageResult.sentCount > 0,
        error: '投递图片发送失败（已发送 ' + imageResult.sentCount + ' 张）'
      };
    }
    await sleep(800);
    const tr = await sendText(msg.greeting);
    if (!tr.ok) return { success: false, uncertain: true, error: tr.err };
    return { success: true, imageCount: imageResult.sentCount };
  }

  // 发给当前已打开的会话（点继续沟通后跳进来的就是目标岗位，无需匹配）
  async function sendActive(images, greeting) {
    let input = await waitVisible(INPUT_SELS, 6000);
    if (!input) {
      const items = document.querySelectorAll(SELECTORS.chat.userList);
      if (items[0]) { items[0].click(); await sleep(1500); }
      input = await waitVisible(INPUT_SELS, 6000);
    }
    if (!input) return { success: false, error: '未找到输入框｜' + dumpInputs() };
    const imageResult = await sendImages(images);
    if (!imageResult.ok) {
      return {
        success: false,
        uncertain: imageResult.sentCount > 0,
        error: '投递图片发送失败（已发送 ' + imageResult.sentCount + ' 张）'
      };
    }
    await sleep(800);
    const tr = await sendText(greeting);
    if (!tr.ok) return { success: false, uncertain: true, error: tr.err };
    return { success: true, imageCount: imageResult.sentCount };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SEND') {
      doSend(msg).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'SEND_ACTIVE') {
      const images = Array.isArray(msg.images) ? msg.images : (msg.image ? [msg.image] : []);
      sendActive(images, msg.greeting).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'SCAN_MOBILE_CONVERSATIONS') {
      scanMobileConversations(msg.params || {})
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'SEND_MOBILE_FOLLOWUP') {
      sendMobileFollowup(msg.target || {}, msg.text || '')
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, uncertain: true, error: e.message }));
      return true;
    }
  });
})();
