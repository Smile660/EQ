/**
 * 测试辅助：在 Node 里加载无构建的前端脚本（IIFE → window.EQ）。
 * 用法：const { EQ } = loadScript('assets/js/convert.js');
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadScript(relPath) {
  // 与浏览器一致：window 即全局对象，window.EQ 与裸 EQ 都可解析
  if (!globalThis.window) globalThis.window = globalThis;
  const code = readFileSync(path.join(ROOT, relPath), 'utf8');
  new Function('window', code)(globalThis.window);
  return { EQ: globalThis.window.EQ };
}
