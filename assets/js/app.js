/**
 * app.js —— 主应用逻辑
 * 负责：图片输入（粘贴/拖拽/上传/示例）、识别流程、结果展示与复制、
 *       历史记录、设置弹窗、主题切换、Toast
 * 全局命名空间：window.EQ（依赖 convert.js / engine.js）
 */
(function () {
  'use strict';

  /* ============================================================
   * 状态
   * ============================================================ */
  const state = {
    image: null,          // { dataUrl, blob, sampleIndex, width, height, kb }
    result: null,         // { latex, confidence, elapsed, engineName, fromHistory }
    settings: { engine: 'simpletex', token: '', model: 'standard' },
    history: [],
    activeTab: 'latex',
    cache: null           // { latex, mathml, unicode } 格式缓存
  };

  const LS_SETTINGS = 'eqlens.settings';
  const LS_HISTORY = 'eqlens.history';
  const MAX_FILE_MB = 10;
  const MAX_HISTORY = 12;

  /* ============================================================
   * DOM 引用
   * ============================================================ */
  const $ = (id) => document.getElementById(id);
  const el = {
    engineBadge: $('engineBadge'), engineDot: $('engineDot'), engineName: $('engineName'),
    themeBtn: $('themeBtn'), settingsBtn: $('settingsBtn'),
    dropzone: $('dropzone'), trySampleBtn: $('trySampleBtn'), fileInput: $('fileInput'),
    workspace: $('workspace'), btnRetake: $('btnRetake'), imgPreview: $('imgPreview'), imgMeta: $('imgMeta'),
    engineTag: $('engineTag'), elapsedTag: $('elapsedTag'),
    loadingBox: $('loadingBox'), stageText: $('stageText'),
    errorBox: $('errorBox'), errorMsg: $('errorMsg'), errorGuide: $('errorGuide'),
    btnRetry: $('btnRetry'), btnEngineSettings: $('btnEngineSettings'),
    btnGetToken: $('btnGetToken'), btnDemoFallback: $('btnDemoFallback'),
    resultBody: $('resultBody'), mathPreview: $('mathPreview'), latexInput: $('latexInput'),
    tabs: Array.from(document.querySelectorAll('.tab')),
    codeBox: $('codeBox'), codeContent: $('codeContent'),
    btnCopyWord: $('btnCopyWord'), btnCopyLatex: $('btnCopyLatex'), btnCopyUnicode: $('btnCopyUnicode'),
    historySection: $('historySection'), historyGrid: $('historyGrid'), btnClearHistory: $('btnClearHistory'),
    modalBackdrop: $('modalBackdrop'), btnCloseModal: $('btnCloseModal'),
    engineRadios: Array.from(document.querySelectorAll('input[name="engine"]')),
    modelRadios: Array.from(document.querySelectorAll('input[name="model"]')),
    tokenWrap: $('tokenWrap'), tokenInput: $('tokenInput'), corsHint: $('corsHint'),
    btnCancelSettings: $('btnCancelSettings'), btnSaveSettings: $('btnSaveSettings'),
    toastWrap: $('toastWrap')
  };

  const C = window.EQ.convert;

  /* ============================================================
   * Toast
   * ============================================================ */
  const TOAST_ICONS = {
    ok: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-6"/></svg>',
    err: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
    info: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  function toast(msg, type, sub) {
    type = type || 'info';
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = TOAST_ICONS[type] + '<span></span>' + (sub ? '<span class="sub"></span>' : '');
    t.children[1].textContent = msg;
    if (sub) t.children[2].textContent = sub;
    el.toastWrap.appendChild(t);
    while (el.toastWrap.children.length > 3) el.toastWrap.removeChild(el.toastWrap.firstChild);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 260);
    }, sub ? 3400 : 2400);
  }

  /* ============================================================
   * 主题
   * ============================================================ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('eqlens.theme', theme); } catch (e) { /* 忽略存储异常 */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('eqlens.theme'); } catch (e) { /* 忽略 */ }
    const prefer = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefer ? 'dark' : 'light'));
  }

  el.themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  /* ============================================================
   * 复制
   * ============================================================ */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // 非安全上下文（http）降级方案
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        console.error('[EQ] 复制失败:', e2);
        return false;
      }
    }
  }

  /**
   * 复制 MathML 到 Word：同时写入 text/html 与 text/plain，
   * Word 粘贴 text/html 中的 MathML 会自动转为可编辑公式
   */
  async function copyMathMLForWord(mml) {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      try {
        const item = new ClipboardItem({
          'text/html': new Blob(['<meta charset="utf-8">' + mml], { type: 'text/html' }),
          'text/plain': new Blob([mml], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return true;
      } catch (e) {
        console.warn('[EQ] 富文本剪贴板不可用，降级为纯文本复制:', e);
      }
    }
    return copyText(mml);
  }

  /* ============================================================
   * 图片输入：粘贴 / 拖拽 / 上传 / 示例
   * ============================================================ */

  /** 统一入口：接收图片文件 */
  async function handleFile(file) {
    const okTypes = ['image/png', 'image/jpeg', 'image/bmp', 'image/webp'];
    if (!file || !file.type || okTypes.indexOf(file.type) === -1) {
      toast('不支持的图片格式', 'err', '请粘贴或上传 PNG / JPG / BMP / WebP 图片');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast('图片过大', 'err', '单张图片不能超过 ' + MAX_FILE_MB + 'MB');
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    }).catch(err => {
      console.error('[EQ] 读取文件失败:', err);
      toast('读取图片失败', 'err');
      return null;
    });
    if (!dataUrl) return;
    handleImageData(dataUrl, { blob: file, sampleIndex: null });
  }

  /** 统一入口：接收 dataURL（粘贴的截图 / 历史记录 / 示例） */
  function handleImageData(dataUrl, meta, opts) {
    state.image = Object.assign({ dataUrl: dataUrl, sampleIndex: null }, meta || {});
    state.result = null;
    state.cache = null;

    // 展示工作区
    el.dropzone.classList.add('hidden');
    el.workspace.classList.remove('hidden');
    el.imgPreview.src = dataUrl;

    // 读取尺寸与体积
    const img = new Image();
    img.onload = () => {
      state.image.width = img.naturalWidth;
      state.image.height = img.naturalHeight;
      const kb = Math.round((dataUrl.length * 0.75) / 1024);
      el.imgMeta.textContent = (img.naturalWidth + ' × ' + img.naturalHeight) + ' px · 约 ' + (kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB');
    };
    img.src = dataUrl;

    if (!(opts && opts.skipRecognize)) recognizeFlow();
  }

  // ① 全局粘贴
  document.addEventListener('paste', (e) => {
    let file = null;
    const cd = e.clipboardData;
    if (cd && cd.items) {
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (it.type && it.type.indexOf('image/') === 0) { file = it.getAsFile(); break; }
      }
    }
    if (!file && cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) {
      file = cd.files[0];
    }
    if (file) {
      e.preventDefault();
      closeModal();
      toast('已读取剪贴板图片', 'info', '正在识别…');
      handleFile(file);
    }
  });

  // ② 拖拽
  ['dragenter', 'dragover'].forEach(ev => el.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => el.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('dragover');
  }));
  el.dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  // 拖拽落在页面其他位置也接收
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (!el.dropzone.classList.contains('hidden')) return;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  // ③ 点击上传
  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); }
  });
  el.fileInput.addEventListener('change', () => {
    if (el.fileInput.files && el.fileInput.files[0]) handleFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });

  // ④ 示例公式
  let sampleCursor = 0;
  el.trySampleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = EQ.engines.makeSampleImage(sampleCursor);
    sampleCursor = (sampleCursor + 1) % EQ.engines.SAMPLES;
    handleImageData(s.dataUrl, { sampleIndex: (sampleCursor + EQ.engines.SAMPLES - 1) % EQ.engines.SAMPLES });
  });

  // 重新上传
  el.btnRetake.addEventListener('click', resetToDropzone);

  function resetToDropzone() {
    state.image = null;
    state.result = null;
    state.cache = null;
    el.workspace.classList.add('hidden');
    el.dropzone.classList.remove('hidden');
    el.fileInput.value = '';
  }

  /* ============================================================
   * 识别流程
   * ============================================================ */
  const STAGES = ['正在上传图像…', '正在检测公式区域…', '正在解码 LaTeX…', '正在整理输出格式…'];
  let stageTimer = null;

  function recognizeFlow() {
    el.loadingBox.classList.remove('hidden');
    el.errorBox.classList.add('hidden');
    el.resultBody.classList.add('hidden');

    let si = 0;
    el.stageText.textContent = STAGES[0];
    clearInterval(stageTimer);
    stageTimer = setInterval(() => { el.stageText.textContent = STAGES[++si % STAGES.length]; }, 600);

    const payload = {
      dataUrl: state.image.dataUrl,
      blob: state.image.blob,
      sampleIndex: state.image.sampleIndex
    };

    EQ.engines.recognizeImage(payload, state.settings).then(res => {
      clearInterval(stageTimer);
      state.result = {
        latex: res.latex,
        confidence: res.confidence,
        elapsed: res.elapsed,
        engineName: res.engine.name,
        isDemo: res.engine.isDemo
      };
      showResult();
      addHistory(res.latex, res.engine.name, res.engine.isDemo);
    }).catch(err => {
      clearInterval(stageTimer);
      console.error('[EQ] 识别失败:', err);
      el.loadingBox.classList.add('hidden');
      el.errorBox.classList.remove('hidden');
      el.resultBody.classList.add('hidden');

      // 未配置令牌：展示专门引导（去配置 / 获取令牌 / 演示模式）
      const noToken = err && err.code === 'NO_TOKEN';
      el.errorMsg.textContent = noToken
        ? '真实识别需要 SimpleTex 用户授权令牌（UAT）。免费注册即可创建，一次配置长期使用。'
        : ((err && err.message) || '识别失败，请重试。');
      el.errorGuide.classList.toggle('hidden', !noToken);
      el.btnRetry.classList.toggle('hidden', noToken);
      el.btnGetToken.classList.toggle('hidden', !noToken);
      el.btnDemoFallback.classList.toggle('hidden', !noToken);
      el.btnEngineSettings.textContent = noToken ? '去配置令牌' : '检查引擎设置';
    });
  }

  el.btnRetry.addEventListener('click', recognizeFlow);
  el.btnEngineSettings.addEventListener('click', () => { openModal(); });

  // 未配置令牌时一键切换演示引擎并重新识别
  el.btnDemoFallback.addEventListener('click', () => {
    state.settings = Object.assign({}, state.settings, { engine: 'demo' });
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }
    catch (e) { console.error('[EQ] 设置保存失败:', e); }
    updateEngineBadge();
    toast('已切换为演示引擎', 'ok', '本次识别将以演示模式完成');
    recognizeFlow();
  });

  function showResult() {
    el.loadingBox.classList.add('hidden');
    el.errorBox.classList.add('hidden');
    el.resultBody.classList.remove('hidden');

    // 状态标签
    el.engineTag.textContent = state.result.engineName + (state.result.isDemo ? '' : '');
    el.engineTag.className = 'tag ' + (state.result.isDemo ? '' : 'tag-live');
    const parts = [state.result.elapsed + ' ms'];
    if (typeof state.result.confidence === 'number') {
      parts.push('置信度 ' + (state.result.confidence * 100).toFixed(1) + '%');
    }
    el.elapsedTag.textContent = parts.join(' · ');

    // 填充结果
    el.latexInput.value = state.result.latex;
    state.cache = null;
    renderPreview();
    updateCodeBox();
  }

  /* ============================================================
   * 结果渲染与格式
   * ============================================================ */
  function renderPreview() {
    const latex = el.latexInput.value.trim();
    if (!latex) { el.mathPreview.innerHTML = '<div class="render-fallback">（空）</div>'; return; }
    // KaTeX 未加载时的降级：直接展示 LaTeX 源码
    if (typeof katex === 'undefined') {
      el.mathPreview.innerHTML = '<div class="render-fallback"></div>';
      el.mathPreview.querySelector('.render-fallback').textContent = C.stripTexDelimiters(latex);
      return;
    }
    el.mathPreview.innerHTML = C.renderTexToHtml(latex);
  }

  /** 获取三种格式的当前内容（带缓存） */
  function getFormats() {
    const latex = el.latexInput.value;
    const key = latex.trim();
    if (state.cache && state.cache.latex === key) return state.cache;
    let mathml = null, mathmlError = null;
    try { mathml = C.texToMathML(latex); } catch (e) { mathmlError = e.message; }
    state.cache = {
      latex: latex,
      mathml: mathml,
      mathmlError: mathmlError,
      unicode: C.latexToUnicode(latex)
    };
    return state.cache;
  }

  function updateCodeBox() {
    const fmt = getFormats();
    let content = '';
    if (state.activeTab === 'latex') {
      content = fmt.latex;
    } else if (state.activeTab === 'mathml') {
      content = fmt.mathmlError ? ('⚠ ' + fmt.mathmlError) : (fmt.mathml || '');
    } else {
      content = fmt.unicode;
    }
    el.codeContent.textContent = content || '（空）';
    el.codeBox.scrollTop = 0;
  }

  // Tab 切换
  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      state.activeTab = tab.dataset.tab;
      updateCodeBox();
    });
  });

  // 可编辑 LaTeX：防抖重新渲染
  let editTimer = null;
  el.latexInput.addEventListener('input', () => {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      renderPreview();
      state.cache = null;
      updateCodeBox();
    }, 350);
  });

  /* ============================================================
   * 一键复制
   * ============================================================ */
  el.btnCopyLatex.addEventListener('click', async () => {
    const latex = el.latexInput.value.trim();
    if (!latex) return toast('暂无内容可复制', 'err');
    (await copyText(latex))
      ? toast('LaTeX 已复制', 'ok', '可直接粘贴到 Overleaf / Markdown')
      : toast('复制失败', 'err', '请手动选中文本复制');
  });

  el.btnCopyUnicode.addEventListener('click', async () => {
    const fmt = getFormats();
    if (!fmt.unicode) return toast('暂无内容可复制', 'err');
    (await copyText(fmt.unicode))
      ? toast('Unicode 文本已复制', 'ok', '适合粘贴到聊天 / 笔记')
      : toast('复制失败', 'err');
  });

  el.btnCopyWord.addEventListener('click', async () => {
    const fmt = getFormats();
    if (fmt.mathmlError || !fmt.mathml) {
      toast('MathML 生成失败', 'err', fmt.mathmlError || '请检查公式源码');
      return;
    }
    const ok = await copyMathMLForWord(fmt.mathml);
    ok
      ? toast('已复制 MathML', 'ok', '打开 Word 直接 Ctrl+V 即可变为可编辑公式')
      : toast('复制失败', 'err', '可切换到 MathML 标签手动复制');
  });

  /* ============================================================
   * 历史记录（本地 localStorage，免登录）
   * ============================================================ */
  function loadHistory() {
    try {
      const raw = localStorage.getItem(LS_HISTORY);
      state.history = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('[EQ] 历史记录读取失败:', e);
      state.history = [];
    }
    renderHistory();
  }

  function saveHistory() {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(state.history)); }
    catch (e) { console.error('[EQ] 历史记录保存失败:', e); }
  }

  /** dataURL → 小缩略图（节省 localStorage 空间） */
  function makeThumb(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const max = 180;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function addHistory(latex, engineName, isDemo) {
    const thumb = await makeThumb(state.image.dataUrl);
    state.history.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      latex: latex,
      engine: isDemo ? '演示' : 'SimpleTex',
      thumb: thumb
    });
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
    saveHistory();
    renderHistory();
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    const pad = n => String(n).padStart(2, '0');
    if (diff < 86400 * 1000 * 2) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderHistory() {
    el.historySection.classList.toggle('hidden', state.history.length === 0);
    el.historyGrid.innerHTML = '';
    state.history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-item';
      card.title = '点击恢复该记录';

      const thumbHtml = item.thumb
        ? '<div class="history-thumb"><img src="' + item.thumb + '" alt="历史图片缩略图" /></div>'
        : '<div class="history-thumb"><span style="font-size:26px">🖼️</span></div>';

      card.innerHTML =
        '<button class="history-del" title="删除该记录" aria-label="删除该记录">×</button>' +
        thumbHtml +
        '<div class="history-latex"></div>' +
        '<div class="history-meta"><span class="engine-mini"></span><span></span></div>';

      card.querySelector('.history-latex').textContent = item.latex;
      card.querySelector('.engine-mini').textContent = item.engine;
      card.querySelector('.history-meta span:last-child').textContent = formatTime(item.ts);

      // 删除（阻止冒泡，避免触发恢复）
      card.querySelector('.history-del').addEventListener('click', (e) => {
        e.stopPropagation();
        state.history = state.history.filter(h => h.id !== item.id);
        saveHistory();
        renderHistory();
        toast('已删除该条记录', 'info');
      });

      // 点击恢复
      card.addEventListener('click', () => restoreHistory(item));
      el.historyGrid.appendChild(card);
    });
  }

  function restoreHistory(item) {
    // 直接从历史恢复，不触发重新识别
    handleImageData(item.thumb || '', { sampleIndex: null }, { skipRecognize: true });
    state.result = {
      latex: item.latex,
      confidence: null,
      elapsed: null,
      engineName: item.engine === 'SimpleTex' ? 'SimpleTex V2.5' : '演示引擎',
      isDemo: item.engine !== 'SimpleTex',
      fromHistory: true
    };
    showResult();
    el.engineTag.textContent = item.engine + ' · 历史记录';
    el.engineTag.className = 'tag';
    el.elapsedTag.textContent = formatTime(item.ts);
  }

  // 清空历史（二次确认按钮）
  let clearArmed = false, clearTimer = null;
  el.btnClearHistory.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      el.btnClearHistory.textContent = '确认清空？';
      el.btnClearHistory.style.color = 'var(--err)';
      clearTimer = setTimeout(() => {
        clearArmed = false;
        el.btnClearHistory.textContent = '清空历史';
        el.btnClearHistory.style.color = '';
      }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    el.btnClearHistory.textContent = '清空历史';
    el.btnClearHistory.style.color = '';
    state.history = [];
    saveHistory();
    renderHistory();
    toast('历史记录已清空', 'ok');
  });

  /* ============================================================
   * 设置弹窗
   * ============================================================ */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) state.settings = Object.assign(state.settings, JSON.parse(raw));
    } catch (e) { console.error('[EQ] 设置读取失败:', e); }
    updateEngineBadge();
  }

  function updateEngineBadge() {
    const s = state.settings;
    const isLive = s.engine === 'simpletex' && !!s.token;
    const isPending = s.engine === 'simpletex' && !s.token;
    el.engineBadge.classList.toggle('live', isLive);
    el.engineBadge.classList.toggle('pending', isPending);
    el.engineName.textContent = isLive ? 'SimpleTex 真实识别' : (isPending ? '真实识别 · 待配置令牌' : '演示引擎');
  }

  function openModal() {
    el.engineRadios.forEach(r => { r.checked = r.value === state.settings.engine; });
    el.modelRadios.forEach(r => { r.checked = r.value === (state.settings.model || 'standard'); });
    el.tokenInput.value = state.settings.token || '';
    syncTokenVisibility();
    el.modalBackdrop.classList.remove('hidden');
  }

  function closeModal() { el.modalBackdrop.classList.add('hidden'); }

  function syncTokenVisibility() {
    const sel = el.engineRadios.find(r => r.checked);
    const isSimple = sel && sel.value === 'simpletex';
    el.tokenWrap.classList.toggle('hidden', !isSimple);
    el.corsHint.textContent = isSimple
      ? '真实识别经同源代理转发至 SimpleTex（令牌不出本机）。本地使用请以 python server.py 启动服务；线上部署可用 Nginx / Cloudflare Worker 等按相同规则反向代理 /api/latex_ocr。'
      : '';
  }

  el.engineRadios.forEach(r => r.addEventListener('change', syncTokenVisibility));
  el.settingsBtn.addEventListener('click', openModal);
  el.engineBadge.addEventListener('click', openModal);
  el.btnCloseModal.addEventListener('click', closeModal);
  el.btnCancelSettings.addEventListener('click', closeModal);
  el.modalBackdrop.addEventListener('click', (e) => { if (e.target === el.modalBackdrop) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  el.btnSaveSettings.addEventListener('click', () => {
    const sel = el.engineRadios.find(r => r.checked);
    const engine = sel ? sel.value : 'demo';
    const token = el.tokenInput.value.trim();
    if (engine === 'simpletex' && !token) {
      toast('请填写 SimpleTex 用户授权令牌', 'err', '或先选择演示引擎');
      return;
    }
    const msel = el.modelRadios.find(r => r.checked);
    state.settings = { engine: engine, token: token, model: msel ? msel.value : 'standard' };
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }
    catch (e) { console.error('[EQ] 设置保存失败:', e); }
    updateEngineBadge();
    closeModal();
    toast('设置已保存', 'ok',
      engine === 'simpletex' ? '下次识别将调用 SimpleTex 真实识别' : '已切换到演示引擎');
  });

  /* ============================================================
   * 启动
   * ============================================================ */
  initTheme();
  loadSettings();
  loadHistory();

  // 引擎就绪提示（KaTeX / Temml 未加载时提前告知）
  window.addEventListener('load', () => {
    if (typeof katex === 'undefined' || (typeof Temml === 'undefined' && typeof temml === 'undefined')) {
      console.error('[EQ] CDN 依赖加载失败：katex=' + typeof katex + ', temml=' + (typeof Temml !== 'undefined' ? typeof Temml : typeof temml));
      toast('公式渲染组件加载失败', 'err', '请检查网络连接后刷新页面');
    }
  });
})();
