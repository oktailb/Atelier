/**
 * SimpleGallery WebOS - Scientific & Graphing Calculator (GraphingCalcApp)
 * Modes: Scientific / Standard (DEG/RAD/GRAD, memory, history),
 *        Programmer (HEX/DEC/OCT/BIN, 8/16/32/64-bit bitwise & interactive bit grid),
 *        2D Canvas Plotter (multi-curve, zoom/pan, trace, roots/extrema/intersections, value table, PNG export).
 */
(function (window, document) {
  'use strict';

  const WebOSApp = (window.sys && window.sys.App) || window.WebOSApp;
  const CURVE_COLORS = ['#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#a855f7'];
  const CURVE_LABELS = ['f', 'g', 'h', 'p', 'q', 'r'];

  class GraphingCalcApp extends WebOSApp {
    constructor() {
      super({
        id: 'graphing-calc',
        title: 'apps.graphing-calc.title',
        icon: '📐',
        width: 960,
        height: 660,
        tabs: [
          { id: 'scientific', label: 'calc.tab_scientific', icon: '🧮' },
          { id: 'programmer', label: 'calc.tab_programmer', icon: '💻' },
          { id: 'graph', label: 'calc.tab_graph', icon: '📈' }
        ]
      });

      this.engine = window.GraphingCalcEngine;

      // Scientific state
      this.angleMode = this.storage.get('angleMode', 'RAD');
      this.expression = '';
      this.lastResult = 0;
      this.lastResultText = '0';
      this.lastError = '';
      this.memory = Number(this.storage.get('memory', 0)) || 0;
      this.history = Array.isArray(this.storage.get('history', [])) ? this.storage.get('history', []).slice(0, 30) : [];

      // Programmer state (BigInt stored as decimal string in storage)
      this.progBase = Number(this.storage.get('progBase', 16)) || 16;
      this.progBits = Number(this.storage.get('progBits', 32)) || 32;
      this.progSigned = this.storage.get('progSigned', true) !== false;
      this.progValue = 0n;
      this.progAccumulator = null;
      this.progPendingOp = null;
      this.progFreshInput = true;
      this.progError = '';

      // Graph state
      const savedCurves = this.storage.get('curves', null);
      this.curves = Array.isArray(savedCurves) && savedCurves.length > 0 ? savedCurves : [
        { id: 'c1', label: 'f', expr: 'sin(x)', color: CURVE_COLORS[0], visible: true },
        { id: 'c2', label: 'g', expr: '0.25*x^2 - 1', color: CURVE_COLORS[1], visible: true }
      ];
      this.plotter = null;
      this.resizeObserver = null;
      this.traceInfo = null;
      this.showTable = false;
      this.tableStart = -5;
      this.tableEnd = 5;
      this.tableStep = 1;
      this.tableCurveId = this.curves[0]?.id || 'c1';

      this._keydownHandler = null;
    }

    onOpen() {
      this.attachKeyboard();
    }

    onClose() {
      this.detachKeyboard();
      this.destroyPlotter();
    }

    onLocaleChanged() {
      if (this.window && window.WindowManager) {
        window.WindowManager.setTitle(this.window.id, `${this.icon} ${this.t('apps.graphing-calc.title')}`);
      }
    }

    onThemeChanged() {
      if (this.plotter) {
        this.plotter.render();
      }
    }

    destroyPlotter() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.plotter) {
        this.plotter.destroy();
        this.plotter = null;
      }
    }

    renderHeaderExtra() {
      return `
        <div class="gcalc-header-tools">
          <div class="gcalc-angle-group" role="group" aria-label="${this.escapeHtml(this.t('calc.angle_mode'))}">
            ${['DEG', 'RAD', 'GRAD'].map(m => `
              <button type="button" class="gcalc-pill-btn ${this.angleMode === m ? 'active' : ''}" data-action="set-angle" data-angle="${m}">${m}</button>
            `).join('')}
          </div>
        </div>
      `;
    }

    renderTab(tabId) {
      const tab = tabId || this.currentTab;
      if (tab !== 'graph') {
        this.destroyPlotter();
      }
      if (tab === 'programmer') {
        return this.renderProgrammerTab();
      }
      if (tab === 'graph') {
        return this.renderGraphTab();
      }
      return this.renderScientificTab();
    }

    renderContent() {
      return this.renderTab(this.currentTab);
    }

    // -------------------------------------------------------------------------
    // TAB 1 : SCIENTIFIC / STANDARD CALCULATOR
    // -------------------------------------------------------------------------

    renderScientificTab() {
      const memActive = Math.abs(this.memory) > 1e-15;
      const preview = this.computeLivePreview();

      return `
        <div class="gcalc-sci-layout">
          <div class="gcalc-sci-main">
            <div class="gcalc-display-card">
              <div class="gcalc-display-meta">
                <span class="gcalc-badge">${this.escapeHtml(this.angleMode)}</span>
                ${memActive ? `<span class="gcalc-badge gcalc-badge-mem">M = ${this.escapeHtml(this.engine.formatNumber(this.memory))}</span>` : ''}
                <span class="gcalc-ans-hint">Ans = ${this.escapeHtml(this.lastResultText)}</span>
              </div>
              <input
                type="text"
                id="gcalcExprInput"
                class="gcalc-expr-input"
                value="${this.escapeHtml(this.expression)}"
                placeholder="${this.escapeHtml(this.t('calc.expr_placeholder'))}"
                autocomplete="off"
                spellcheck="false"
              />
              <div id="gcalcResultLine" class="gcalc-result-line ${this.lastError ? 'is-error' : ''}">
                ${this.escapeHtml(this.lastError || preview || this.lastResultText)}
              </div>
            </div>

            <div class="gcalc-memory-bar">
              <button type="button" class="gcalc-mem-btn" data-action="mem" data-mem="MC">MC</button>
              <button type="button" class="gcalc-mem-btn" data-action="mem" data-mem="MR">MR</button>
              <button type="button" class="gcalc-mem-btn" data-action="mem" data-mem="M+">M+</button>
              <button type="button" class="gcalc-mem-btn" data-action="mem" data-mem="M-">M-</button>
              <button type="button" class="gcalc-mem-btn" data-action="mem" data-mem="MS">MS</button>
              <button type="button" class="gcalc-mem-btn gcalc-plot-shortcut" data-action="send-to-graph">📈 ${this.escapeHtml(this.t('calc.send_to_graph'))}</button>
            </div>

            <div class="gcalc-keypad-sci">
              <button type="button" class="gcalc-key key-fn" data-insert="sin(">sin</button>
              <button type="button" class="gcalc-key key-fn" data-insert="cos(">cos</button>
              <button type="button" class="gcalc-key key-fn" data-insert="tan(">tan</button>
              <button type="button" class="gcalc-key key-fn" data-insert="ln(">ln</button>
              <button type="button" class="gcalc-key key-fn" data-insert="log(">log</button>
              <button type="button" class="gcalc-key key-danger" data-action="clear-all">AC</button>

              <button type="button" class="gcalc-key key-fn" data-insert="asin(">sin⁻¹</button>
              <button type="button" class="gcalc-key key-fn" data-insert="acos(">cos⁻¹</button>
              <button type="button" class="gcalc-key key-fn" data-insert="atan(">tan⁻¹</button>
              <button type="button" class="gcalc-key key-fn" data-insert="exp(">eˣ</button>
              <button type="button" class="gcalc-key key-fn" data-insert="10^">10ˣ</button>
              <button type="button" class="gcalc-key key-op" data-action="backspace">⌫</button>

              <button type="button" class="gcalc-key key-fn" data-insert="sqrt(">√x</button>
              <button type="button" class="gcalc-key key-fn" data-insert="cbrt(">∛x</button>
              <button type="button" class="gcalc-key key-fn" data-insert="^2">x²</button>
              <button type="button" class="gcalc-key key-fn" data-insert="^">xʸ</button>
              <button type="button" class="gcalc-key key-fn" data-insert="!">n!</button>
              <button type="button" class="gcalc-key key-op" data-insert="/">÷</button>

              <button type="button" class="gcalc-key key-fn" data-insert="abs(">|x|</button>
              <button type="button" class="gcalc-key key-fn" data-insert="pi">π</button>
              <button type="button" class="gcalc-key key-num" data-insert="7">7</button>
              <button type="button" class="gcalc-key key-num" data-insert="8">8</button>
              <button type="button" class="gcalc-key key-num" data-insert="9">9</button>
              <button type="button" class="gcalc-key key-op" data-insert="*">×</button>

              <button type="button" class="gcalc-key key-fn" data-insert="(">(</button>
              <button type="button" class="gcalc-key key-fn" data-insert="e">e</button>
              <button type="button" class="gcalc-key key-num" data-insert="4">4</button>
              <button type="button" class="gcalc-key key-num" data-insert="5">5</button>
              <button type="button" class="gcalc-key key-num" data-insert="6">6</button>
              <button type="button" class="gcalc-key key-op" data-insert="-">−</button>

              <button type="button" class="gcalc-key key-fn" data-insert=")">)</button>
              <button type="button" class="gcalc-key key-fn" data-insert="ans">Ans</button>
              <button type="button" class="gcalc-key key-num" data-insert="1">1</button>
              <button type="button" class="gcalc-key key-num" data-insert="2">2</button>
              <button type="button" class="gcalc-key key-num" data-insert="3">3</button>
              <button type="button" class="gcalc-key key-op" data-insert="+">+</button>

              <button type="button" class="gcalc-key key-fn" data-insert="mod(">mod</button>
              <button type="button" class="gcalc-key key-fn" data-insert="x">x</button>
              <button type="button" class="gcalc-key key-num" data-insert="0">0</button>
              <button type="button" class="gcalc-key key-num" data-insert=".">.</button>
              <button type="button" class="gcalc-key key-fn" data-insert="e-">×10⁻</button>
              <button type="button" class="gcalc-key key-eq" data-action="evaluate">=</button>
            </div>
          </div>

          <aside class="gcalc-history-panel">
            <div class="gcalc-panel-header">
              <span>🕒 ${this.escapeHtml(this.t('calc.history_title'))}</span>
              ${this.history.length > 0 ? `<button type="button" class="gcalc-mini-btn" data-action="clear-history">${this.escapeHtml(this.t('calc.clear_history'))}</button>` : ''}
            </div>
            <div class="gcalc-history-list">
              ${this.history.length === 0
                ? `<div class="gcalc-empty-hint">${this.escapeHtml(this.t('calc.history_empty'))}</div>`
                : this.history.map((item, idx) => `
                  <button type="button" class="gcalc-history-item" data-action="recall-history" data-idx="${idx}">
                    <div class="gcalc-hist-expr">${this.escapeHtml(item.expr)}</div>
                    <div class="gcalc-hist-res">= ${this.escapeHtml(item.result)}</div>
                  </button>
                `).join('')}
            </div>
          </aside>
        </div>
      `;
    }

    computeLivePreview() {
      if (!this.expression.trim()) return '';
      try {
        const val = this.engine.evaluate(this.expression, { ans: this.lastResult }, this.angleMode);
        if (typeof val === 'number' && !Number.isNaN(val)) {
          return '= ' + this.engine.formatNumber(val);
        }
      } catch (e) {
        // Incomplete expression while typing
      }
      return '';
    }

    evaluateScientific() {
      const expr = this.expression.trim();
      if (!expr) return;
      try {
        const val = this.engine.evaluate(expr, { ans: this.lastResult }, this.angleMode);
        if (typeof val !== 'number' || Number.isNaN(val)) {
          this.lastError = this.t('calc.err_math');
        } else {
          this.lastResult = val;
          this.lastResultText = this.engine.formatNumber(val);
          this.lastError = '';
          this.history.unshift({ expr, result: this.lastResultText, mode: this.angleMode });
          if (this.history.length > 30) this.history.pop();
          this.storage.set('history', this.history);
        }
      } catch (e) {
        this.lastError = e.message || this.t('calc.err_syntax');
      }
      this.render();
    }

    // -------------------------------------------------------------------------
    // TAB 2 : PROGRAMMER MODE (HEX / DEC / OCT / BIN + INTERACTIVE BIT GRID)
    // -------------------------------------------------------------------------

    renderProgrammerTab() {
      const p = this.engine.programmer;
      const val = p.maskBits(this.progValue, this.progBits);
      const bases = [
        { base: 16, label: 'HEX', text: p.formatBase(val, 16, this.progBits, this.progSigned) },
        { base: 10, label: 'DEC', text: p.formatBase(val, 10, this.progBits, this.progSigned) },
        { base: 8, label: 'OCT', text: p.formatBase(val, 8, this.progBits, this.progSigned) },
        { base: 2, label: 'BIN', text: p.formatBase(val, 2, this.progBits, this.progSigned) }
      ];

      const pendingStr = this.progPendingOp && this.progAccumulator !== null
        ? `${p.formatBase(this.progAccumulator, this.progBase, this.progBits, this.progSigned)} ${this.progPendingOp}`
        : '';

      // Build interactive bit grid (grouped in nibbles of 4 bits)
      const bitGroups = [];
      for (let hi = this.progBits - 1; hi >= 0; hi -= 4) {
        const nibble = [];
        for (let b = hi; b > hi - 4 && b >= 0; b--) {
          const isSet = ((val >> BigInt(b)) & 1n) === 1n;
          nibble.push(`<button type="button" class="gcalc-bit-btn ${isSet ? 'is-one' : ''}" data-action="toggle-bit" data-bit="${b}" title="Bit ${b}">${isSet ? '1' : '0'}</button>`);
        }
        bitGroups.push(`
          <div class="gcalc-bit-nibble">
            <div class="gcalc-bit-row">${nibble.join('')}</div>
            <div class="gcalc-bit-idx">${hi}..${Math.max(0, hi - 3)}</div>
          </div>
        `);
      }

      const hexDisabled = this.progBase < 16;
      const decDisabled = this.progBase < 10;
      const octDisabled = this.progBase < 8;

      return `
        <div class="gcalc-prog-layout">
          <div class="gcalc-prog-top">
            <div class="gcalc-prog-display">
              <div class="gcalc-prog-pending">${this.escapeHtml(pendingStr || this.progError)}</div>
              <div class="gcalc-prog-main-val">${this.escapeHtml(p.formatBase(val, this.progBase, this.progBits, this.progSigned))}</div>
              <div class="gcalc-base-rows">
                ${bases.map(b => `
                  <button type="button" class="gcalc-base-row ${this.progBase === b.base ? 'active' : ''}" data-action="prog-base" data-base="${b.base}">
                    <span class="gcalc-base-name">${b.label}</span>
                    <span class="gcalc-base-val">${this.escapeHtml(b.text)}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="gcalc-prog-controls">
              <div class="gcalc-word-group">
                ${[64, 32, 16, 8].map(w => `
                  <button type="button" class="gcalc-pill-btn ${this.progBits === w ? 'active' : ''}" data-action="prog-bits" data-bits="${w}">${w}-bit</button>
                `).join('')}
                <button type="button" class="gcalc-pill-btn ${this.progSigned ? 'active' : ''}" data-action="prog-signed">
                  ${this.escapeHtml(this.progSigned ? this.t('calc.prog_signed') : this.t('calc.prog_unsigned'))}
                </button>
              </div>
              <div class="gcalc-bit-grid">${bitGroups.join('')}</div>
            </div>
          </div>

          <div class="gcalc-prog-keypad">
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="AND">AND</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="OR">OR</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="XOR">XOR</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-unary" data-op="NOT">NOT</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="NAND">NAND</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="NOR">NOR</button>

            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="SHL">SHL &lt;&lt;</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="SHR">SHR &gt;&gt;</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="ROL">ROL</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="ROR">ROR</button>
            <button type="button" class="gcalc-key key-op" data-action="prog-backspace">⌫</button>
            <button type="button" class="gcalc-key key-danger" data-action="prog-clear">AC</button>

            <button type="button" class="gcalc-key key-hex" data-action="prog-digit" data-digit="A" ${hexDisabled ? 'disabled' : ''}>A</button>
            <button type="button" class="gcalc-key key-hex" data-action="prog-digit" data-digit="B" ${hexDisabled ? 'disabled' : ''}>B</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="7" ${octDisabled ? 'disabled' : ''}>7</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="8" ${decDisabled ? 'disabled' : ''}>8</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="9" ${decDisabled ? 'disabled' : ''}>9</button>
            <button type="button" class="gcalc-key key-op" data-action="prog-op" data-op="DIV">÷</button>

            <button type="button" class="gcalc-key key-hex" data-action="prog-digit" data-digit="C" ${hexDisabled ? 'disabled' : ''}>C</button>
            <button type="button" class="gcalc-key key-hex" data-action="prog-digit" data-digit="D" ${hexDisabled ? 'disabled' : ''}>D</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="4" ${octDisabled ? 'disabled' : ''}>4</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="5" ${octDisabled ? 'disabled' : ''}>5</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="6" ${octDisabled ? 'disabled' : ''}>6</button>
            <button type="button" class="gcalc-key key-op" data-action="prog-op" data-op="MUL">×</button>

            <button type="button" class="gcalc-key key-hex" data-action="prog-digit" data-digit="E" ${hexDisabled ? 'disabled' : ''}>E</button>
            <button type="button" class="gcalc-key key-hex" data-action="prog-digit" data-digit="F" ${hexDisabled ? 'disabled' : ''}>F</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="1">1</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="2" ${octDisabled ? 'disabled' : ''}>2</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="3" ${octDisabled ? 'disabled' : ''}>3</button>
            <button type="button" class="gcalc-key key-op" data-action="prog-op" data-op="SUB">−</button>

            <button type="button" class="gcalc-key key-fn" data-action="prog-unary" data-op="NEG">±</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-op" data-op="MOD">MOD</button>
            <button type="button" class="gcalc-key key-num" data-action="prog-digit" data-digit="0">0</button>
            <button type="button" class="gcalc-key key-fn" data-action="prog-copy">📋</button>
            <button type="button" class="gcalc-key key-op" data-action="prog-op" data-op="ADD">+</button>
            <button type="button" class="gcalc-key key-eq" data-action="prog-eval">=</button>
          </div>
        </div>
      `;
    }

    handleProgDigit(digit) {
      const p = this.engine.programmer;
      this.progError = '';
      const dVal = BigInt(parseInt(digit, 16));
      if (dVal >= BigInt(this.progBase)) return;
      if (this.progFreshInput) {
        this.progValue = p.maskBits(dVal, this.progBits);
        this.progFreshInput = false;
      } else {
        this.progValue = p.maskBits(this.progValue * BigInt(this.progBase) + dVal, this.progBits);
      }
      this.render();
    }

    handleProgOp(op) {
      const p = this.engine.programmer;
      this.progError = '';
      if (this.progPendingOp && this.progAccumulator !== null && !this.progFreshInput) {
        try {
          this.progValue = p.bitwiseOp(this.progPendingOp, this.progAccumulator, this.progValue, this.progBits, this.progSigned);
        } catch (e) {
          this.progError = e.message;
        }
      }
      this.progAccumulator = this.progValue;
      this.progPendingOp = op;
      this.progFreshInput = true;
      this.render();
    }

    handleProgEval() {
      const p = this.engine.programmer;
      if (this.progPendingOp && this.progAccumulator !== null) {
        try {
          this.progValue = p.bitwiseOp(this.progPendingOp, this.progAccumulator, this.progValue, this.progBits, this.progSigned);
          this.progError = '';
        } catch (e) {
          this.progError = e.message;
        }
        this.progAccumulator = null;
        this.progPendingOp = null;
        this.progFreshInput = true;
        this.render();
      }
    }

    // -------------------------------------------------------------------------
    // TAB 3 : 2D CANVAS GRAPHING PLOTTER
    // -------------------------------------------------------------------------

    renderGraphTab() {
      return `
        <div class="gcalc-graph-layout">
          <aside class="gcalc-graph-sidebar">
            <div class="gcalc-panel-header">
              <span>📈 ${this.escapeHtml(this.t('calc.graph_functions'))}</span>
              <button type="button" class="gcalc-mini-btn" data-action="add-curve">+ ${this.escapeHtml(this.t('calc.add_curve'))}</button>
            </div>

            <div class="gcalc-curves-list">
              ${this.curves.map((c, idx) => `
                <div class="gcalc-curve-row" data-curve-id="${this.escapeHtml(c.id)}">
                  <button type="button" class="gcalc-curve-toggle ${c.visible !== false ? 'is-on' : ''}" data-action="toggle-curve" data-idx="${idx}" style="--curve-color:${this.escapeHtml(c.color)}" title="${this.escapeHtml(this.t('calc.toggle_visibility'))}">
                    <span class="gcalc-color-dot"></span>
                  </button>
                  <span class="gcalc-curve-label">${this.escapeHtml(c.label)}(x) =</span>
                  <input type="text" class="gcalc-curve-input" data-curve-idx="${idx}" value="${this.escapeHtml(c.expr)}" placeholder="sin(x)" autocomplete="off" spellcheck="false" />
                  ${this.curves.length > 1 ? `<button type="button" class="gcalc-curve-del" data-action="remove-curve" data-idx="${idx}" title="${this.escapeHtml(this.t('common.delete'))}">✕</button>` : ''}
                </div>
              `).join('')}
            </div>

            <div class="gcalc-presets-row">
              <span class="gcalc-presets-label">${this.escapeHtml(this.t('calc.presets'))}:</span>
              <button type="button" class="gcalc-chip-btn" data-action="preset" data-preset="trig">sin/cos</button>
              <button type="button" class="gcalc-chip-btn" data-action="preset" data-preset="poly">x³-3x</button>
              <button type="button" class="gcalc-chip-btn" data-action="preset" data-preset="damped">e⁻ˣ²cos</button>
              <button type="button" class="gcalc-chip-btn" data-action="preset" data-preset="hyperbola">1/x</button>
            </div>

            <div class="gcalc-analysis-box">
              <div class="gcalc-panel-header">
                <span>🔍 ${this.escapeHtml(this.t('calc.analysis_title'))}</span>
                <button type="button" class="gcalc-mini-btn" data-action="toggle-table">
                  ${this.escapeHtml(this.showTable ? this.t('calc.view_analysis') : this.t('calc.view_table'))}
                </button>
              </div>
              <div id="gcalcAnalysisBody" class="gcalc-analysis-body"></div>
            </div>
          </aside>

          <div class="gcalc-graph-stage">
            <div class="gcalc-graph-toolbar">
              <div class="gcalc-toolbar-group">
                <button type="button" class="gcalc-tool-btn" data-action="zoom-in" title="${this.escapeHtml(this.t('calc.zoom_in'))}">＋</button>
                <button type="button" class="gcalc-tool-btn" data-action="zoom-out" title="${this.escapeHtml(this.t('calc.zoom_out'))}">－</button>
                <button type="button" class="gcalc-tool-btn" data-action="zoom-reset" title="${this.escapeHtml(this.t('calc.zoom_reset'))}">⟲</button>
              </div>
              <div class="gcalc-toolbar-group">
                <button type="button" class="gcalc-tool-btn" data-action="export-download">⬇️ ${this.escapeHtml(this.t('calc.export_png'))}</button>
                <button type="button" class="gcalc-tool-btn gcalc-tool-primary" data-action="export-gallery">🖼️ ${this.escapeHtml(this.t('calc.save_to_gallery'))}</button>
              </div>
            </div>

            <div class="gcalc-canvas-wrap">
              <canvas id="gcalcCanvas"></canvas>
            </div>

            <div id="gcalcTraceBar" class="gcalc-trace-bar">
              ${this.escapeHtml(this.t('calc.trace_hint'))}
            </div>
          </div>
        </div>
      `;
    }

    initPlotter() {
      const canvas = document.getElementById('gcalcCanvas');
      if (!canvas || !window.GraphingCalcPlotter) return;

      const prevViewport = this.plotter ? this.plotter.getViewport() : null;
      this.destroyPlotter();

      this.plotter = new window.GraphingCalcPlotter(canvas, {
        engine: this.engine,
        angleMode: this.angleMode,
        ...(prevViewport || {}),
        onTrace: (info) => this.updateTraceBar(info),
        onViewportChange: () => this.renderAnalysisBody()
      });

      this.plotter.setCurves(this.curves, this.angleMode);
      this.renderAnalysisBody();

      if (typeof ResizeObserver === 'function' && canvas.parentElement) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.plotter) this.plotter.render();
        });
        this.resizeObserver.observe(canvas.parentElement);
      }
    }

    updateTraceBar(info) {
      const bar = document.getElementById('gcalcTraceBar');
      if (!bar || !info) return;
      const fmt = (v) => this.engine.formatNumber(v, 5);
      const parts = [`<strong>x = ${this.escapeHtml(fmt(info.x))}</strong>`];
      for (const v of info.values) {
        parts.push(
          `<span style="color:${this.escapeHtml(v.color)}">${this.escapeHtml(v.label)}(x) = ${this.escapeHtml(fmt(v.y))}</span>`
        );
      }
      bar.innerHTML = parts.join(' &nbsp;|&nbsp; ');
    }

    renderAnalysisBody() {
      const el = document.getElementById('gcalcAnalysisBody');
      if (!el || !this.plotter) return;

      if (this.showTable) {
        const activeCurve = this.curves.find(c => c.id === this.tableCurveId) || this.curves[0];
        let compiled = null;
        if (activeCurve) {
          const found = this.plotter.curves.find(c => c.id === activeCurve.id);
          compiled = found ? found.compiled : null;
        }
        const rows = compiled ? this.engine.generateTable(compiled, this.tableStart, this.tableEnd, this.tableStep) : [];
        el.innerHTML = `
          <div class="gcalc-table-controls">
            <select id="gcalcTableCurve" class="gcalc-small-input">
              ${this.curves.map(c => `<option value="${this.escapeHtml(c.id)}" ${activeCurve && c.id === activeCurve.id ? 'selected' : ''}>${this.escapeHtml(c.label)}(x)</option>`).join('')}
            </select>
            <input type="number" id="gcalcTableStart" class="gcalc-small-input" value="${this.tableStart}" step="1" title="x min" />
            <input type="number" id="gcalcTableEnd" class="gcalc-small-input" value="${this.tableEnd}" step="1" title="x max" />
            <input type="number" id="gcalcTableStep" class="gcalc-small-input" value="${this.tableStep}" step="0.5" min="0.05" title="step" />
          </div>
          <div class="gcalc-table-scroll">
            <table class="gcalc-val-table">
              <thead><tr><th>x</th><th>${this.escapeHtml(activeCurve ? activeCurve.label : 'f')}(x)</th></tr></thead>
              <tbody>
                ${rows.map(r => `<tr><td>${this.escapeHtml(this.engine.formatNumber(r.x, 5))}</td><td>${this.escapeHtml(this.engine.formatNumber(r.y, 6))}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `;
        return;
      }

      const { roots, extrema, intersections } = this.plotter.analysis;
      const fmt = (v) => this.engine.formatNumber(v, 4);
      const blocks = [];

      blocks.push(`<div class="gcalc-anal-section"><div class="gcalc-anal-title"><span class="gcalc-dot-root">●</span> ${this.escapeHtml(this.t('calc.roots'))} (${roots.length})</div>${
        roots.length === 0
          ? `<div class="gcalc-anal-none">${this.escapeHtml(this.t('calc.none_in_view'))}</div>`
          : roots.slice(0, 8).map(r => `<button type="button" class="gcalc-point-btn" data-action="focus-point" data-px="${r.x}" data-py="${r.y}">${this.escapeHtml(r.label)}: (${this.escapeHtml(fmt(r.x))}, 0)</button>`).join('')
      }</div>`);

      blocks.push(`<div class="gcalc-anal-section"><div class="gcalc-anal-title"><span class="gcalc-dot-ext">▲</span> ${this.escapeHtml(this.t('calc.extrema'))} (${extrema.length})</div>${
        extrema.length === 0
          ? `<div class="gcalc-anal-none">${this.escapeHtml(this.t('calc.none_in_view'))}</div>`
          : extrema.slice(0, 8).map(ex => `<button type="button" class="gcalc-point-btn" data-action="focus-point" data-px="${ex.x}" data-py="${ex.y}">${this.escapeHtml(ex.label)} [${this.escapeHtml(ex.kind)}]: (${this.escapeHtml(fmt(ex.x))}, ${this.escapeHtml(fmt(ex.y))})</button>`).join('')
      }</div>`);

      blocks.push(`<div class="gcalc-anal-section"><div class="gcalc-anal-title"><span class="gcalc-dot-int">◆</span> ${this.escapeHtml(this.t('calc.intersections'))} (${intersections.length})</div>${
        intersections.length === 0
          ? `<div class="gcalc-anal-none">${this.escapeHtml(this.t('calc.none_in_view'))}</div>`
          : intersections.slice(0, 8).map(pt => `<button type="button" class="gcalc-point-btn" data-action="focus-point" data-px="${pt.x}" data-py="${pt.y}">${this.escapeHtml(pt.curveA)} ∩ ${this.escapeHtml(pt.curveB)}: (${this.escapeHtml(fmt(pt.x))}, ${this.escapeHtml(fmt(pt.y))})</button>`).join('')
      }</div>`);

      el.innerHTML = blocks.join('');
    }

    async exportGraphDownload() {
      if (!this.plotter) return;
      try {
        const blob = await this.plotter.toPngBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `graph_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.toast.success(this.t('calc.export_download_ok'));
      } catch (e) {
        this.toast.error(this.t('calc.export_error'));
      }
    }

    async exportGraphToGallery() {
      if (!this.plotter) return;
      try {
        const blob = await this.plotter.toPngBlob();
        const defaultDir = (window.explorerApp && window.explorerApp.state && window.explorerApp.state.currentDir) || '';
        const filename = `graph_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
        const fd = new FormData();
        fd.append('dir', defaultDir);
        fd.append('file', blob, filename);

        const res = await this.api.upload('upload_file', fd);
        if (res && res.success) {
          this.toast.success(this.t('calc.export_gallery_ok', { name: filename }));
          if (window.explorerApp && typeof window.explorerApp.loadDirectory === 'function') {
            window.explorerApp.loadDirectory(defaultDir);
          }
        } else {
          this.toast.error((res && res.error) || this.t('calc.export_gallery_denied'));
        }
      } catch (e) {
        this.toast.error(this.t('calc.export_error'));
      }
    }

    // -------------------------------------------------------------------------
    // EVENTS & KEYBOARD
    // -------------------------------------------------------------------------

    bindEvents(container) {
      if (!container) return;

      if (this.currentTab === 'graph') {
        this.initPlotter();
      }

      const exprInput = container.querySelector('#gcalcExprInput');
      if (exprInput) {
        exprInput.addEventListener('input', () => {
          this.expression = exprInput.value;
          this.lastError = '';
          const resLine = container.querySelector('#gcalcResultLine');
          if (resLine) {
            resLine.classList.remove('is-error');
            resLine.textContent = this.computeLivePreview() || this.lastResultText;
          }
        });
        exprInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.evaluateScientific();
          } else if (e.key === 'Escape') {
            this.expression = '';
            this.lastError = '';
            this.render();
          }
        });
      }

      // Curve live inputs
      container.querySelectorAll('.gcalc-curve-input').forEach(inp => {
        inp.addEventListener('input', () => {
          const idx = parseInt(inp.dataset.curveIdx, 10);
          if (this.curves[idx]) {
            this.curves[idx].expr = inp.value;
            this.storage.set('curves', this.curves);
            if (this.plotter) {
              this.plotter.setCurves(this.curves, this.angleMode);
              this.renderAnalysisBody();
            }
          }
        });
      });

      // Delegated clicks inside container
      container.onclick = (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;

        // Tab buttons are already bound by WebOSApp.bindShellEvents()
        if (btn.dataset.tab) return;

        // Insert scientific token
        if (btn.dataset.insert !== undefined) {
          this.expression += btn.dataset.insert;
          this.lastError = '';
          this.render();
          const inp = document.getElementById('gcalcExprInput');
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
          return;
        }

        const act = btn.dataset.action;
        if (!act) return;

        switch (act) {
          case 'set-angle':
            this.angleMode = btn.dataset.angle || 'RAD';
            this.storage.set('angleMode', this.angleMode);
            container.querySelectorAll('[data-action="set-angle"]').forEach(b => {
              b.classList.toggle('active', b.dataset.angle === this.angleMode);
            });
            this.render();
            break;

          case 'clear-all':
            this.expression = '';
            this.lastError = '';
            this.render();
            break;

          case 'backspace':
            this.expression = this.expression.slice(0, -1);
            this.lastError = '';
            this.render();
            break;

          case 'evaluate':
            this.evaluateScientific();
            break;

          case 'mem': {
            const m = btn.dataset.mem;
            const currentVal = this.lastResult;
            if (m === 'MC') this.memory = 0;
            else if (m === 'MR') { this.expression += this.engine.formatNumber(this.memory); }
            else if (m === 'MS') this.memory = currentVal;
            else if (m === 'M+') this.memory += currentVal;
            else if (m === 'M-') this.memory -= currentVal;
            this.storage.set('memory', this.memory);
            this.render();
            break;
          }

          case 'clear-history':
            this.history = [];
            this.storage.set('history', []);
            this.render();
            break;

          case 'recall-history': {
            const idx = parseInt(btn.dataset.idx, 10);
            if (this.history[idx]) {
              this.expression = this.history[idx].expr;
              this.render();
            }
            break;
          }

          case 'send-to-graph': {
            const expr = this.expression.trim() || 'sin(x)';
            if (this.curves.length > 0) {
              this.curves[0].expr = expr;
              this.curves[0].visible = true;
            }
            this.storage.set('curves', this.curves);
            this.switchTab('graph');
            break;
          }

          // Programmer actions
          case 'prog-base':
            this.progBase = parseInt(btn.dataset.base, 10) || 10;
            this.storage.set('progBase', this.progBase);
            this.progFreshInput = true;
            this.render();
            break;

          case 'prog-bits':
            this.progBits = parseInt(btn.dataset.bits, 10) || 32;
            this.progValue = this.engine.programmer.maskBits(this.progValue, this.progBits);
            this.storage.set('progBits', this.progBits);
            this.render();
            break;

          case 'prog-signed':
            this.progSigned = !this.progSigned;
            this.storage.set('progSigned', this.progSigned);
            this.render();
            break;

          case 'toggle-bit': {
            const b = BigInt(parseInt(btn.dataset.bit, 10));
            this.progValue = this.engine.programmer.maskBits(this.progValue ^ (1n << b), this.progBits);
            this.progFreshInput = false;
            this.render();
            break;
          }

          case 'prog-digit':
            this.handleProgDigit(btn.dataset.digit);
            break;

          case 'prog-op':
            this.handleProgOp(btn.dataset.op);
            break;

          case 'prog-unary': {
            const p = this.engine.programmer;
            if (btn.dataset.op === 'NOT') {
              this.progValue = p.bitwiseOp('NOT', this.progValue, 0n, this.progBits, this.progSigned);
            } else if (btn.dataset.op === 'NEG') {
              this.progValue = p.maskBits(-this.progValue, this.progBits);
            }
            this.render();
            break;
          }

          case 'prog-eval':
            this.handleProgEval();
            break;

          case 'prog-clear':
            this.progValue = 0n;
            this.progAccumulator = null;
            this.progPendingOp = null;
            this.progFreshInput = true;
            this.progError = '';
            this.render();
            break;

          case 'prog-backspace':
            this.progValue = this.engine.programmer.maskBits(this.progValue / BigInt(this.progBase), this.progBits);
            this.render();
            break;

          case 'prog-copy': {
            const txt = this.engine.programmer.formatBase(this.progValue, this.progBase, this.progBits, this.progSigned);
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(() => this.toast.success(this.t('calc.copied_toast')));
            }
            break;
          }

          // Graph actions
          case 'add-curve': {
            if (this.curves.length >= 6) return;
            const n = this.curves.length;
            this.curves.push({
              id: `c${Date.now()}`,
              label: CURVE_LABELS[n] || `f${n + 1}`,
              expr: '',
              color: CURVE_COLORS[n % CURVE_COLORS.length],
              visible: true
            });
            this.storage.set('curves', this.curves);
            this.render();
            break;
          }

          case 'remove-curve': {
            const idx = parseInt(btn.dataset.idx, 10);
            if (this.curves.length > 1 && idx >= 0) {
              this.curves.splice(idx, 1);
              this.storage.set('curves', this.curves);
              this.render();
            }
            break;
          }

          case 'toggle-curve': {
            const idx = parseInt(btn.dataset.idx, 10);
            if (this.curves[idx]) {
              this.curves[idx].visible = this.curves[idx].visible === false;
              this.storage.set('curves', this.curves);
              this.render();
            }
            break;
          }

          case 'preset': {
            const preset = btn.dataset.preset;
            if (preset === 'trig') {
              this.curves = [
                { id: 'c1', label: 'f', expr: 'sin(x)', color: CURVE_COLORS[0], visible: true },
                { id: 'c2', label: 'g', expr: 'cos(x)', color: CURVE_COLORS[1], visible: true }
              ];
            } else if (preset === 'poly') {
              this.curves = [
                { id: 'c1', label: 'f', expr: 'x^3 - 3*x', color: CURVE_COLORS[0], visible: true },
                { id: 'c2', label: 'g', expr: '3*x^2 - 3', color: CURVE_COLORS[2], visible: true }
              ];
            } else if (preset === 'damped') {
              this.curves = [
                { id: 'c1', label: 'f', expr: 'exp(-x^2/8)*cos(3*x)', color: CURVE_COLORS[4], visible: true },
                { id: 'c2', label: 'g', expr: 'exp(-x^2/8)', color: CURVE_COLORS[3], visible: true }
              ];
            } else if (preset === 'hyperbola') {
              this.curves = [
                { id: 'c1', label: 'f', expr: '1/x', color: CURVE_COLORS[1], visible: true },
                { id: 'c2', label: 'g', expr: 'x', color: CURVE_COLORS[0], visible: true }
              ];
            }
            this.storage.set('curves', this.curves);
            this.render();
            break;
          }

          case 'zoom-in':
            if (this.plotter) this.plotter.zoom(0.75);
            break;

          case 'zoom-out':
            if (this.plotter) this.plotter.zoom(1.33);
            break;

          case 'zoom-reset':
            if (this.plotter) this.plotter.resetViewport();
            break;

          case 'toggle-table':
            this.showTable = !this.showTable;
            this.render();
            break;

          case 'focus-point': {
            const px = parseFloat(btn.dataset.px);
            const py = parseFloat(btn.dataset.py);
            if (this.plotter && Number.isFinite(px) && Number.isFinite(py)) {
              this.plotter.centerOn(px, py);
            }
            break;
          }

          case 'export-download':
            this.exportGraphDownload();
            break;

          case 'export-gallery':
            this.exportGraphToGallery();
            break;
        }
      };

      // Value table parameter changes
      container.onchange = (e) => {
        const target = e.target;
        if (!target) return;
        if (target.id === 'gcalcTableCurve') {
          this.tableCurveId = target.value;
          this.renderAnalysisBody();
        } else if (target.id === 'gcalcTableStart') {
          this.tableStart = parseFloat(target.value) || -5;
          this.renderAnalysisBody();
        } else if (target.id === 'gcalcTableEnd') {
          this.tableEnd = parseFloat(target.value) || 5;
          this.renderAnalysisBody();
        } else if (target.id === 'gcalcTableStep') {
          this.tableStep = Math.max(0.05, parseFloat(target.value) || 1);
          this.renderAnalysisBody();
        }
      };
    }

    attachKeyboard() {
      if (this._keydownHandler) return;
      this._keydownHandler = (e) => {
        if (!this.window || !window.WindowManager) return;
        const activeWin = window.WindowManager.activeWindowId;
        if (activeWin && activeWin !== this.window.id) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (this.currentTab === 'scientific') {
          if (/^[0-9.+\-*/^()%!]$/.test(e.key)) {
            e.preventDefault();
            this.expression += e.key;
            this.render();
          } else if (e.key === 'Enter' || e.key === '=') {
            e.preventDefault();
            this.evaluateScientific();
          } else if (e.key === 'Backspace') {
            e.preventDefault();
            this.expression = this.expression.slice(0, -1);
            this.render();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.expression = '';
            this.lastError = '';
            this.render();
          }
        } else if (this.currentTab === 'programmer') {
          const upper = e.key.toUpperCase();
          if (/^[0-9A-F]$/.test(upper)) {
            e.preventDefault();
            this.handleProgDigit(upper);
          } else if (e.key === 'Enter' || e.key === '=') {
            e.preventDefault();
            this.handleProgEval();
          } else if (e.key === 'Backspace') {
            e.preventDefault();
            this.progValue = this.engine.programmer.maskBits(this.progValue / BigInt(this.progBase), this.progBits);
            this.render();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.progValue = 0n;
            this.progAccumulator = null;
            this.progPendingOp = null;
            this.progFreshInput = true;
            this.render();
          }
        }
      };
      document.addEventListener('keydown', this._keydownHandler);
    }

    detachKeyboard() {
      if (this._keydownHandler) {
        document.removeEventListener('keydown', this._keydownHandler);
        this._keydownHandler = null;
      }
    }
  }

  const instance = new GraphingCalcApp();
  window.GraphingCalcApp = instance;
  if (window.AppManager && typeof window.AppManager.register === 'function') {
    window.AppManager.register(instance);
  }
})(window, document);
