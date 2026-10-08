/**
 * engine.js —— 公式识别引擎层
 * 内置两种引擎：
 *   1. demo      演示引擎（本地示例公式池，免配置、免登录）
 *   2. simpletex SimpleTex 官方 API（需用户自己的 UAT Token）
 * 全局命名空间：window.EQ
 */
(function () {
  'use strict';
  window.EQ = window.EQ || {};

  /* ============================================================
   * 演示引擎的内置公式池
   * ============================================================ */
  const DEMO_POOL = [
    { latex: 'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}', label: '一元二次方程求根公式', confidence: 0.98 },
    { latex: '\\int_{-\\infty}^{\\infty} e^{-x^{2}} \\, dx = \\sqrt{\\pi}', label: '高斯积分', confidence: 0.97 },
    { latex: 'e^{i\\pi} + 1 = 0', label: '欧拉恒等式', confidence: 0.99 },
    { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', label: '等差数列求和', confidence: 0.96 },
    { latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\, e^{-\\frac{(x-\\mu)^{2}}{2\\sigma^{2}}}', label: '正态分布概率密度', confidence: 0.95 },
    { latex: '\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\!\\left( \\frac{QK^{\\top}}{\\sqrt{d_k}} \\right) V', label: 'Transformer 注意力', confidence: 0.94 },
    { latex: 'P(A \\mid B) = \\frac{P(B \\mid A)\\, P(A)}{P(B)}', label: '贝叶斯公式', confidence: 0.98 },
    { latex: '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', label: '重要极限', confidence: 0.97 },
    { latex: '\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}', label: '麦克斯韦方程', confidence: 0.93 },
    { latex: 'a^{2} + b^{2} = c^{2}', label: '勾股定理', confidence: 0.99 }
  ];

  // 示例公式（画在 canvas 上，供「试试示例」按钮使用；与公式池前 3 项对应）
  const SAMPLES = [
    { text: 'x = (−b ± √(b² − 4ac)) / 2a', poolIndex: 0, font: 'italic 52px Georgia' },
    { text: '∫ e^(−x²) dx = √π', poolIndex: 1, font: 'italic 52px Georgia' },
    { text: 'e^(iπ) + 1 = 0', poolIndex: 2, font: 'italic 56px Georgia' }
  ];

  /** 生成示例公式图片（canvas 绘制 → dataURL） */
  function makeSampleImage(index) {
    const spec = SAMPLES[index % SAMPLES.length];
    const canvas = document.createElement('canvas');
    const W = 760, H = 240;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = spec.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.text, W / 2, H / 2);
    return { dataUrl: canvas.toDataURL('image/png'), poolIndex: spec.poolIndex };
  }

  /* ============================================================
   * 通用：图片 dataURL → Blob（用于 FormData 上传）
   * ============================================================ */
  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = (head.match(/data:(.*?);/) || [null, 'image/png'])[1];
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /** 图片内容哈希（用于演示引擎挑选公式，同一张图结果稳定） */
  async function hashBlob(blob) {
    const buf = await blob.arrayBuffer();
    const view = new Uint8Array(buf);
    let h = 2166136261;
    const step = Math.max(1, Math.floor(view.length / 4096)); // 大图抽样即可
    for (let i = 0; i < view.length; i += step) {
      h ^= view[i];
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  /* ============================================================
   * 引擎 1：演示引擎
   * ============================================================ */
  const demoEngine = {
    id: 'demo',
    name: '演示引擎',
    isDemo: true,

    async recognize(payload) {
      const t0 = performance.now();
      const delay = 900 + Math.random() * 900;
      await new Promise(r => setTimeout(r, delay));

      let item;
      if (typeof payload.sampleIndex === 'number' && payload.sampleIndex >= 0) {
        // 示例图片：返回与画面一致的公式，保证演示体验
        item = DEMO_POOL[SAMPLES[payload.sampleIndex % SAMPLES.length].poolIndex];
      } else if (payload.blob) {
        const h = await hashBlob(payload.blob);
        item = DEMO_POOL[h % DEMO_POOL.length];
      } else {
        item = DEMO_POOL[Math.floor(Math.random() * DEMO_POOL.length)];
      }

      return {
        latex: item.latex,
        confidence: item.confidence,
        elapsed: Math.round(performance.now() - t0),
        engine: demoEngine
      };
    }
  };

  /* ============================================================
   * 引擎 2：SimpleTex 官方 API（真实识别）
   * 文档：https://doc.simpletex.cn/zh/api/
   * 协议：POST https://server.simpletex.cn/api/latex_ocr
   *       Header: token=<UAT>；Body: multipart/form-data, file=<图片>
   * 跨域说明：浏览器 CORS 预检不允许 `token` 自定义头，因此真实
   * 识别经由同源代理转发（server.py / 线上自建反代）：
   *       页面 --(x-eq-token)--> 同源代理 --(token)--> SimpleTex
   * ============================================================ */
  // 同源代理端点（标准模型 / 轻量模型）
  const SIMPLETEX_PATHS = {
    standard: '/api/latex_ocr',
    turbo: '/api/latex_ocr_turbo'
  };

  /** 构造带错误码的异常（app.js 依据 code 呈现不同引导） */
  function apiError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  const simpletexEngine = {
    id: 'simpletex',
    name: 'SimpleTex V2.5',
    isDemo: false,

    async recognize(payload, settings) {
      const t0 = performance.now();
      const token = ((settings && settings.token) || '').trim();
      if (!token) {
        throw apiError('NO_TOKEN', '尚未配置 SimpleTex 用户授权令牌（UAT）');
      }

      const blob = payload.blob || (payload.dataUrl ? dataUrlToBlob(payload.dataUrl) : null);
      if (!blob) throw apiError('BAD_IMAGE', '图片数据缺失');

      const form = new FormData();
      form.append('file', blob, 'image.png');

      const path = SIMPLETEX_PATHS[(settings && settings.model) === 'turbo' ? 'turbo' : 'standard'];
      let resp;
      try {
        resp = await fetch(path, {
          method: 'POST',
          headers: { 'x-eq-token': token }, // 同源请求，无 CORS 限制；由本地代理转为 token 头转发
          body: form
        });
      } catch (err) {
        console.error('[EQ] 识别服务连接失败:', err);
        throw apiError('PROXY', '无法连接识别服务。\n本地使用请运行 python server.py 后访问 http://127.0.0.1:8020；直接双击打开的 HTML 页面无法调用真实识别。');
      }

      // 错误分类（参考 SimpleTex 错误代码表）
      if (resp.status === 401) throw apiError('AUTH', '令牌无效或已过期，请到 SimpleTex 用户中心重新创建');
      if (resp.status === 402) throw apiError('RESOURCE', 'SimpleTex 账户资源不足（免费额度用尽或余额不足），请前往用户中心处理');
      if (resp.status === 429) throw apiError('RATE', '调用频率超出限制（QPS 达到上限），请稍等几秒后重试');
      if (resp.status === 413) throw apiError('SIZE', '图片缺失或过大，请更换为 10MB 以内的清晰公式图片');
      if (resp.status === 404) throw apiError('PROXY', '识别端点不可用：本地服务版本过旧，请重启最新的 server.py');

      const data = await resp.json().catch(() => null);

      if (!resp.ok || !data || data.status === false || data.status === 'false') {
        const msg = (data && data.err_info && data.err_info.err_msg)
          || (data && (data.msg || data.message))
          || ('服务返回错误（HTTP ' + resp.status + '）');
        throw apiError('SERVER', msg);
      }

      // 兼容多种返回字段命名（官方字段为 res.latex / res.conf）
      const res = data.res || data.data || {};
      const latex = (res.latex || res.latex_str || (typeof res === 'string' ? res : '')).trim();
      if (!latex || latex === '[EMPTY]') {
        throw apiError('EMPTY', '图片中未检测到公式，请确认图片包含清晰的公式区域');
      }

      return {
        latex: latex,
        confidence: typeof res.conf === 'number' ? res.conf : null,
        elapsed: Math.round(performance.now() - t0),
        engine: simpletexEngine
      };
    }
  };

  /* ============================================================
   * 统一入口：根据设置选择引擎
   * ============================================================ */
  const engines = { demo: demoEngine, simpletex: simpletexEngine };

  /**
   * @param {Object} payload  { dataUrl, blob, sampleIndex }
   * @param {Object} settings { engine: 'demo'|'simpletex', token: string, model: 'standard'|'turbo' }
   */
  async function recognizeImage(payload, settings) {
    const engineId = (settings && settings.engine) || 'demo';
    const engine = engines[engineId] || demoEngine;
    if (engine.id === 'simpletex') {
      return engine.recognize(payload, settings);
    }
    return engine.recognize(payload);
  }

  /* ============================================================
   * 导出
   * ============================================================ */
  EQ.engines = {
    list: engines,
    recognizeImage,
    makeSampleImage,
    SAMPLES: SAMPLES.length
  };
})();
