/**
 * SimpleGallery WebOS - Interactive Canvas 2D Function Plotter
 * Supports multi-curve plotting, adaptive 1-2-5 grid, pan/zoom, live trace crosshair,
 * automatic display of roots, local extrema & intersections, and high-res PNG export.
 */
(function (window) {
  'use strict';

  const NICE_STEPS = [1, 2, 5];

  function computeNiceStep(range, targetTicks = 10) {
    if (!(range > 0) || !Number.isFinite(range)) return 1;
    const rough = range / targetTicks;
    const exp = Math.floor(Math.log10(rough));
    const mag = Math.pow(10, exp);
    const norm = rough / mag;
    for (const s of NICE_STEPS) {
      if (norm <= s * 1.45) return s * mag;
    }
    return 10 * mag;
  }

  function formatTickLabel(val) {
    if (Math.abs(val) < 1e-12) return '0';
    const abs = Math.abs(val);
    if (abs >= 1e5 || abs < 1e-3) {
      return val.toExponential(1).replace(/\.0e/, 'e');
    }
    return String(Number(val.toPrecision(6)));
  }

  class GraphingCalcPlotter {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext('2d') : null;
      this.engine = options.engine || window.GraphingCalcEngine;

      // World viewport bounds
      this.xMin = options.xMin ?? -10;
      this.xMax = options.xMax ?? 10;
      this.yMin = options.yMin ?? -6.5;
      this.yMax = options.yMax ?? 6.5;

      this.angleMode = options.angleMode || 'RAD';
      this.curves = [];
      this.analysis = { roots: [], extrema: [], intersections: [] };
      this.showRoots = true;
      this.showExtrema = true;
      this.showIntersections = true;
      this.showGrid = true;

      // Interaction state
      this.isDragging = false;
      this.dragStart = null;
      this.dragBounds = null;
      this.pointerPx = null;
      this.onTrace = typeof options.onTrace === 'function' ? options.onTrace : null;
      this.onViewportChange = typeof options.onViewportChange === 'function' ? options.onViewportChange : null;

      this._boundHandlers = null;
      if (this.canvas) {
        this.bindPointerEvents();
      }
    }

    getPalette() {
      const rootStyle = typeof getComputedStyle === 'function' && typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement)
        : null;
      const bg = rootStyle ? (rootStyle.getPropertyValue('--bg-main') || '').trim() : '';
      const isLight = typeof document !== 'undefined' &&
        (document.body?.getAttribute('data-theme') === 'light' ||
          document.documentElement?.getAttribute('data-theme') === 'light');

      return isLight ? {
        bg: '#f8fafc',
        gridMinor: 'rgba(15, 23, 42, 0.05)',
        gridMajor: 'rgba(15, 23, 42, 0.12)',
        axis: 'rgba(15, 23, 42, 0.55)',
        label: '#334155',
        crosshair: 'rgba(99, 102, 241, 0.55)',
        tooltipBg: 'rgba(255, 255, 255, 0.94)',
        tooltipBorder: 'rgba(15, 23, 42, 0.18)',
        tooltipText: '#0f172a'
      } : {
        bg: bg || '#0b1020',
        gridMinor: 'rgba(148, 163, 184, 0.06)',
        gridMajor: 'rgba(148, 163, 184, 0.14)',
        axis: 'rgba(226, 232, 240, 0.55)',
        label: '#94a3b8',
        crosshair: 'rgba(129, 140, 248, 0.65)',
        tooltipBg: 'rgba(15, 23, 42, 0.92)',
        tooltipBorder: 'rgba(148, 163, 184, 0.28)',
        tooltipText: '#f1f5f9'
      };
    }

    worldToPxX(wx, width) {
      return ((wx - this.xMin) / (this.xMax - this.xMin)) * width;
    }

    worldToPxY(wy, height) {
      return height - ((wy - this.yMin) / (this.yMax - this.yMin)) * height;
    }

    pxToWorldX(px, width) {
      return this.xMin + (px / width) * (this.xMax - this.xMin);
    }

    pxToWorldY(py, height) {
      return this.yMin + ((height - py) / height) * (this.yMax - this.yMin);
    }

    setCurves(curves, angleMode = 'RAD') {
      this.angleMode = angleMode;
      this.curves = (curves || []).map(c => {
        let compiled = null;
        let error = null;
        if (c.expr && c.expr.trim()) {
          try {
            const rawFn = this.engine.compile(c.expr);
            compiled = (x) => rawFn({ x }, this.angleMode);
          } catch (e) {
            error = e.message;
          }
        }
        return { ...c, compiled, error };
      });
      this.recomputeAnalysis();
      this.render();
      return this.curves;
    }

    recomputeAnalysis() {
      const roots = [];
      const extrema = [];
      const intersections = [];

      const activeCurves = this.curves.filter(c => c.visible !== false && typeof c.compiled === 'function');

      for (const c of activeCurves) {
        if (this.showRoots) {
          const rList = this.engine.findRoots(c.compiled, this.xMin, this.xMax, 360);
          rList.forEach(pt => roots.push({ ...pt, curveId: c.id, label: c.label, color: c.color }));
        }
        if (this.showExtrema) {
          const eList = this.engine.findExtrema(c.compiled, this.xMin, this.xMax, 360);
          eList.forEach(pt => extrema.push({ ...pt, curveId: c.id, label: c.label, color: c.color }));
        }
      }

      if (this.showIntersections && activeCurves.length >= 2) {
        for (let i = 0; i < activeCurves.length; i++) {
          for (let j = i + 1; j < activeCurves.length; j++) {
            const cA = activeCurves[i];
            const cB = activeCurves[j];
            const pts = this.engine.findIntersections(cA.compiled, cB.compiled, this.xMin, this.xMax, 320);
            pts.forEach(pt => intersections.push({
              ...pt,
              curveA: cA.label,
              curveB: cB.label
            }));
          }
        }
      }

      this.analysis = { roots, extrema, intersections };
      return this.analysis;
    }

    setViewport(xMin, xMax, yMin, yMax) {
      if (!(xMax > xMin) || !(yMax > yMin)) return;
      this.xMin = xMin;
      this.xMax = xMax;
      this.yMin = yMin;
      this.yMax = yMax;
      this.recomputeAnalysis();
      this.render();
      if (this.onViewportChange) this.onViewportChange(this.getViewport());
    }

    getViewport() {
      return { xMin: this.xMin, xMax: this.xMax, yMin: this.yMin, yMax: this.yMax };
    }

    resetViewport() {
      this.setViewport(-10, 10, -6.5, 6.5);
    }

    centerOn(wx, wy) {
      const halfW = (this.xMax - this.xMin) * 0.5;
      const halfH = (this.yMax - this.yMin) * 0.5;
      this.setViewport(wx - halfW, wx + halfW, wy - halfH, wy + halfH);
    }

    zoom(factor, centerWx = null, centerWy = null) {
      const cx = centerWx !== null ? centerWx : (this.xMin + this.xMax) * 0.5;
      const cy = centerWy !== null ? centerWy : (this.yMin + this.yMax) * 0.5;
      const newXMin = cx - (cx - this.xMin) * factor;
      const newXMax = cx + (this.xMax - cx) * factor;
      const newYMin = cy - (cy - this.yMin) * factor;
      const newYMax = cy + (this.yMax - cy) * factor;
      // Guard against excessive zoom limits
      const spanX = newXMax - newXMin;
      if (spanX < 1e-6 || spanX > 1e8) return;
      this.setViewport(newXMin, newXMax, newYMin, newYMax);
    }

    bindPointerEvents() {
      if (!this.canvas || this._boundHandlers) return;

      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        const rect = this.canvas.getBoundingClientRect();
        this.isDragging = true;
        this.dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.dragBounds = this.getViewport();
        this.canvas.style.cursor = 'grabbing';
      };

      const onMouseMove = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;

        if (this.isDragging && this.dragStart && this.dragBounds) {
          const dxPx = px - this.dragStart.x;
          const dyPx = py - this.dragStart.y;
          const w = rect.width || 1;
          const h = rect.height || 1;
          const dxW = (dxPx / w) * (this.dragBounds.xMax - this.dragBounds.xMin);
          const dyW = (dyPx / h) * (this.dragBounds.yMax - this.dragBounds.yMin);
          this.xMin = this.dragBounds.xMin - dxW;
          this.xMax = this.dragBounds.xMax - dxW;
          this.yMin = this.dragBounds.yMin + dyW;
          this.yMax = this.dragBounds.yMax + dyW;
          this.render();
          return;
        }

        this.pointerPx = { x: px, y: py };
        this.render();
        if (this.onTrace) {
          const wx = this.pxToWorldX(px, rect.width || 1);
          const wy = this.pxToWorldY(py, rect.height || 1);
          const values = this.curves
            .filter(c => c.visible !== false && typeof c.compiled === 'function')
            .map(c => {
              let y = NaN;
              let dy = NaN;
              try {
                y = c.compiled(wx);
                dy = this.engine.derivative(c.compiled, wx);
              } catch (err) { /* ignore */ }
              return { id: c.id, label: c.label, color: c.color, y, dy };
            });
          this.onTrace({ x: wx, y: wy, values });
        }
      };

      const onMouseUp = () => {
        if (this.isDragging) {
          this.isDragging = false;
          this.dragStart = null;
          this.dragBounds = null;
          this.canvas.style.cursor = 'crosshair';
          this.recomputeAnalysis();
          this.render();
          if (this.onViewportChange) this.onViewportChange(this.getViewport());
        }
      };

      const onMouseLeave = () => {
        this.pointerPx = null;
        if (this.isDragging) onMouseUp();
        else this.render();
      };

      const onWheel = (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const wx = this.pxToWorldX(px, rect.width || 1);
        const wy = this.pxToWorldY(py, rect.height || 1);
        const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        this.zoom(factor, wx, wy);
      };

      this.canvas.style.cursor = 'crosshair';
      this.canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      this.canvas.addEventListener('mouseleave', onMouseLeave);
      this.canvas.addEventListener('wheel', onWheel, { passive: false });

      this._boundHandlers = { onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onWheel };
    }

    destroy() {
      if (this.canvas && this._boundHandlers) {
        this.canvas.removeEventListener('mousedown', this._boundHandlers.onMouseDown);
        window.removeEventListener('mousemove', this._boundHandlers.onMouseMove);
        window.removeEventListener('mouseup', this._boundHandlers.onMouseUp);
        this.canvas.removeEventListener('mouseleave', this._boundHandlers.onMouseLeave);
        this.canvas.removeEventListener('wheel', this._boundHandlers.onWheel);
        this._boundHandlers = null;
      }
    }

    resize() {
      if (!this.canvas) return { width: 640, height: 420 };
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(200, Math.floor(rect.width || 640));
      const height = Math.max(180, Math.floor(rect.height || 400));
      const dpr = window.devicePixelRatio || 1;
      if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
        this.canvas.width = Math.floor(width * dpr);
        this.canvas.height = Math.floor(height * dpr);
      }
      if (this.ctx) {
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return { width, height };
    }

    renderToContext(ctx, width, height, options = {}) {
      const pal = this.getPalette();
      const showLegend = !!options.showLegend;

      // 1. Background
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, width, height);

      // 2. Adaptive Grid & Axes
      const stepX = computeNiceStep(this.xMax - this.xMin, Math.max(6, Math.floor(width / 75)));
      const stepY = computeNiceStep(this.yMax - this.yMin, Math.max(5, Math.floor(height / 65)));

      if (this.showGrid) {
        // Minor grid (half step)
        ctx.strokeStyle = pal.gridMinor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const minorX = stepX * 0.5;
        const minorY = stepY * 0.5;
        for (let x = Math.floor(this.xMin / minorX) * minorX; x <= this.xMax; x += minorX) {
          const px = Math.round(this.worldToPxX(x, width)) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, height);
        }
        for (let y = Math.floor(this.yMin / minorY) * minorY; y <= this.yMax; y += minorY) {
          const py = Math.round(this.worldToPxY(y, height)) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(width, py);
        }
        ctx.stroke();

        // Major grid
        ctx.strokeStyle = pal.gridMajor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.floor(this.xMin / stepX) * stepX; x <= this.xMax; x += stepX) {
          const px = Math.round(this.worldToPxX(x, width)) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, height);
        }
        for (let y = Math.floor(this.yMin / stepY) * stepY; y <= this.yMax; y += stepY) {
          const py = Math.round(this.worldToPxY(y, height)) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(width, py);
        }
        ctx.stroke();
      }

      // Main X / Y axes
      const axisXPy = this.worldToPxY(0, height);
      const axisYPx = this.worldToPxX(0, width);
      ctx.strokeStyle = pal.axis;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (axisXPy >= 0 && axisXPy <= height) {
        ctx.moveTo(0, Math.round(axisXPy) + 0.5);
        ctx.lineTo(width, Math.round(axisXPy) + 0.5);
      }
      if (axisYPx >= 0 && axisYPx <= width) {
        ctx.moveTo(Math.round(axisYPx) + 0.5, 0);
        ctx.lineTo(Math.round(axisYPx) + 0.5, height);
      }
      ctx.stroke();

      // Tick labels
      ctx.fillStyle = pal.label;
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const labelYPos = Math.min(Math.max(axisXPy + 14, 14), height - 6);
      const labelXPos = Math.min(Math.max(axisYPx + 6, 6), width - 48);

      ctx.textAlign = 'center';
      for (let x = Math.ceil(this.xMin / stepX) * stepX; x <= this.xMax; x += stepX) {
        if (Math.abs(x) < stepX * 1e-4) continue;
        const px = this.worldToPxX(x, width);
        if (px > 18 && px < width - 18) {
          ctx.fillText(formatTickLabel(x), px, labelYPos);
        }
      }

      ctx.textAlign = 'left';
      for (let y = Math.ceil(this.yMin / stepY) * stepY; y <= this.yMax; y += stepY) {
        if (Math.abs(y) < stepY * 1e-4) continue;
        const py = this.worldToPxY(y, height);
        if (py > 14 && py < height - 10) {
          ctx.fillText(formatTickLabel(y), labelXPos, py + 4);
        }
      }

      // 3. Plot Curves with discontinuity/asymptote clipping
      const sampleCount = Math.max(width * 2, 700);
      const ySpan = this.yMax - this.yMin;

      for (const curve of this.curves) {
        if (curve.visible === false || typeof curve.compiled !== 'function') continue;

        ctx.strokeStyle = curve.color || '#6366f1';
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        let penDown = false;
        let prevY = NaN;

        for (let i = 0; i <= sampleCount; i++) {
          const px = (i / sampleCount) * width;
          const wx = this.pxToWorldX(px, width);
          let wy = NaN;
          try { wy = curve.compiled(wx); } catch (e) { wy = NaN; }

          if (!Number.isFinite(wy) || Math.abs(wy) > ySpan * 200) {
            penDown = false;
            prevY = NaN;
            continue;
          }

          // Detect vertical asymptotes / jump discontinuities
          if (penDown && Number.isFinite(prevY) && Math.abs(wy - prevY) > ySpan * 1.4 && (wy * prevY < 0)) {
            penDown = false;
          }

          const py = this.worldToPxY(wy, height);
          if (!penDown) {
            ctx.moveTo(px, py);
            penDown = true;
          } else {
            ctx.lineTo(px, py);
          }
          prevY = wy;
        }
        ctx.stroke();
      }

      // 4. Special Points (Roots, Extrema, Intersections)
      if (this.showRoots) {
        for (const r of this.analysis.roots) {
          const px = this.worldToPxX(r.x, width);
          const py = this.worldToPxY(r.y, height);
          if (px < -10 || px > width + 10 || py < -10 || py > height + 10) continue;
          ctx.fillStyle = '#22c55e';
          ctx.strokeStyle = pal.bg;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      if (this.showExtrema) {
        for (const ex of this.analysis.extrema) {
          const px = this.worldToPxX(ex.x, width);
          const py = this.worldToPxY(ex.y, height);
          if (px < -10 || px > width + 10 || py < -10 || py > height + 10) continue;
          ctx.fillStyle = '#f59e0b';
          ctx.strokeStyle = pal.bg;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          const dir = ex.kind === 'max' ? -1 : 1;
          ctx.moveTo(px, py + dir * 5.5);
          ctx.lineTo(px - 5, py - dir * 4);
          ctx.lineTo(px + 5, py - dir * 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      if (this.showIntersections) {
        for (const pt of this.analysis.intersections) {
          const px = this.worldToPxX(pt.x, width);
          const py = this.worldToPxY(pt.y, height);
          if (px < -10 || px > width + 10 || py < -10 || py > height + 10) continue;
          ctx.fillStyle = '#ec4899';
          ctx.strokeStyle = pal.bg;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(px, py - 5.5);
          ctx.lineTo(px + 5.5, py);
          ctx.lineTo(px, py + 5.5);
          ctx.lineTo(px - 5.5, py);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // 5. Interactive Trace Crosshair (live view only)
      if (!showLegend && this.pointerPx && !this.isDragging) {
        const { x: px, y: py } = this.pointerPx;
        ctx.save();
        ctx.strokeStyle = pal.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
        ctx.stroke();
        ctx.restore();

        const wx = this.pxToWorldX(px, width);
        for (const c of this.curves) {
          if (c.visible === false || typeof c.compiled !== 'function') continue;
          let wy = NaN;
          try { wy = c.compiled(wx); } catch (e) { wy = NaN; }
          if (Number.isFinite(wy)) {
            const cpy = this.worldToPxY(wy, height);
            if (cpy >= -20 && cpy <= height + 20) {
              ctx.fillStyle = c.color || '#6366f1';
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(px, cpy, 4.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }
        }
      }

      // 6. Legend Box (used for exported PNGs)
      if (showLegend) {
        const active = this.curves.filter(c => c.visible !== false && c.expr && c.expr.trim());
        if (active.length > 0) {
          const boxW = 240;
          const lineH = 20;
          const boxH = 16 + active.length * lineH;
          const bx = 14;
          const by = 14;
          ctx.fillStyle = pal.tooltipBg;
          ctx.strokeStyle = pal.tooltipBorder;
          ctx.lineWidth = 1;
          ctx.fillRect(bx, by, boxW, boxH);
          ctx.strokeRect(bx, by, boxW, boxH);

          ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'left';
          active.forEach((c, idx) => {
            const ly = by + 18 + idx * lineH;
            ctx.fillStyle = c.color || '#6366f1';
            ctx.fillRect(bx + 10, ly - 8, 12, 4);
            ctx.fillStyle = pal.tooltipText;
            const txt = `${c.label}(x) = ${c.expr}`.slice(0, 28);
            ctx.fillText(txt, bx + 28, ly);
          });
        }
      }
    }

    render() {
      if (!this.canvas || !this.ctx) return;
      const { width, height } = this.resize();
      this.renderToContext(this.ctx, width, height, { showLegend: false });
    }

    /**
     * Render a crisp high-resolution PNG Blob with legend for Download or Gallery Upload
     */
    toPngBlob(exportWidth = 1280, exportHeight = 800) {
      return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
          reject(new Error('DOM unavailable'));
          return;
        }
        const off = document.createElement('canvas');
        off.width = exportWidth;
        off.height = exportHeight;
        const ctx = off.getContext('2d');
        this.renderToContext(ctx, exportWidth, exportHeight, { showLegend: true });
        if (typeof off.toBlob === 'function') {
          off.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas PNG export failed'));
          }, 'image/png');
        } else {
          reject(new Error('toBlob unsupported'));
        }
      });
    }
  }

  window.GraphingCalcPlotter = GraphingCalcPlotter;
})(typeof window !== 'undefined' ? window : globalThis);
