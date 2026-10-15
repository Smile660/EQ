/**
 * preprocess.js —— 识别前图像自动增强
 * SimpleTex 的 latex_ocr 接口没有可调质量的参数，识别质量完全取决于送入的图片。
 * 该模块在小截图 / 深色模式截图 / 低对比度照片 / 公式贴边这四类常见劣化输入上
 * 做保守增强：放大、反色、对比度拉伸、加白边 —— 全部为 OCR 友好的标准手段。
 *
 * 决策与像素变换为纯函数（Node 可测，tests/preprocess.test.mjs）；
 * preprocessBlob 依赖浏览器 canvas，仅在页面中调用。
 * 全局命名空间：window.EQ
 */
(function () {
  'use strict';
  window.EQ = window.EQ || {};

  // 决策阈值（集中导出，便于调参与测试对照）
  const THRESHOLDS = {
    targetShort: 1000,   // 短边不足该值时放大（分数横杠、上下标需要纵向分辨率）
    maxScale: 4,         // 放大上限：过度放大会同步放大噪点与 JPEG 块
    maxDim: 4000,        // 单边上限
    maxPixels: 16e6,     // 总像素上限（约 4000×4000）
    padRatio: 0.05,      // 四周白边比例（公式贴边时检测易失败）
    darkMean: 128,       // 平均亮度低于此值视为深色底
    darkLum: 100,        // 亮度 < 100 记为暗像素
    lightLum: 200,       // 亮度 > 200 记为亮像素
    contrastMin: 150     // p05–p95 动态范围低于此值时拉伸对比度
  };

  /**
   * 像素统计（可抽样）。data 为 RGBA（忽略 alpha，调用前应已平铺到白底）。
   * @returns {{mean:number, darkRatio:number, lightRatio:number, p05:number, p95:number}}
   */
  function analyzeStats(data, width, height) {
    const total = width * height;
    const step = Math.max(1, Math.floor(total / 250000));
    const hist = new Uint32Array(256);
    let n = 0, sum = 0, dark = 0, light = 0;
    for (let p = 0; p < total; p += step) {
      const i = p * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const L = lum | 0;
      hist[L]++; sum += lum; n++;
      if (L < THRESHOLDS.darkLum) dark++;
      else if (L > THRESHOLDS.lightLum) light++;
    }
    let acc = 0, p05 = 255, p95 = 0, p05done = false;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (!p05done && acc >= n * 0.05) { p05 = v; p05done = true; }
      if (acc >= n * 0.95) { p95 = v; break; }
    }
    return { mean: sum / n, darkRatio: dark / n, lightRatio: light / n, p05: p05, p95: p95 };
  }

  /**
   * 预处理决策。
   * @returns {{scale:number, invert:boolean, stretch:boolean, padRatio:number}}
   */
  function computePlan(width, height, stats) {
    const T = THRESHOLDS;
    const short = Math.min(width, height);
    let scale = short < T.targetShort ? T.targetShort / short : 1;
    // 上限约束：放大倍数、单边长度、总像素
    scale = Math.min(scale, T.maxScale,
      T.maxDim / Math.max(width, height),
      Math.sqrt(T.maxPixels / (width * height)));
    if (scale > T.maxScale) scale = T.maxScale;

    const invert = stats.mean < T.darkMean && stats.darkRatio > stats.lightRatio;
    const stretch = stats.p95 - stats.p05 < T.contrastMin;

    return { scale: Math.round(scale * 100) / 100, invert: invert, stretch: stretch, padRatio: T.padRatio };
  }

  /** RGB 取反（alpha 不动）—— 深色模式截图转黑字白底 */
  function applyInvert(data) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
  }

  /** 按 [lo, hi] 线性拉伸到 [0, 255]；范围过窄时保持原样，避免放大噪声 */
  function applyStretch(data, lo, hi) {
    if (hi - lo < 10) return;
    const k = 255 / (hi - lo);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.max(0, Math.min(255, (data[i] - lo) * k));
      data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - lo) * k));
      data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - lo) * k));
    }
  }

  /**
   * 浏览器执行入口：Blob → 分析 → 按计划增强 → PNG Blob。
   * 失败时抛错，调用方应回退为原图识别。
   * @returns {Promise<{blob:Blob, dataUrl:string, width:number, height:number, plan:Object}>}
   */
  function preprocessBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try { resolve(runPipeline(img)); }
        catch (e) { reject(e); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  function runPipeline(img) {
    const w = img.naturalWidth, h = img.naturalHeight;

    // ① 平铺到白底（透明背景截图按白底处理），并统计
    const c0 = document.createElement('canvas');
    c0.width = w; c0.height = h;
    const x0 = c0.getContext('2d');
    x0.fillStyle = '#ffffff';
    x0.fillRect(0, 0, w, h);
    x0.drawImage(img, 0, 0);

    let stats = analyzeStats(x0.getImageData(0, 0, w, h).data, w, h);
    const plan = computePlan(w, h, stats);

    // ② 像素级增强（反色后重新统计，拉伸基准才正确）
    const idata = x0.getImageData(0, 0, w, h);
    if (plan.invert) {
      applyInvert(idata.data);
      stats = analyzeStats(idata.data, w, h);
    }
    if (plan.stretch) applyStretch(idata.data, stats.p05, stats.p95);
    if (plan.invert || plan.stretch) x0.putImageData(idata, 0, 0);

    // ③ 缩放 + 四周加白边（高质量重采样）
    const pad = Math.round(plan.padRatio * Math.max(w, h));
    const ow = Math.max(1, Math.round(w * plan.scale)) + pad * 2;
    const oh = Math.max(1, Math.round(h * plan.scale)) + pad * 2;
    const c1 = document.createElement('canvas');
    c1.width = ow; c1.height = oh;
    const x1 = c1.getContext('2d');
    x1.imageSmoothingEnabled = true;
    x1.imageSmoothingQuality = 'high';
    x1.fillStyle = '#ffffff';
    x1.fillRect(0, 0, ow, oh);
    x1.drawImage(c0, 0, 0, w, h, pad, pad, ow - pad * 2, oh - pad * 2);

    return {
      blob: dataUrlToBlob(c1.toDataURL('image/png')),
      dataUrl: c1.toDataURL('image/png'),
      width: ow,
      height: oh,
      plan: plan
    };
  }

  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = (head.match(/data:(.*?);/) || [null, 'image/png'])[1];
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  EQ.preprocess = {
    THRESHOLDS: THRESHOLDS,
    analyzeStats: analyzeStats,
    computePlan: computePlan,
    applyInvert: applyInvert,
    applyStretch: applyStretch,
    preprocessBlob: preprocessBlob
  };
})();
