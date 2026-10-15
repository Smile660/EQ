/**
 * EQ.preprocess 公共接缝测试 —— 识别前图像增强的决策与像素变换。
 * 决策预期来自领域常识：OCR 引擎在「黑字白底、足够大、留有边距」的图上识别最好。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/env.mjs';

const { EQ } = loadScript('assets/js/preprocess.js');
const { analyzeStats, computePlan, applyInvert, applyStretch } = EQ.preprocess;

/** 构造测试图像（ImageData 形状）：fn(x, y) → [r, g, b] */
function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const LIGHT_STATS = { mean: 235, darkRatio: 0.05, lightRatio: 0.8, p05: 40, p95: 255 };
const DARK_STATS = { mean: 55, darkRatio: 0.85, lightRatio: 0.05, p05: 10, p95: 240 };

/* ---------- analyzeStats：像素统计 ---------- */

test('analyzeStats：纯白图 → 均值 255，亮像素占比 1', () => {
  const img = makeImage(50, 40, () => [255, 255, 255]);
  const s = analyzeStats(img.data, img.width, img.height);
  assert.ok(Math.abs(s.mean - 255) < 1);
  assert.equal(s.darkRatio, 0);
  assert.equal(s.lightRatio, 1);
});

test('analyzeStats：深底白字截图 → 暗像素占主导、均值低', () => {
  // 深色背景 (#1e1e1e) + 居中一小块白色文字区
  const img = makeImage(400, 100, (x, y) =>
    (x > 180 && x < 220 && y > 20 && y < 80) ? [240, 240, 240] : [30, 30, 30]);
  const s = analyzeStats(img.data, img.width, img.height);
  assert.ok(s.mean < 128, 'mean=' + s.mean);
  assert.ok(s.darkRatio > s.lightRatio, 'dark=' + s.darkRatio + ' light=' + s.lightRatio);
});

test('analyzeStats：灰阶渐变 → 分位数覆盖动态范围', () => {
  const img = makeImage(256, 4, (x) => [x, x, x]);
  const s = analyzeStats(img.data, img.width, img.height);
  assert.ok(s.p05 < 30, 'p05=' + s.p05);
  assert.ok(s.p95 > 220, 'p95=' + s.p95);
  assert.ok(Math.abs(s.mean - 127.5) < 3, 'mean=' + s.mean);
});

/* ---------- computePlan：预处理决策 ---------- */

test('computePlan：小尺寸分数条带 → 放大到上限 4 倍', () => {
  const p = computePlan(800, 160, LIGHT_STATS);
  assert.equal(p.scale, 4);
  assert.ok(p.padRatio > 0 && p.padRatio <= 0.1);
  assert.equal(p.invert, false);
  assert.equal(p.stretch, false);
});

test('computePlan：已经足够大的清晰图 → 不放大不反色', () => {
  const p = computePlan(2400, 1000, LIGHT_STATS);
  assert.equal(p.scale, 1);
  assert.equal(p.invert, false);
  assert.equal(p.stretch, false);
});

test('computePlan：深色模式截图 → 反色', () => {
  const p = computePlan(600, 200, DARK_STATS);
  assert.equal(p.invert, true);
});

test('computePlan：浅色但对比度低的图 → 拉伸对比度', () => {
  const p = computePlan(1000, 400, { mean: 215, darkRatio: 0.02, lightRatio: 0.5, p05: 190, p95: 230 });
  assert.equal(p.stretch, true);
  assert.equal(p.invert, false);
});

test('computePlan：对比度充足 → 不拉伸', () => {
  const p = computePlan(1000, 400, { mean: 200, darkRatio: 0.1, lightRatio: 0.6, p05: 10, p95: 250 });
  assert.equal(p.stretch, false);
});

test('computePlan：极小图放大不超过上限倍数', () => {
  const p = computePlan(100, 50, LIGHT_STATS);
  assert.ok(p.scale > 1 && p.scale <= 4, 'scale=' + p.scale);
});

test('computePlan：超大图按上限降采样', () => {
  const p = computePlan(5000, 4000, LIGHT_STATS);
  assert.ok(p.scale < 1 && p.scale >= 0.7, 'scale=' + p.scale);
});

test('computePlan：完整管线 —— 深色模式小截图（合成像素 → 统计 → 决策）', () => {
  const img = makeImage(400, 100, (x, y) =>
    (x > 180 && x < 220 && y > 20 && y < 80) ? [240, 240, 240] : [30, 30, 30]);
  const s = analyzeStats(img.data, img.width, img.height);
  const p = computePlan(img.width, img.height, s);
  assert.equal(p.invert, true);
  assert.equal(p.scale, 4);
});

/* ---------- applyInvert / applyStretch：像素变换 ---------- */

test('applyInvert：RGB 取反、alpha 不动', () => {
  const d = new Uint8ClampedArray([10, 20, 30, 255, 255, 255, 255, 128]);
  applyInvert(d);
  assert.deepEqual(Array.from(d.slice(0, 4)), [245, 235, 225, 255]);
  assert.equal(d[7], 128, 'alpha 应保持不变');
});

test('applyStretch：按 p05/p95 线性拉伸到全动态范围', () => {
  const d = new Uint8ClampedArray([100, 125, 150, 255]);
  applyStretch(d, 100, 150);
  assert.equal(d[0], 0);
  assert.equal(d[1], 127);
  assert.equal(d[2], 255);
  assert.equal(d[3], 255, 'alpha 不参与拉伸');
});

test('applyStretch：动态范围过窄时保持原样（避免除零放大噪声）', () => {
  const d = new Uint8ClampedArray([128, 130, 255]);
  applyStretch(d, 128, 130);
  assert.deepEqual(Array.from(d.slice(0, 2)), [128, 130]);
});
