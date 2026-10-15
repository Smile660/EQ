/**
 * EQ.convert 公共接缝测试 —— LaTeX 清洗与 LaTeX → Unicode 纯文本。
 * 预期值来自数学语义本身（独立事实来源），不参照实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/env.mjs';

const { EQ } = loadScript('assets/js/convert.js');
const { latexToUnicode, stripTexDelimiters, sanitizeMathMLForWord, normalizeOcrLatex } = EQ.convert;

/* ---------- 基线：既有行为不可回归（公式池中的已知公式） ---------- */

test('基线：一元二次方程求根公式', () => {
  assert.equal(
    latexToUnicode('x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}'),
    'x = (-b ± √(b² - 4ac))/(2a)'
  );
});

test('基线：高斯积分', () => {
  assert.equal(
    latexToUnicode('\\int_{-\\infty}^{\\infty} e^{-x^{2}} \\, dx = \\sqrt{\\pi}'),
    '∫_{-∞}^{∞} e^{-x²} dx = √(π)'
  );
});

test('基线：欧拉恒等式', () => {
  assert.equal(latexToUnicode('e^{i\\pi} + 1 = 0'), 'e^{iπ} + 1 = 0');
});

test('基线：贝叶斯公式', () => {
  assert.equal(
    latexToUnicode('P(A \\mid B) = \\frac{P(B \\mid A)\\, P(A)}{P(B)}'),
    'P(A ∣ B) = (P(B ∣ A) P(A))/(P(B))'
  );
});

test('基线：stripTexDelimiters 去除 $$ 与 \\[\\] 定界符', () => {
  assert.equal(stripTexDelimiters('$$a+b$$'), 'a+b');
  assert.equal(stripTexDelimiters('\\[a+b\\]'), 'a+b');
  assert.equal(stripTexDelimiters('$a+b$'), 'a+b');
});

/* ---------- 新用例：本次功能检查发现的缺陷 ---------- */

test('带次方根号不应残留花括号：\\sqrt[3]{8} → √[3](8)', () => {
  assert.equal(latexToUnicode('\\sqrt[3]{8} = 2'), '√[3](8) = 2');
});

test('带次方根号的嵌套内容同样处理：\\sqrt[n]{x^{2}} → √[n](x²)', () => {
  assert.equal(latexToUnicode('\\sqrt[n]{x^{2}}'), '√[n](x²)');
});

test('单字符分数不加多余括号：\\frac{1}{2} → 1/2', () => {
  assert.equal(latexToUnicode('\\frac{1}{2}'), '1/2');
});

test('多字符分子保留必要括号：\\frac{a+b}{2} → (a+b)/2', () => {
  assert.equal(latexToUnicode('\\frac{a+b}{2}'), '(a+b)/2');
});

test('无花括号的简写分数：\\frac12 → 1/2', () => {
  assert.equal(latexToUnicode('\\frac12 + \\frac12 = 1'), '1/2 + 1/2 = 1');
});

test('无花括号的简写根号：\\sqrt2 → √(2)', () => {
  assert.equal(latexToUnicode('\\sqrt2'), '√(2)');
});

test('数学字体命令应剥去并保留内容：\\mathcal{F}', () => {
  assert.equal(latexToUnicode('\\mathcal{F}(f) = \\int f\\,dx'), 'F(f) = ∫ f dx');
});

test('粗体命令应剥去：\\boldsymbol{\\alpha} → α', () => {
  assert.equal(latexToUnicode('\\boldsymbol{\\alpha}'), 'α');
});

test('\\left. 与 \\right| 组合不应残留孤立句点', () => {
  assert.equal(latexToUnicode('\\left. \\frac{dy}{dx} \\right|_{x=1}'), '(dy)/(dx) |ₓ₌₁');
});

/* ---------- MathML 净化：Word / MathType 粘贴兼容 ---------- */
/* 以下夹具均取自 Temml 0.13.5 对真实公式的实际输出 */

test('净化：menclose 下划线（\\underline）转为标准 munder 结构', () => {
  assert.equal(
    sanitizeMathMLForWord('<msup><menclose notation="bottom" class="tml-underline"><mi>P</mi></menclose><mi>k</mi></msup>'),
    '<msup><munder><mi>P</mi><mo>\u0332</mo></munder><mi>k</mi></msup>'
  );
});

test('净化：嵌套 menclose 逐层转换', () => {
  assert.equal(
    sanitizeMathMLForWord('<menclose notation="bottom"><menclose notation="bottom"><mi>x</mi></menclose></menclose>'),
    '<munder><munder><mi>x</mi><mo>\u0332</mo></munder><mo>\u0332</mo></munder>'
  );
});

test('净化：cases 的隐形右括号（空 mo 元素）被删除', () => {
  assert.equal(
    sanitizeMathMLForWord('<mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="true"></mo></mrow>'),
    '<mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mi>x</mi></mrow>'
  );
});

test('净化：剥离 class / style 属性，保留内容与其他属性', () => {
  assert.equal(
    sanitizeMathMLForWord('<mo stretchy="false" class="chr-med wbk-med-acc" style="math-depth:0;">\u203E</mo>'),
    '<mo stretchy="false">\u203E</mo>'
  );
});

test('净化：有内容的 mo 不受影响', () => {
  const s = '<mo fence="true" form="prefix" stretchy="false">(</mo>';
  assert.equal(sanitizeMathMLForWord(s), s);
});

test('净化：幂等（重复净化结果不变）', () => {
  const once = sanitizeMathMLForWord('<mtd class="tml-left" style="padding-left:1em;"><mi>y</mi></mtd>');
  assert.equal(sanitizeMathMLForWord(once), once);
});

test('净化：完整公式 (25) 夹具（真实 Temml 输出）', () => {
  const mml = '<math><mrow><mrow><mo fence="true" form="prefix" stretchy="true">[</mo><msup><menclose notation="bottom" class="tml-underline"><mi>P</mi></menclose><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>k</mi><mo>+</mo><mn>1</mn><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></msup><mo separator="true">,</mo></mrow><mo>=</mo><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mtable><mtr><mtd><msup><menclose notation="bottom" class="tml-underline"><mi>P</mi></menclose><mi>k</mi></msup></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true"></mo></mrow></mrow></math>';
  const out = sanitizeMathMLForWord(mml);
  assert.ok(!out.includes('menclose'), '不应再有 menclose');
  assert.ok(!out.includes('class='), '不应再有 class');
  assert.ok(!out.includes('style='), '不应再有 style');
  assert.ok(!out.includes('<mo fence="true" form="postfix" stretchy="true"></mo>'), '不应有空 mo');
  assert.ok(out.includes('<munder><mi>P</mi><mo>\u0332</mo></munder>'), '下划线应为 munder');
  assert.ok(out.startsWith('<math xmlns="http://www.w3.org/1998/Math/MathML"') && out.endsWith('</math>'), 'math 根元素保持完整并带命名空间');
});

/* ---------- mspace / 空元素 / 隐形字符：Word 粘贴红色/黑色菱形修复 ---------- */
/* Word 的 MathML 导入器不认识 <mspace>（\quad \, \; 等间距命令），
 * 粘贴后渲染为红色菱形占位符；转为 U+00A0 不间断空格计数表达宽度——
 * U+2002~U+2006 等版式空格在中文 Word 的正文字体（宋体/等线）里没有字形，
 * 会渲染成黑色菱形，而 U+00A0 任何字体都有。 */

test('净化：\\quad 的 mspace 转为 4 个不间断空格', () => {
  assert.equal(
    sanitizeMathMLForWord('<mi>a</mi><mspace width="1em"></mspace><mi>b</mi>'),
    '<mi>a</mi><mtext>\u00a0\u00a0\u00a0\u00a0</mtext><mi>b</mi>'
  );
});

test('净化：\\qquad（2em）转为 8 个不间断空格', () => {
  assert.equal(
    sanitizeMathMLForWord('<mspace width="2em"></mspace>'),
    '<mtext>\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0</mtext>'
  );
});

test('净化：窄空格（\\, \\; \\:）直接丢弃，不产生空格 run', () => {
  assert.equal(
    sanitizeMathMLForWord('<mi>a</mi><mspace width="0.1667em"></mspace><mi>b</mi>'),
    '<mi>a</mi><mi>b</mi>'
  );
  assert.equal(sanitizeMathMLForWord('<mspace width="0.2222em"></mspace>'), '');
  assert.equal(sanitizeMathMLForWord('<mspace width="0.2778em"></mspace>'), '');
});

test('净化：自闭合形式 <mspace width="1em"/> 同样处理', () => {
  assert.equal(
    sanitizeMathMLForWord('<mi>a</mi><mspace width="1em"/><mi>b</mi>'),
    '<mi>a</mi><mtext>\u00a0\u00a0\u00a0\u00a0</mtext><mi>b</mi>'
  );
});

test('净化：空脚本槽位填充空字符（a_{}^{} 不再产生非法 msubsup）', () => {
  assert.equal(
    sanitizeMathMLForWord('<msubsup><mi>a</mi><mrow></mrow><mrow></mrow></msubsup>'),
    '<msubsup><mi>a</mi><mtext>\u00a0</mtext><mtext>\u00a0</mtext></msubsup>'
  );
});

test('净化：裸薄空格脚本槽位丢弃后解包基座（C_{\\,}^{\\,} → C）', () => {
  assert.equal(
    sanitizeMathMLForWord('<msubsup><mi>C</mi><mspace width="0.1667em"></mspace><mspace width="0.1667em"></mspace></msubsup>'),
    '<mi>C</mi>'
  );
});

test('净化：\\! 负空格的空 mrow（剥离 style 后残留）被删除', () => {
  assert.equal(
    sanitizeMathMLForWord('<mi>a</mi><mrow style="margin-left:-0.1667em;"></mrow><mi>b</mi>'),
    '<mi>a</mi><mi>b</mi>'
  );
});

test('净化：隐形运算符（U+2061~U+2064）与零宽空格被删除', () => {
  assert.equal(
    sanitizeMathMLForWord('<mi>f</mi><mo>\u2061</mo><mi>x</mi><mo>\u2062</mo><mi>y</mi>'),
    '<mi>f</mi><mi>x</mi><mi>y</mi>'
  );
  assert.ok(!sanitizeMathMLForWord('<mi>a</mi>\u200b<mi>b</mi>').includes('\u200b'));
});

/* ---------- 集成：真实 Temml 输出端到端净化 ---------- */

test('净化：math 根元素补 xmlns 命名空间', () => {
  assert.equal(
    sanitizeMathMLForWord('<math><mi>a</mi></math>'),
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi></math>'
  );
});

test('集成：公式 (9)（红色菱形原始案例）净化后不含任何 Word 敌对构造', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const temml = require('temml');
  const tex = 'R_{i,a,t} = \\frac{C_{i,a,t}}{Q_{i,t}^{0}} \\times 100\\%, \\quad W_{i,a,t} = \\frac{\\left| C_{i,a,t} \\right|}{\\sum_{i \\in \\mathcal{A}} \\left| C_{i,a,t} \\right|} \\times 100\\%';
  const mml = temml.renderToString(tex, { display: 'block' });
  const out = sanitizeMathMLForWord(mml);
  assert.ok(!out.includes('mspace'), '不应再有 mspace（红色菱形来源）');
  assert.ok(!/<mrow[^>]*>\s*<\/mrow>/.test(out), '不应有空 mrow');
  assert.ok(!/[\u2061-\u2064\u200b]/.test(out), '不应有隐形字符');
  assert.ok(!out.includes('class='), '不应有 class');
  assert.ok(out.includes('<mtext>\u00a0\u00a0\u00a0\u00a0</mtext>'), '\\quad 应转为 4 个不间断空格');
  assert.ok(out.includes('<mo>\u00d7</mo>'), '\\times 应保留为 ×');
  assert.ok(out.includes('100'), '数值内容保持完整');
});

test('集成：公式 (10)（上下标 + \\text 上标 + \\qquad）净化后脚本结构完整', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const temml = require('temml');
  const tex = 'Q_{i,t} - Q_{i,t}^{0} = \\sum_{k \\in \\mathcal{K}} C_{i,k,k} + C_{i,t}^{\\text{int}} + R_{i,t}^{\\text{nn}}, \\qquad R_{i,t}^{\\text{nn}} = Q_{i,t} - F_{i,t}(\\mathcal{K})';
  const mml = temml.renderToString(tex, { display: 'block' });
  const out = sanitizeMathMLForWord(mml);
  assert.ok(!out.includes('mspace'), '不应有 mspace');
  assert.ok(!/<mrow[^>]*>\s*<\/mrow>/.test(out), '不应有空 mrow');
  assert.equal((out.match(/<msubsup>/g) || []).length, 4, 'Q^0 / C^int / 两个 R^nn 的 msubsup 应全部保留');
  assert.ok(out.includes('<mtext>int</mtext>') && out.includes('<mtext>nn</mtext>'), '\\text 上标内容保留');
  assert.ok(out.includes('𝒦'), '脚本字符 mathcal K 保留');
  assert.ok(out.startsWith('<math xmlns='), '命名空间就位');
});

test('集成：约束优化公式（cases + \\bar + \\text）净化后结构完整', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const temml = require('temml');
  const tex = 'C_{C} = f(\\bar{P}_{C,j}, Q_{C,j}, T_{mn}) \\cdot q_{L} \\cdot \\frac{44}{12}, \\quad \\text{st.} \\begin{cases} f_{b1}(Q_{C,j}) \\leq \\bar{P}_{C,j} \\\\ 0 \\leq Q_{C,j} \\leq h_{mx} \\end{cases}';
  const mml = temml.renderToString(tex, { display: 'block' });
  const out = sanitizeMathMLForWord(mml);
  assert.ok(!out.includes('mspace'), '不应有 mspace');
  assert.ok(!out.includes('class='), '不应有 class');
  assert.ok(!out.includes('style='), '不应有 style');
  assert.ok(!/<mrow[^>]*>\s*<\/mrow>/.test(out), '不应有空 mrow');
  assert.ok(out.includes('<mover><mi>P</mi>'), '\\bar 的 mover 结构保留');
  assert.ok(out.includes('<mo fence="true" form="prefix" stretchy="true">{</mo>'), 'cases 左花括号保留');
  assert.ok(out.includes('<mtext>st.</mtext>'), '\\text{st.} 内容保留');
  assert.ok(out.startsWith('<math xmlns='), '命名空间就位');
});


/* ---------- OCR 结果规范化：消除排版残留（多出的一行等） ---------- */

test('规范化：公式之间的顶层 \\newline 转为空行分段', () => {
  assert.equal(
    normalizeOcrLatex('a = b\n\\newline\nc = d'),
    'a = b\n\nc = d'
  );
});

test('规范化：紧挨着的顶层 \\newline 同样处理（真实 OCR 输出形态）', () => {
  assert.equal(
    normalizeOcrLatex('x = \\frac{1}{2} \\newline \\begin{cases} a \\\\ b \\end{cases}'),
    'x = \\frac{1}{2}\n\n\\begin{cases} a \\\\ b \\end{cases}'
  );
});

test('规范化：cases 等环境内部的 \\newline 保持原样', () => {
  const s = '\\begin{cases} a \\newline b \\end{cases}';
  assert.equal(normalizeOcrLatex(s), s);
});

test('规范化：嵌套环境内的顶层判断正确', () => {
  const s = '\\begin{aligned} x &= 1 \\end{aligned}\n\\newline\n\\begin{cases} p \\\\ q \\end{cases}';
  assert.equal(
    normalizeOcrLatex(s),
    '\\begin{aligned} x &= 1 \\end{aligned}\n\n\\begin{cases} p \\\\ q \\end{cases}'
  );
});

test('规范化：环境尾部多余的 \\\\ 删除（cases 末尾多出空行的来源）', () => {
  assert.equal(
    normalizeOcrLatex('\\begin{cases} a \\\\ b \\\\ \\end{cases}'),
    '\\begin{cases} a \\\\ b \\end{cases}'
  );
});

test('规范化：整个结果末尾多余的 \\\\ 删除', () => {
  assert.equal(normalizeOcrLatex('a + b \\\\'), 'a + b');
});

test('规范化：三个以上连续换行折叠为一个空行', () => {
  assert.equal(normalizeOcrLatex('a\n\n\n\nb'), 'a\n\nb');
});

test('规范化：外层 $$ 定界符先剥离再规范化', () => {
  assert.equal(
    normalizeOcrLatex('$$a = b\n\\newline\nc = d$$'),
    'a = b\n\nc = d'
  );
});

test('规范化：普通公式不受影响（演示公式池基线）', () => {
  const pool = [
    'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}',
    '\\int_{-\\infty}^{\\infty} e^{-x^{2}} \\, dx = \\sqrt{\\pi}',
    'e^{i\\pi} + 1 = 0'
  ];
  pool.forEach(s => assert.equal(normalizeOcrLatex(s), s));
});

test('规范化：幂等（重复规范化结果不变）', () => {
  const once = normalizeOcrLatex('a\n\\newline\n\\begin{cases} x \\\\ \\end{cases}');
  assert.equal(normalizeOcrLatex(once), once);
});
