(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResumeParserCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_OCR_PAGES = 5;
  const MIN_LOCAL_TEXT_CHARS = 80;
  const TEXT_EXTENSIONS = Object.freeze(['txt', 'md']);
  const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

  class ResumeParseError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ResumeParseError';
      this.code = code;
    }
  }

  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : '';
  }

  function cleanExtractedText(text) {
    return String(text || '')
      .replace(/\u0000/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function meaningfulLength(text) {
    return cleanExtractedText(text).replace(/\s/g, '').length;
  }

  function validateFile(file) {
    if (!file || typeof file.name !== 'string') {
      throw new ResumeParseError('请先选择简历文件', 'missing_file');
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new ResumeParseError('简历文件为空', 'empty_file');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ResumeParseError('简历文件不能超过 15 MB', 'file_too_large');
    }
  }

  function fileKind(file) {
    const ext = extensionOf(file && file.name);
    const type = String(file && file.type || '').toLowerCase();
    if (TEXT_EXTENSIONS.includes(ext) || type === 'text/plain' || type === 'text/markdown') return 'text';
    if (ext === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
    if (IMAGE_TYPES.includes(type) || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
    return 'unsupported';
  }

  function pageItemsToText(items) {
    let output = '';
    for (const item of items || []) {
      if (!item || typeof item.str !== 'string') continue;
      output += item.str;
      output += item.hasEOL ? '\n' : ' ';
    }
    return cleanExtractedText(output);
  }

  function createParser(dependencies) {
    dependencies = dependencies || {};
    const pdfjsLib = dependencies.pdfjsLib;
    const mammoth = dependencies.mammoth;
    const documentRef = dependencies.documentRef || (typeof document !== 'undefined' ? document : null);
    const createImageBitmapImpl = dependencies.createImageBitmapImpl ||
      (typeof createImageBitmap === 'function' ? createImageBitmap.bind(globalThis) : null);

    async function parseText(file) {
      const text = cleanExtractedText(await file.text());
      if (!text) throw new ResumeParseError('文本文件中没有可用内容', 'no_text');
      return { format: extensionOf(file.name) || 'txt', text: text, needsOcr: false };
    }

    async function parseDocx(file) {
      if (!mammoth || typeof mammoth.extractRawText !== 'function') {
        throw new ResumeParseError('Word 解析组件未加载，请重新加载扩展', 'docx_parser_unavailable');
      }
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const text = cleanExtractedText(result && result.value);
      if (!text) throw new ResumeParseError('Word 文件中没有提取到文字，请另存为 PDF 或 TXT 后重试', 'no_text');
      return {
        format: 'docx',
        text: text,
        needsOcr: false,
        warnings: Array.isArray(result.messages) ? result.messages.map(item => item.message).filter(Boolean) : []
      };
    }

    async function loadPdf(file) {
      if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
        throw new ResumeParseError('PDF 解析组件未加载，请重新加载扩展', 'pdf_parser_unavailable');
      }
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
      return loadingTask.promise;
    }

    async function parsePdf(file) {
      const pdf = await loadPdf(file);
      const pageCount = pdf.numPages;
      const pages = [];
      try {
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const pageText = pageItemsToText(content.items);
          if (pageText) pages.push(pageText);
        }
      } finally {
        if (typeof pdf.destroy === 'function') await pdf.destroy();
      }

      const text = cleanExtractedText(pages.join('\n\n'));
      const needsOcr = meaningfulLength(text) < MIN_LOCAL_TEXT_CHARS;
      return {
        format: 'pdf',
        text: text,
        pageCount: pageCount,
        needsOcr: needsOcr,
        reason: needsOcr ? 'scanned_or_low_text_pdf' : ''
      };
    }

    async function parse(file) {
      validateFile(file);
      const kind = fileKind(file);
      if (kind === 'text') return parseText(file);
      if (kind === 'docx') return parseDocx(file);
      if (kind === 'pdf') return parsePdf(file);
      if (kind === 'image') {
        return {
          format: extensionOf(file.name) || file.type,
          text: '',
          needsOcr: true,
          reason: 'image_requires_ocr'
        };
      }
      throw new ResumeParseError('暂不支持此格式，请选择 PDF、DOCX、TXT、MD、JPG、PNG 或 WebP', 'unsupported_type');
    }

    function makeCanvas(width, height) {
      if (!documentRef || typeof documentRef.createElement !== 'function') {
        throw new ResumeParseError('当前环境无法渲染扫描件', 'canvas_unavailable');
      }
      const canvas = documentRef.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    async function renderPdfPages(file, options) {
      options = options || {};
      const maxPages = options.maxPages || MAX_OCR_PAGES;
      const maxDimension = options.maxDimension || 1800;
      const pdf = await loadPdf(file);
      if (pdf.numPages > maxPages) {
        if (typeof pdf.destroy === 'function') await pdf.destroy();
        throw new ResumeParseError('扫描版 PDF 最多支持 ' + maxPages + ' 页，请精简后重试', 'too_many_pages');
      }

      const images = [];
      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            2,
            maxDimension / Math.max(baseViewport.width, baseViewport.height)
          );
          const viewport = page.getViewport({ scale: scale });
          const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d', { alpha: false });
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          images.push(canvas.toDataURL('image/jpeg', 0.88));
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        if (typeof pdf.destroy === 'function') await pdf.destroy();
      }
      return images;
    }

    async function renderImage(file, options) {
      options = options || {};
      if (!createImageBitmapImpl) {
        throw new ResumeParseError('当前环境无法读取图片', 'image_decoder_unavailable');
      }
      const maxDimension = options.maxDimension || 2000;
      const bitmap = await createImageBitmapImpl(file);
      try {
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = makeCanvas(width, height);
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        canvas.width = 0;
        canvas.height = 0;
        return [dataUrl];
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    }

    async function prepareOcrImages(file, options) {
      validateFile(file);
      const kind = fileKind(file);
      if (kind === 'pdf') return renderPdfPages(file, options);
      if (kind === 'image') return renderImage(file, options);
      throw new ResumeParseError('只有扫描版 PDF 或图片需要 MuskAI OCR', 'ocr_not_needed');
    }

    return Object.freeze({
      parse: parse,
      prepareOcrImages: prepareOcrImages
    });
  }

  return Object.freeze({
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_OCR_PAGES: MAX_OCR_PAGES,
    MIN_LOCAL_TEXT_CHARS: MIN_LOCAL_TEXT_CHARS,
    ResumeParseError: ResumeParseError,
    extensionOf: extensionOf,
    cleanExtractedText: cleanExtractedText,
    meaningfulLength: meaningfulLength,
    fileKind: fileKind,
    pageItemsToText: pageItemsToText,
    createParser: createParser
  });
});
