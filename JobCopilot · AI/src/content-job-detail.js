// ===== 岗位详情页 content script：只读提取岗位名称与 JD =====
(function () {
  if (window.__jobCopilotDetailReader) return;
  window.__jobCopilotDetailReader = true;

  function visible(element) {
    return Boolean(element && (element.offsetParent !== null || getComputedStyle(element).position === 'fixed'));
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = clean(element.innerText || element.textContent);
        if (visible(element) && text) return text;
      }
    }
    return '';
  }

  function collectDescription() {
    const selectors = [
      '.job-sec-text',
      '.job-detail-section .text',
      '.job-detail-section',
      '.job-description',
      '[class*="job-description"]',
      '[class*="job-desc"]',
      '[class*="job-detail"] [class*="text"]'
    ];
    const blocks = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const text = clean(element.innerText || element.textContent);
        if (text.length < 40 || seen.has(text)) continue;
        seen.add(text);
        blocks.push(text);
      }
    }
    if (blocks.length) {
      blocks.sort((left, right) => right.length - left.length);
      return blocks[0].slice(0, 5000);
    }

    const bodyText = clean(document.body && document.body.innerText);
    const marker = bodyText.search(/职位描述|岗位职责|任职要求/);
    if (marker >= 0) return bodyText.slice(marker, marker + 5000);
    return '';
  }

  function readDetail() {
    return {
      success: true,
      title: firstText(['h1', '.job-name', '[class*="job-name"]', '.name']),
      company: firstText(['.company-info .name', '.company-name', '[class*="company-name"]']),
      jd: collectDescription(),
      url: location.href
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'READ_JOB_DETAIL') return;
    try {
      const result = readDetail();
      if (!result.jd) {
        sendResponse({ success: false, error: '岗位详情页未读取到 JD', title: result.title, url: result.url });
      } else {
        sendResponse(result);
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message || '岗位详情读取失败' });
    }
  });
})();
