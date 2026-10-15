/**
 * convert.js —— 公式格式转换核心
 * 负责：LaTeX 清洗、KaTeX 渲染、LaTeX → MathML（Temml）、LaTeX → Unicode 纯文本
 * 全局命名空间：window.EQ
 */
(function () {
  'use strict';
  window.EQ = window.EQ || {};

  /* ============================================================
   * 一、LaTeX 清洗：去掉外层定界符（$$...$$ / \[...\] / $...$ 等）
   * ============================================================ */
  function stripTexDelimiters(tex) {
    if (!tex) return '';
    let s = String(tex).trim();
    const pairs = [
      [/^\$\$(?:\s*)?([\s\S]*?)(?:\s*)?\$\$$/, '$1'],
      [/^\\\[(?:\s*)?([\s\S]*?)(?:\s*)?\\\]$/, '$1'],
      [/^\$(?:\s*)?([^]*?)(?:\s*)?\$$/, '$1'],
      [/^\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}$/, '$1'],
      [/^\\begin\{displaymath\}([\s\S]*?)\\end\{displaymath\}$/, '$1']
    ];
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 4) {
      changed = false;
      for (const [re, rep] of pairs) {
        if (re.test(s)) { s = s.replace(re, rep).trim(); changed = true; }
      }
    }
    return s.trim();
  }

  /* ============================================================
   * 二、KaTeX 渲染
   * ============================================================ */
  function renderTexToHtml(tex) {
    if (typeof katex === 'undefined') {
      return '<div class="render-fallback"></div>';
    }
    // 多个公式（空行分隔）逐个渲染
    const parts = String(tex || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean);
    const list = parts.length ? parts : [String(tex || '')];
    return list
      .map(t => {
        try {
          return katex.renderToString(t, {
            displayMode: true,
            throwOnError: false,
            strict: false,
            trust: true,
            macros: { '\\RR': '\\mathbb{R}' }
          });
        } catch (e) {
          console.error('[EQ] KaTeX 渲染失败:', e, t);
          return '<div class="render-error">公式渲染失败：' + escapeHtml(e.message || String(e)) + '</div>';
        }
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ============================================================
   * 三、LaTeX → MathML（用于 Word / MathType 粘贴）
   * ============================================================ */

  /**
   * MathML 的 Word / MathType 兼容净化。
   * Temml 输出中有几类构造无法被 Word 的 MathML 导入器（MML2OMML，XSL 实现）
   * 正确转换，逐一处理：
   *   1. <menclose notation="bottom">（\underline）—— OMML 无对应物，转为标准 munder，
   *      否则 MathType 导入器抛 "Automation Error"；
   *   2. 空的 <mo ...></mo>（cases 等环境的隐形定界符）—— 删除；
   *   3. class / style 属性（Temml 内部 CSS 钩子，如 math-depth:0）—— 剥离；
   *   4. <mspace>（\quad \, \; \qquad 等间距命令）—— Word 不认识该元素，
   *      粘贴后渲染为菱形占位符 ◆。宽间距（\quad 以上）转为 <mtext> 内的连续
   *      不间断空格（U+00A0 任何字体都有字形，且不会被 XML 空白归一化吞掉）；
   *      窄间距（\, \: \;）视觉上不可感知，直接丢弃，避免空格 run 进入
   *      上下标等敏感位置；
   *   5. 空 <mrow></mrow> —— \! 负空格的 margin-left 实现直接删除；其余的
   *      （OCR 漏读上下标时 Temml 产出的空脚本槽位，如 a_{}^{}）填充为一个
   *      不间断空格——若删除会让 <msubsup> 缺少子元素，Word 渲染为
   *      堆叠的占位方块；
   *   6. 隐形运算符（U+2061~U+2064）与零宽空格（U+200B）—— 个别 Word /
   *      MathType 版本无法映射这些字符，同样显示为异常占位符，直接删除
   *      （OMML 中相邻元素的并置关系本就隐式成立）；
   *   7. <math> 根元素补 xmlns 命名空间 —— MathJax / Mathpix 等成熟实现
   *      的标准做法，确保 Word 剪贴板管线确定地按 MathML 处理。
   */
  function sanitizeMathMLForWord(mml) {
    let s = String(mml);
    // 隐形运算符 / 零宽空格先剥离，使其落入空 <mo> 的清理路径
    s = s.replace(/[\u2061-\u2064\u200b]/g, '');
    // 嵌套的 \underline 逐层转换（内层先完成）
    let guard = 0;
    while (guard++ < 20) {
      const next = s.replace(
        /<menclose notation="bottom"[^>]*>([\s\S]*?)<\/menclose>/,
        '<munder>$1<mo>\u0332</mo></munder>'
      );
      if (next === s) break;
      s = next;
    }
    s = s.replace(/<mo[^>]*><\/mo>/g, '');
    // \! 负空格：带 style 的空 mrow 是纯排版痕迹，整体删除（须在剥离 style 前）
    s = s.replace(/<mrow[^>]*\sstyle="[^"]*"[^>]*>\s*<\/mrow>/g, '');
    s = s.replace(/ (?:class|style)="[^"]*"/g, '');
    s = s.replace(/<mspace[^>]*\/?>(?:<\/mspace>)?/g, mspaceToText);
    // 其余空 mrow：多为空脚本槽位（a_{}^{}），填充空字符避免非法结构与占位方块
    s = s.replace(/<mrow[^>]*>\s*<\/mrow>/g, '<mtext>\u00a0</mtext>');
    // 退化脚本修复：薄空格脚本槽位（C_{\,}^{\,}）被丢弃后脚本元素只剩基座，
    // 解包保留基座，避免 Word 为缺失的上下标渲染占位方块
    guard = 0;
    while (guard++ < 10) {
      const next = s.replace(
        /<m(sub|sup|subsup|under|over|underover)((?:\s[^>]*)?)>((?:<mi[^>]*>[^<]*<\/mi>|<mn[^>]*>[^<]*<\/mn>|<mo[^>]*>[^<]*<\/mo>|<mtext>[^<]*<\/mtext>))<\/m\1>/,
        '$3'
      );
      if (next === s) break;
      s = next;
    }
    // 命名空间：Word 剪贴板对 MathML 的识别依赖 xmlns（缺失时部分版本走 HTML 剥标签路径）
    if (!/^<math[^>]*xmlns=/.test(s)) {
      s = s.replace(/^<math/, '<math xmlns="http://www.w3.org/1998/Math/MathML"');
    }
    return s;
  }

  /**
   * <mspace width="Xem"> 的替换体。
   * Temml 的宽度取值（em）：\, = 0.1667，\: = 0.2222，\; = 0.2778，
   * \quad = 1，\qquad = 2。
   * 宽间距用 U+00A0 不间断空格计数表达（普通正文字体一个空格约 1/4em，
   * \quad → 4 个、\qquad → 8 个）；窄间距不可感知，丢弃。
   */
  function mspaceToText(tag) {
    const m = /width="\s*(-?[\d.]+)\s*em\s*"/.exec(tag);
    const w = m ? parseFloat(m[1]) : 1;
    if (w <= 0.45) return '';                     // 负空格与 \, \: \; 等窄空格
    const count = Math.max(1, Math.round(w * 4));
    return '<mtext>' + '\u00a0'.repeat(count) + '</mtext>';
  }

  /**
   * OCR 结果规范化：消除 SimpleTex 输出中的排版残留。
   *  - 顶层（环境外）的 \newline 是 OCR 表达"图中上下两个公式"的方式，
   *    转为空行分段，让渲染层按多公式逐段渲染；否则它会落进同一个
   *    KaTeX 块里强制换行，产生多出来的那一行。
   *  - 环境内部（cases/aligned 等）的换行由 \\ 表达，不受影响。
   *  - 环境尾部 / 结果末尾多余的 \\ 会渲染出空行，删除。
   */
  function normalizeOcrLatex(tex) {
    let s = stripTexDelimiters(tex);

    // ① 仅替换环境深度为 0 的 \newline（\begin/\end 之间的不动），连带两侧水平空白
    const token = /\\(begin|end)\{[a-zA-Z*]+\}|[ \t]*\\newline(?![a-zA-Z])[ \t]*/g;
    let out = '', last = 0, depth = 0, m;
    while ((m = token.exec(s))) {
      if (m[1] === 'begin') { depth++; }
      else if (m[1] === 'end') { depth = Math.max(0, depth - 1); }
      else if (depth === 0) {
        out += s.slice(last, m.index) + '\n\n';
        last = m.index + m[0].length;
      }
    }
    s = out + s.slice(last);

    // ② 尾随的 \\（环境闭合前 / 结果末尾）会产生空行
    s = s.replace(/[ \t]*\\\\\s*(?=\\end\{[a-zA-Z*]+\})/g, ' ');
    s = s.replace(/[ \t]*\\\\\s*$/, '');

    // ③ 收敛连续空行
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  function texToMathML(tex) {
    // 注意：Temml 0.13.x 的 UMD 全局变量名为小写 temml
    const lib = window.Temml || window.temml;
    if (!lib) {
      throw new Error('MathML 引擎（Temml）未加载成功，请检查网络后刷新页面');
    }
    const clean = stripTexDelimiters(tex);
    if (!clean) throw new Error('公式内容为空');
    try {
      const mml = lib.renderToString(clean, { display: 'block' });
      if (!mml || mml.indexOf('<math') === -1) throw new Error('生成结果异常');
      return sanitizeMathMLForWord(mml);
    } catch (e) {
      console.error('[EQ] Temml 转换失败:', e);
      throw new Error('LaTeX → MathML 转换失败：' + (e.message || e));
    }
  }

  /* ============================================================
   * 四、LaTeX → Unicode 纯文本
   * ============================================================ */

  // 无参数符号命令映射表
  const SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
    varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
    varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆',
    circ: '∘', bullet: '∙', cup: '∪', cap: '∩', uplus: '⊎',
    sqcap: '⊓', sqcup: '⊔', vee: '∨', wedge: '∧', setminus: '∖', diamond: '⋄',
    oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
    dagger: '†', ddagger: '‡', amalg: '⨿',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', equiv: '≡',
    sim: '∼', simeq: '≃', asymp: '≈', approx: '≈', cong: '≅', propto: '∝',
    subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', nsubseteq: '⊈',
    sqsubset: '⊏', sqsubseteq: '⊑', in: '∈', ni: '∋', notin: '∉',
    perp: '⊥', mid: '∣', parallel: '∥', angle: '∠', triangle: '△',
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
    longrightarrow: '⟶', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
    infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄',
    emptyset: '∅', varnothing: '∅', because: '∵', therefore: '∴',
    hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', wp: '℘',
    prime: '′', backslash: '\\', ldots: '…', cdots: '⋯', vdots: '⋮', dots: '…',
    langle: '〈', rangle: '〉', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
    surd: '√', top: '⊤', bot: '⊥', neg: '¬', land: '∧', lor: '∨',
    ointop: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
    smile: '⌣', frown: '⌢', models: '⊨', vDash: '⊨',
    sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc',
    log: 'log', ln: 'ln', lg: 'lg', exp: 'exp', max: 'max', min: 'min',
    arg: 'arg', det: 'det', dim: 'dim', gcd: 'gcd', deg: 'deg', hom: 'hom',
    ker: 'ker', lim: 'lim', limsup: 'lim sup', liminf: 'lim inf', Pr: 'Pr'
  };

  const BB_MAP = { R: 'ℝ', C: 'ℂ', N: 'ℕ', Q: 'ℚ', Z: 'ℤ', P: 'ℙ', H: 'ℍ' };
  const SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
  const SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };
  const ACCENTS = { bar: '\u0304', vec: '\u20D7', hat: '\u0302', dot: '\u0307', ddot: '\u0308', tilde: '\u0303', acute: '\u0301', grave: '\u0300' };

  // 在字符串中找到 \cmd 后的第一组花括号内容（支持一层嵌套）
  function readGroup(s, cmdEnd) {
    let i = cmdEnd;
    while (i < s.length && s[i] === ' ') i++;
    if (s[i] !== '{') return null;
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    return { inner: s.slice(i + 1, j), start: i, end: j + 1 };
  }

  // 读取 \cmd 的一个参数：花括号组，或 LaTeX 简写的单 token（\frac12、\sqrt2、\frac\pi2）
  function readArg(s, pos) {
    const g = readGroup(s, pos);
    if (g) return g;
    let i = pos;
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) return null;
    const c = s[i];
    if (c === '[') return null; // [n] 是根号的次方选项，不是参数
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|[^\s])/.exec(s.slice(i));
      return m ? { inner: m[0], start: i, end: i + m[0].length } : null;
    }
    return { inner: c, start: i, end: i + 1 };
  }

  // 迭代替换 \cmd{A}{B} / \cmd{A} 形式的结构命令
  // opts.single：允许 LaTeX 简写的无花括号单 token 参数
  function replaceStruct(s, cmd, fn, opts) {
    const esc = '\\\\' + cmd + '(?![a-zA-Z])';
    const readFn = opts && opts.single ? readArg : readGroup;
    let re = new RegExp(esc);
    let guard = 0;
    while (re.test(s) && guard++ < 200) {
      const m = s.match(re);
      const g1 = readFn(s, m.index + m[0].length);
      if (!g1) break;
      let g2 = null;
      if (fn.length >= 2) g2 = readFn(s, g1.end);
      const replacement = g2 ? fn(g1.inner, g2.inner) : fn(g1.inner);
      s = s.slice(0, m.index) + replacement + s.slice((g2 || g1).end);
      re = new RegExp(esc);
    }
    return s;
  }

  function toScript(content, map, isSup) {
    const chars = String(content).split('');
    if (chars.length && chars.every(c => map[c] !== undefined)) return chars.map(c => map[c]).join('');
    // 无法全部映射时保留原写法，纯文本中也清晰可读
    return (isSup ? '^{' : '_{') + content + '}';
  }

  // 分数/根号参数转纯文本：单字符不加括号（\frac{1}{2} → 1/2），多字符才需要括号
  function argToText(t) { return t.length === 1 ? t : '(' + t + ')'; }

  // \sqrt[n]{x} 的处理：readArg 无法越过 [n] 选项，需要先解析选项再取参数
  function replaceSqrtIndexed(s) {
    const re = /\\sqrt\[([^\[\]]*)\]/;
    let guard = 0;
    while (guard++ < 100) {
      const m = re.exec(s);
      if (!m) break;
      const arg = readArg(s, m.index + m[0].length);
      if (!arg) break;
      s = s.slice(0, m.index) + '√[' + m[1] + '](' + arg.inner + ')' + s.slice(arg.end);
    }
    return s;
  }

  function latexToUnicode(input) {
    let s = stripTexDelimiters(input);

    // 结构命令（先处理嵌套的，再处理外层的）
    const fracText = (a, b) => argToText(a) + '/' + argToText(b);
    s = replaceStruct(s, 'frac', fracText, { single: true });
    s = replaceStruct(s, 'dfrac', fracText, { single: true });
    s = replaceStruct(s, 'tfrac', fracText, { single: true });
    s = replaceStruct(s, 'binom', (a, b) => 'C(' + a + ', ' + b + ')', { single: true });
    s = replaceStruct(s, 'sqrt', (a) => '√(' + a + ')', { single: true });
    s = replaceSqrtIndexed(s);
    s = replaceStruct(s, 'mathbb', (a) => BB_MAP[a] || a);
    s = replaceStruct(s, 'mathrm', (a) => a);
    s = replaceStruct(s, 'mathit', (a) => a);
    s = replaceStruct(s, 'mathbf', (a) => a);
    s = replaceStruct(s, 'mathcal', (a) => a);
    s = replaceStruct(s, 'mathfrak', (a) => a);
    s = replaceStruct(s, 'mathsf', (a) => a);
    s = replaceStruct(s, 'mathtt', (a) => a);
    s = replaceStruct(s, 'mathnormal', (a) => a);
    s = replaceStruct(s, 'bm', (a) => a);
    s = replaceStruct(s, 'boldsymbol', (a) => a);
    s = replaceStruct(s, 'pmb', (a) => a);
    s = replaceStruct(s, 'text', (a) => a);
    s = replaceStruct(s, 'textbf', (a) => a);
    s = replaceStruct(s, 'operatorname', (a) => a);
    s = replaceStruct(s, 'substack', (a) => a);

    // 重音符号：\bar{x} → x̄
    for (const [cmd, comb] of Object.entries(ACCENTS)) {
      s = replaceStruct(s, cmd, (a) => a + comb);
    }

    // 上下标
    s = s.replace(/\^\{([^{}]*)\}/g, (_, c) => toScript(c, SUP_MAP, true));
    s = s.replace(/_\{([^{}]*)\}/g, (_, c) => toScript(c, SUB_MAP, false));
    s = s.replace(/\^([0-9a-zA-Z])\b/g, (_, c) => SUP_MAP[c] !== undefined ? SUP_MAP[c] : '^' + c);
    s = s.replace(/_([0-9a-zA-Z])\b/g, (_, c) => SUB_MAP[c] !== undefined ? SUB_MAP[c] : '_' + c);

    // \left \right 及定界符命令（\left. / \right. 先删，避免残留孤立句点）
    s = s.replace(/\\left\s*\.|\\right\s*\./g, '');
    s = s.replace(/\\left|\\right|\\big|\\Big|\\bigg|\\Bigg|\\bigl|\\bigr|\\Bigl|\\Bigr/g, '');
    s = s.replace(/\\lvert|\\lVert/g, '|').replace(/\\rvert|\\rVert/g, '|');
    s = s.replace(/\\lbrace/g, '{').replace(/\\rbrace/g, '}');
    s = s.replace(/\\langle/g, '〈').replace(/\\rangle/g, '〉');

    // 间距命令
    s = s.replace(/\\[,;!>]|\\quad|\\qquad|\\hspace\{[^}]*\}|\\;/g, ' ');

    // 普通符号命令（一次正则扫描，避免前缀误替换）
    s = s.replace(/\\([a-zA-Z]+)/g, (full, name) => {
      if (SYMBOLS[name] !== undefined) return SYMBOLS[name];
      return name; // 未知命令：去掉反斜杠保留名称
    });

    // 其余排版环境
    s = s.replace(/\\begin\{(aligned|align|align\*|cases|gathered|array|matrix|pmatrix|bmatrix|vmatrix)\*?\}/g, '');
    s = s.replace(/\\end\{(aligned|align|align\*|cases|gathered|array|matrix|pmatrix|bmatrix|vmatrix)\*?\}/g, '');
    s = s.replace(/&/g, '  ').replace(/\\\\/g, ' ');

    // 转义字符
    s = s.replace(/\\\\\{/g, '{').replace(/\\\\\}/g, '}');
    s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
    s = s.replace(/\\\$/g, '$').replace(/\\%/g, '%').replace(/\\&/g, '&').replace(/\\#/g, '#').replace(/\\_/g, '_');

    // 整理空白
    s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n');
    return s.trim();
  }

  /* ============================================================
   * 五、导出
   * ============================================================ */
  EQ.convert = {
    stripTexDelimiters,
    renderTexToHtml,
    texToMathML,
    sanitizeMathMLForWord,
    normalizeOcrLatex,
    latexToUnicode,
    escapeHtml
  };
})();
