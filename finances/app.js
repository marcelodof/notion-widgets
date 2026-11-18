(() => {
  'use strict';

  /* ---------- Config ---------- */

  const CONFIG = {
    // Apps Script web app URL. Normally passed with ?api= so it stays out of the public repo.
    apiUrl: '',
    defaultView: 'spend', // any key of VIEWS — overridable with ?view=
    defaultPeriod: 'all', // patrimony chart: 6, 12 or 'all' — overridable with ?period=
    maxYears: 4, // most recent years drawn in the spend chart
    refreshMinutes: 60,
    currencySymbol: '€',
    locale: 'de-DE', // number formatting
    dateLocale: 'en-GB', // month names and times
    requestTimeoutMs: 20000,
  };

  // kind: 'chart' = headline + line chart, 'bars' = category bars, 'stat' = headline only
  const VIEWS = {
    spend: { kind: 'chart', title: 'Spend per month' },
    breakdown: { kind: 'bars', title: 'Spend by category' },
    'average-spend': { kind: 'stat', title: 'Spending' },
    patrimony: { kind: 'chart', title: 'Patrimony' },
    'total-patrimony': { kind: 'stat', title: 'Patrimony' },
    'patrimony-growth': { kind: 'stat', title: 'Patrimony growth' },
  };

  const PERIODS = [
    { key: '6', months: 6, label: '6M', text: '6 months' },
    { key: '12', months: 12, label: '1Y', text: '1 year' },
    { key: 'all', months: Infinity, label: 'All', text: 'all time' },
  ];

  const BAR_ROW_PX = 20; // matches grid-template-rows of .bars
  const BAR_LABEL_MAX_SHARE = 0.36; // of a column, before category names are truncated
  const BAR_MIN_COL_PX = 190;
  const BAR_MAX_COLS = 3;

  const TICK_MIN_GAP_PX = 18; // vertical room one scale label needs
  const TICK_FONT_PX = 10; // matches .chart-tick
  const X_AXIS_PX = 12; // height reserved under the plot for the horizontal axis labels

  /* ---------- API ---------- */

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  async function fetchData(url) {
    // No custom headers: Apps Script web apps don't answer CORS preflight requests.
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsePayload(await res.json());
  }

  function parsePayload(data) {
    if (typeof data?.error === 'string') throw new Error(data.error);
    const spend = data?.spend;
    const patrimony = data?.patrimony;
    const shapeOk =
      Array.isArray(spend?.months) &&
      Array.isArray(spend?.years) &&
      Array.isArray(spend?.breakdown) &&
      Array.isArray(patrimony?.series);
    if (!shapeOk) throw new Error('Unexpected response');

    return {
      averageSpend: isNum(spend.average) ? spend.average : null,
      months: spend.months.map(String),
      years: spend.years
        .filter((y) => /^\d{4}$/.test(y?.year) && Array.isArray(y.values))
        .map((y) => ({ year: y.year, values: spend.months.map((_, i) => (isNum(y.values[i]) ? y.values[i] : null)) }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      breakdown: spend.breakdown
        .filter((b) => typeof b?.type === 'string' && b.type && isNum(b.value))
        .map((b) => ({ type: b.type, value: b.value })),
      totalPatrimony: isNum(patrimony.total) ? patrimony.total : null,
      averageGrowth: isNum(patrimony.averageGrowth) ? patrimony.averageGrowth : null,
      patrimony: patrimony.series
        .filter((p) => /^\d{4}-\d{2}$/.test(p?.month) && isNum(p.value))
        .map((p) => ({ month: p.month, value: p.value }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  /* ---------- Calculations ---------- */

  const pctChange = (from, to) => ((to - from) / Math.abs(from)) * 100;

  const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

  const currentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  // The sheet pre-fills months that haven't happened yet with 0, so 0 means "no data yet".
  function spendYears(data) {
    return data.years
      .map((y) => ({
        year: y.year,
        points: y.values.map((value, slot) => ({ slot, value })).filter((p) => p.value > 0),
      }))
      .filter((y) => y.points.length)
      .slice(-CONFIG.maxYears);
  }

  // Rows dated after the current month are projections or carried-forward values.
  const patrimonyToDate = (data) => data.patrimony.filter((p) => p.month <= currentMonth());

  const sortedBreakdown = (data) => data.breakdown.filter((b) => b.value > 0).sort((a, b) => b.value - a.value);

  // When not every category fits, the smallest ones are summed into a single row.
  function fitItems(items, capacity) {
    if (items.length <= capacity) return items;
    const rest = items.slice(Math.max(0, capacity - 1));
    const other = { type: `Other (${rest.length})`, value: rest.reduce((sum, b) => sum + b.value, 0) };
    return [...items.slice(0, Math.max(0, capacity - 1)), other];
  }

  // Round values inside [min, max] for the chart scale: the finest 1/2/2.5/5 step that gives at most maxTicks.
  function axisTicks(min, max, maxTicks) {
    if (!(max > min)) return [];
    for (let pow = 10 ** (Math.floor(Math.log10(max - min)) - 2); ; pow *= 10) {
      for (const mult of [1, 2, 2.5, 5]) {
        const step = mult * pow;
        const first = Math.ceil(min / step);
        const last = Math.floor(max / step);
        if (last - first + 1 <= maxTicks) {
          return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
        }
      }
    }
  }

  // Drops horizontal axis labels that would collide. Evenly spaced ticks keep every nth,
  // counted from the first; uneven ones keep the rightmost of each colliding pair.
  function thinTicks(ticks, xOf, widthOf, even) {
    const gap = 6;
    if (!ticks.length) return [];
    if (even) {
      const widest = Math.max(...ticks.map((t) => widthOf(t.label)));
      const spacing = ticks.length > 1 ? xOf(ticks[1].slot) - xOf(ticks[0].slot) : Infinity;
      const needed = Math.ceil((widest + gap) / spacing);
      const stride = [1, 2, 3, 4, 6, 12].find((n) => n >= needed) ?? needed;
      return ticks.filter((_, i) => i % stride === 0);
    }
    const kept = [];
    for (const tick of [...ticks].reverse()) {
      const next = kept.at(-1);
      const room = next ? xOf(next.slot) - xOf(tick.slot) : Infinity;
      if (room >= (widthOf(next?.label ?? '') + widthOf(tick.label)) / 2 + gap) kept.push(tick);
    }
    return kept;
  }

  /* ---------- Formatting ---------- */

  const fmtNumber = (value) =>
    value.toLocaleString(CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtMoney = (value) => `${value < 0 ? '−' : ''}${CONFIG.currencySymbol}${fmtNumber(Math.abs(value))}`;

  const fmtSignedMoney = (value) => (value > 0 ? `+${fmtMoney(value)}` : fmtMoney(value));

  // Short form for the chart scale: €500, €2k, €2,5k
  function fmtCompact(value) {
    const thousands = Math.abs(value) >= 1000;
    const number = (thousands ? value / 1000 : value).toLocaleString(CONFIG.locale, { maximumFractionDigits: 1 });
    return `${CONFIG.currencySymbol}${number}${thousands ? 'k' : ''}`;
  }

  const fmtPct = (pct) => `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${fmtNumber(Math.abs(pct))}%`;

  // "2024-01" → "Jan 2024"
  const fmtMonth = (key) =>
    new Date(`${key}-01T00:00:00Z`).toLocaleDateString(CONFIG.dateLocale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

  function fmtLoadedAt(time) {
    const date = new Date(time);
    const clock = date.toLocaleTimeString(CONFIG.dateLocale, { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === new Date().toDateString()) return clock;
    return `${date.toLocaleDateString(CONFIG.dateLocale, { day: 'numeric', month: 'short' })}, ${clock}`;
  }

  const trendClass = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : '');

  /* ---------- State ---------- */

  const params = new URLSearchParams(location.search);
  // Also accepted after "#", which browsers never send to the server hosting the page.
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const param = (name) => params.get(name) ?? hashParams.get(name);

  function validUrl(value) {
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol) ? value : '';
    } catch {
      return '';
    }
  }

  const paramView = (param('view') || '').toLowerCase();
  const paramPeriod = (param('period') || '').toLowerCase();

  const state = {
    apiUrl: validUrl(param('api') || CONFIG.apiUrl),
    view: paramView in VIEWS ? paramView : CONFIG.defaultView,
    period: PERIODS.some((p) => p.key === paramPeriod) ? paramPeriod : String(CONFIG.defaultPeriod),
    year: param('year'), // spend chart; falls back to the latest year with data
    data: null,
    loadedAt: 0,
    loading: false,
    error: '',
    lastAttempt: 0,
    hoverIndex: null,
  };

  const view = () => VIEWS[state.view];

  async function refresh() {
    if (state.loading || !state.apiUrl) return;
    state.loading = true;
    state.lastAttempt = Date.now();
    render();

    try {
      state.data = await fetchData(state.apiUrl);
      state.loadedAt = Date.now();
      state.error = '';
    } catch (err) {
      state.error = err?.message || 'Request failed';
    }

    state.loading = false;
    render();
  }

  // What the line chart shows for the current view: the lines, the tabs above it and the idle readout.
  function chartModel() {
    const data = state.data;
    if (!data) return { slots: 0, lines: [], slotLabels: [], xTicks: [], tabs: [], idle: [], label: '' };

    if (state.view === 'spend') {
      const years = spendYears(data);
      const selected = years.some((y) => y.year === state.year) ? state.year : years.at(-1)?.year;
      const lines = years.map((y) => ({
        name: y.year,
        active: y.year === selected,
        pts: y.points.map((p) => ({ ...p, label: `${data.months[p.slot]} ${y.year}` })),
      }));
      const active = lines.find((l) => l.active);
      return {
        slots: data.months.length,
        lines,
        slotLabels: data.months,
        axis: true,
        xTicks: data.months.map((label, slot) => ({ slot, label })),
        evenTicks: true,
        tabs: years.map((y) => ({ key: y.year, label: y.year, text: `Highlight ${y.year}`, pressed: y.year === selected })),
        idle: active ? [span(fmtMoney(average(active.pts.map((p) => p.value)))), span(` avg in ${selected}`, 'note')] : [],
        label: active ? `Monthly spend in ${selected}, ${active.pts[0].label} to ${active.pts.at(-1).label}` : '',
      };
    }

    const period = PERIODS.find((p) => p.key === state.period);
    const all = patrimonyToDate(data);
    // One extra point, so "6 months" spans six month-to-month changes.
    const pts = (period.months === Infinity ? all : all.slice(-(period.months + 1))).map((p, slot) => ({
      slot,
      value: p.value,
      label: fmtMonth(p.month),
      year: p.month.slice(0, 4),
    }));
    const pct = pts.length >= 2 && pts[0].value !== 0 ? pctChange(pts[0].value, pts.at(-1).value) : null;
    const since = period.months === Infinity ? `since ${pts[0]?.label}` : `in ${period.text}`;
    return {
      slots: pts.length,
      lines: [{ name: 'Patrimony', active: true, pts }],
      slotLabels: pts.map((p) => p.label),
      // One label where each year starts, plus the year the range opens in.
      xTicks: pts.filter((p, i) => i === 0 || p.year !== pts[i - 1].year).map((p) => ({ slot: p.slot, label: p.year })),
      tabs: PERIODS.map((p) => ({ key: p.key, label: p.label, text: p.text, pressed: p.key === state.period })),
      idle: pct === null ? [] : [span(fmtPct(pct)), span(` ${since}`, 'note')],
      label: pts.length ? `Patrimony from ${pts[0].label} to ${pts.at(-1).label}` : '',
    };
  }

  // Headline figure and the line under it, per view.
  function figureModel() {
    const data = state.data;
    if (!data) return { label: '', value: null, meta: [] };

    const growth = data.averageGrowth;
    const growthMeta = growth === null ? [] : [span(fmtSignedMoney(growth), `strong ${trendClass(growth)}`), span(' avg / month')];

    if (state.view === 'patrimony' || state.view === 'total-patrimony') {
      return { label: 'Total patrimony', value: data.totalPatrimony, meta: growthMeta };
    }
    if (state.view === 'patrimony-growth') {
      return { label: 'Average growth / month', value: growth, signed: true, meta: [] };
    }

    const latestYear = spendYears(data).at(-1);
    const latest = latestYear?.points.at(-1);
    return {
      label: 'Average spend / month',
      value: data.averageSpend,
      meta: latest ? [span(`${data.months[latest.slot]} ${latestYear.year} · ${fmtMoney(latest.value)}`)] : [],
    };
  }

  /* ---------- Rendering ---------- */

  const $ = (id) => document.getElementById(id);
  const el = {
    card: $('card'),
    title: $('title'),
    headNote: $('head-note'),
    quote: $('quote'),
    figureLabel: $('figure-label'),
    figureValue: $('figure-value'),
    meta: $('meta'),
    history: $('history'),
    readout: $('readout'),
    tabs: $('tabs'),
    svg: $('chart-svg'),
    grid: $('chart-grid'),
    xAxis: $('chart-xaxis'),
    area: $('chart-area'),
    dim: $('chart-dim'),
    line: $('chart-line'),
    cursor: $('chart-cursor'),
    lastDot: $('chart-last'),
    dots: $('chart-dots'),
    tip: $('chart-tip'),
    chartEmpty: $('chart-empty'),
    breakdown: $('breakdown'),
    bars: $('bars'),
    status: $('status'),
  };

  // Sheet text is only ever inserted as text nodes, never as HTML.
  function span(text, className) {
    const node = document.createElement('span');
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  // Geometry of the drawn chart, kept for hit-testing on hover.
  let plot = null;

  const measure = document.createElement('canvas').getContext('2d');

  function render() {
    const kind = view().kind;
    el.card.setAttribute('aria-busy', String(state.loading));
    el.card.classList.toggle('is-empty', !state.data);
    el.title.textContent = view().title;

    el.quote.hidden = kind === 'bars';
    el.history.hidden = kind !== 'chart';
    el.breakdown.hidden = kind !== 'bars';

    renderFigure();
    if (kind === 'chart') renderChart();
    if (kind === 'bars') renderBars();
    renderStatus();
  }

  function renderFigure() {
    const figure = figureModel();
    el.figureLabel.textContent = figure.label;
    el.figureValue.textContent =
      figure.value === null ? '—' : figure.signed ? fmtSignedMoney(figure.value) : fmtMoney(figure.value);
    el.meta.replaceChildren(...figure.meta);
  }

  function renderTabs(tabs) {
    el.tabs.replaceChildren(
      ...tabs.map((tab) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.key = tab.key;
        btn.textContent = tab.label;
        btn.setAttribute('aria-label', tab.text);
        btn.setAttribute('aria-pressed', String(tab.pressed));
        return btn;
      })
    );
  }

  function renderChart() {
    // Tabs are rebuilt on every render; keep keyboard focus on the one that was pressed.
    const focusedKey = el.tabs.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const model = chartModel();
    renderTabs(model.tabs);
    if (focusedKey) [...el.tabs.children].find((btn) => btn.dataset.key === focusedKey)?.focus();

    const width = el.svg.clientWidth;
    const height = el.svg.clientHeight;
    const active = model.lines.find((l) => l.active);
    const enough = Boolean(active) && active.pts.length >= 2;
    const drawable = enough && width > 0 && height > 0;

    el.svg.style.visibility = drawable ? '' : 'hidden';
    el.chartEmpty.hidden = enough || !state.data;

    if (!drawable) {
      plot = null;
      el.tip.hidden = true;
      el.readout.replaceChildren();
      return;
    }

    const pad = { top: 8, right: 6, bottom: 8 + (model.xTicks.length ? X_AXIS_PX : 0), left: 2 };
    const values = model.lines.flatMap((l) => l.pts.map((p) => p.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const innerH = height - pad.top - pad.bottom;

    const maxTicks = Math.max(2, Math.min(5, Math.floor(innerH / TICK_MIN_GAP_PX)));
    const ticks = model.axis ? axisTicks(min, max, maxTicks) : [];
    const tickLabels = ticks.map(fmtCompact);
    // Room on the right for the scale labels (10px tabular digits are about 6px wide).
    if (ticks.length) pad.right = Math.max(...tickLabels.map((l) => l.length)) * 6 + 10;

    const innerW = width - pad.left - pad.right;
    const x = (slot) => pad.left + (slot / (model.slots - 1)) * innerW;
    const y = (value) => pad.top + (max === min ? 0.5 : 1 - (value - min) / (max - min)) * innerH;
    const pathOf = (pts) =>
      pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.slot).toFixed(1)} ${y(p.value).toFixed(1)}`).join('');

    // Hovering works per slot (a month), across every line that has a value there.
    const slots = [...new Set(model.lines.flatMap((l) => l.pts.map((p) => p.slot)))].sort((a, b) => a - b);
    plot = {
      slots,
      xs: slots.map(x),
      lines: model.lines.map((l) => ({
        name: l.name,
        active: l.active,
        bySlot: new Map(l.pts.map((p) => [p.slot, { ...p, y: y(p.value) }])),
      })),
      activeName: active.name,
      lastActiveSlot: active.pts.at(-1).slot,
      slotLabels: model.slotLabels,
      right: pad.left + innerW,
      bottom: height - pad.bottom + 8,
      idle: model.idle,
    };

    el.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.svg.setAttribute('aria-label', `${model.label}. Use arrow keys to inspect values.`);

    el.grid.replaceChildren(
      ...ticks.flatMap((tick, i) => {
        const ty = y(tick).toFixed(1);
        const text = svgEl('text', { class: 'chart-tick', x: width, y: ty });
        text.textContent = tickLabels[i];
        return [svgEl('line', { class: 'chart-grid', x1: pad.left, x2: pad.left + innerW, y1: ty, y2: ty }), text];
      })
    );

    measure.font = `${TICK_FONT_PX}px ${getComputedStyle(el.svg).fontFamily}`;
    el.xAxis.replaceChildren(
      ...thinTicks(model.xTicks, x, (text) => measure.measureText(text).width, model.evenTicks).map((tick) => {
        const text = svgEl('text', { class: 'chart-tick chart-tick-x', x: x(tick.slot).toFixed(1), y: height - 1 });
        text.textContent = tick.label;
        return text;
      })
    );

    el.dim.replaceChildren(
      ...model.lines
        .filter((l) => !l.active && l.pts.length >= 2)
        .map((l) => svgEl('path', { class: 'chart-line is-dim', d: pathOf(l.pts) }))
    );

    const path = pathOf(active.pts);
    const firstX = x(active.pts[0].slot);
    const lastX = x(active.pts.at(-1).slot);
    el.line.setAttribute('d', path);
    // An area fill only reads well under a single line.
    const single = model.lines.length === 1;
    el.area.toggleAttribute('hidden', !single);
    if (single) el.area.setAttribute('d', `${path}L${lastX.toFixed(1)} ${plot.bottom}L${firstX.toFixed(1)} ${plot.bottom}Z`);
    el.lastDot.setAttribute('cx', lastX);
    el.lastDot.setAttribute('cy', y(active.pts.at(-1).value));

    if (state.hoverIndex !== null) state.hoverIndex = Math.min(state.hoverIndex, slots.length - 1);
    renderHover();
  }

  function renderHover() {
    if (!plot) return;
    const i = state.hoverIndex;
    const hovering = i !== null;
    const comparing = plot.lines.length > 1;
    // SVG elements have no `hidden` property, only the attribute.
    el.cursor.toggleAttribute('hidden', !hovering);
    el.tip.hidden = !hovering || !comparing;

    if (!hovering) {
      el.dots.replaceChildren();
      el.readout.replaceChildren(...plot.idle.map((node) => node.cloneNode(true)));
      return;
    }

    const slot = plot.slots[i];
    const px = plot.xs[i];
    el.cursor.setAttribute('x1', px);
    el.cursor.setAttribute('x2', px);
    el.cursor.setAttribute('y1', 0);
    el.cursor.setAttribute('y2', plot.bottom);

    // Active line last, so its dot is drawn on top.
    el.dots.replaceChildren(
      ...plot.lines
        .filter((l) => l.bySlot.has(slot))
        .sort((a, b) => a.active - b.active)
        .map((l) =>
          svgEl('circle', {
            class: l.active ? 'chart-hover' : 'chart-hover is-dim',
            r: l.active ? 3.5 : 2.5,
            cx: px,
            cy: l.bySlot.get(slot).y,
          })
        )
    );

    const point = plot.lines.find((l) => l.active).bySlot.get(slot);
    el.readout.textContent = point
      ? `${fmtMoney(point.value)} · ${point.label}`
      : `${plot.slotLabels[slot]} · no data for ${plot.activeName}`;

    if (comparing) renderTip(slot, px);
  }

  // Every line's value at the hovered slot, beside the cursor.
  function renderTip(slot, px) {
    el.tip.replaceChildren(
      ...plot.lines.map((l) => {
        const row = document.createElement('div');
        const point = l.bySlot.get(slot);
        row.className = l.active ? 'tip-row is-active' : 'tip-row';
        row.append(span(l.name), span(point ? fmtMoney(point.value) : '—'));
        return row;
      })
    );
    const gap = 10;
    const tipW = el.tip.offsetWidth;
    // Flips to the left of the cursor rather than covering the scale.
    const left = px + gap + tipW <= plot.right ? px + gap : px - gap - tipW;
    el.tip.style.left = `${Math.max(0, left)}px`;
    el.tip.style.top = `${(plot.bottom - el.tip.offsetHeight) / 2}px`;
  }

  function renderBars() {
    const data = state.data;
    el.headNote.replaceChildren(
      ...(data && data.averageSpend !== null ? [span(fmtMoney(data.averageSpend)), span(' avg / month', 'note')] : [])
    );
    if (!data) {
      el.bars.replaceChildren();
      return;
    }

    const items = sortedBreakdown(data);
    const rows = Math.max(1, Math.floor(el.breakdown.clientHeight / BAR_ROW_PX));
    const maxCols = Math.max(1, Math.min(BAR_MAX_COLS, Math.floor(el.breakdown.clientWidth / BAR_MIN_COL_PX)));
    const cols = Math.max(1, Math.min(maxCols, Math.ceil(items.length / rows)));
    const shown = fitItems(items, rows * cols);
    const max = Math.max(...shown.map((b) => b.value), 0);
    const labels = shown.map((b) => fmtMoney(b.value));

    // Name and value columns are sized to their widest text, so the bars get the rest
    // and all start and end at the same x.
    const style = getComputedStyle(el.bars);
    measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const widest = (texts) => Math.ceil(Math.max(...texts.map((t) => measure.measureText(t).width), 0)) + 2;
    const colWidth = (el.breakdown.clientWidth - (cols - 1) * parseFloat(style.columnGap || 0)) / cols;

    el.bars.style.setProperty('--rows', Math.min(rows, shown.length || 1));
    el.bars.style.setProperty(
      '--label-w',
      `${Math.min(widest(shown.map((b) => b.type)), Math.floor(colWidth * BAR_LABEL_MAX_SHARE))}px`
    );
    el.bars.style.setProperty('--value-w', `${widest(labels)}px`);
    el.bars.replaceChildren(
      ...shown.map((b, i) => {
        const li = document.createElement('li');
        const track = span('', 'bar-track');
        const fill = span('', 'bar-fill');
        fill.style.width = `${max ? Math.max(1, (b.value / max) * 100) : 0}%`;
        track.setAttribute('aria-hidden', 'true');
        track.append(fill);
        li.append(span(b.type, 'bar-label'), track, span(labels[i], 'bar-value'));
        li.title = `${b.type} · ${labels[i]}`;
        return li;
      })
    );
  }

  function renderStatus() {
    el.status.title = state.error;
    if (!state.apiUrl) {
      el.status.textContent = 'Add ?api=<Apps Script URL> to the embed link.';
    } else if (!state.data) {
      el.status.textContent = state.loading ? 'Loading…' : 'Couldn’t load the sheet — check the script URL and its access.';
    } else if (state.error) {
      el.status.textContent = `Couldn’t refresh · showing data loaded ${fmtLoadedAt(state.loadedAt)}`;
    } else {
      el.status.textContent = `Google Sheets · loaded ${fmtLoadedAt(state.loadedAt)}`;
    }
  }

  /* ---------- Events ---------- */

  function setHover(index) {
    state.hoverIndex = index;
    renderHover();
  }

  function bindEvents() {
    $('refresh').addEventListener('click', refresh);

    el.tabs.addEventListener('click', (e) => {
      const key = e.target.closest('button')?.dataset.key;
      if (!key) return;
      if (state.view === 'spend') state.year = key;
      else state.period = key;
      state.hoverIndex = null;
      render();
    });

    const indexAt = (clientX) => {
      const x = clientX - el.svg.getBoundingClientRect().left;
      let nearest = 0;
      plot.xs.forEach((px, i) => {
        if (Math.abs(px - x) < Math.abs(plot.xs[nearest] - x)) nearest = i;
      });
      return nearest;
    };
    el.svg.addEventListener('pointermove', (e) => plot && setHover(indexAt(e.clientX)));
    el.svg.addEventListener('pointerdown', (e) => plot && setHover(indexAt(e.clientX)));
    el.svg.addEventListener('pointerleave', () => setHover(null));
    el.svg.addEventListener('focus', () => {
      if (plot && el.svg.matches(':focus-visible')) setHover(state.hoverIndex ?? plot.slots.indexOf(plot.lastActiveSlot));
    });
    el.svg.addEventListener('blur', () => setHover(null));
    el.svg.addEventListener('keydown', (e) => {
      if (!plot) return;
      const lastIndex = plot.slots.length - 1;
      const i = state.hoverIndex ?? plot.slots.indexOf(plot.lastActiveSlot);
      if (e.key === 'ArrowLeft') setHover(Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setHover(Math.min(lastIndex, i + 1));
      else if (e.key === 'Escape') setHover(null);
      else return;
      e.preventDefault();
    });

    new ResizeObserver(() => view().kind === 'chart' && renderChart()).observe(el.svg);
    new ResizeObserver(() => view().kind === 'bars' && renderBars()).observe(el.breakdown);

    const interval = CONFIG.refreshMinutes * 60000;
    setInterval(() => !document.hidden && refresh(), interval);
    // Timers are throttled in background tabs, so catch up when the page is shown again.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - state.lastAttempt >= interval) refresh();
    });
  }

  /* ---------- Init ---------- */

  if (param('theme') === 'light') document.documentElement.dataset.theme = 'light';
  el.card.dataset.view = state.view;

  bindEvents();
  render();
  refresh();
})();
