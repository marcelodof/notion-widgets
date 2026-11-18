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
  const BAR_MIN_COL_PX = 190;
  const BAR_MAX_COLS = 3;

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

  /* ---------- Formatting ---------- */

  const fmtNumber = (value) =>
    value.toLocaleString(CONFIG.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtMoney = (value) => `${value < 0 ? '−' : ''}${CONFIG.currencySymbol}${fmtNumber(Math.abs(value))}`;

  const fmtSignedMoney = (value) => (value > 0 ? `+${fmtMoney(value)}` : fmtMoney(value));

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
    if (!data) return { slots: 0, lines: [], tabs: [], idle: [], label: '' };

    if (state.view === 'spend') {
      const years = spendYears(data);
      const selected = years.some((y) => y.year === state.year) ? state.year : years.at(-1)?.year;
      const lines = years.map((y) => ({
        active: y.year === selected,
        pts: y.points.map((p) => ({ ...p, label: `${data.months[p.slot]} ${y.year}` })),
      }));
      const active = lines.find((l) => l.active);
      return {
        slots: data.months.length,
        lines,
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
    }));
    const pct = pts.length >= 2 && pts[0].value !== 0 ? pctChange(pts[0].value, pts.at(-1).value) : null;
    const since = period.months === Infinity ? `since ${pts[0]?.label}` : `in ${period.text}`;
    return {
      slots: pts.length,
      lines: [{ active: true, pts }],
      tabs: PERIODS.map((p) => ({ key: p.key, label: p.label, text: p.text, pressed: p.key === state.period })),
      idle: pct === null ? [] : [span(fmtPct(pct), trendClass(pct)), span(` ${since}`, 'note')],
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
    area: $('chart-area'),
    dim: $('chart-dim'),
    line: $('chart-line'),
    cursor: $('chart-cursor'),
    lastDot: $('chart-last'),
    hoverDot: $('chart-hover'),
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

  // Geometry of the drawn chart, kept for hit-testing on hover.
  let plot = null;

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
      el.readout.replaceChildren();
      return;
    }

    const pad = { top: 8, right: 6, bottom: 8, left: 2 };
    const values = model.lines.flatMap((l) => l.pts.map((p) => p.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const x = (p) => pad.left + (p.slot / (model.slots - 1)) * innerW;
    const y = (p) => pad.top + (max === min ? 0.5 : 1 - (p.value - min) / (max - min)) * innerH;
    const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p).toFixed(1)}`).join('');

    const xs = active.pts.map(x);
    const ys = active.pts.map(y);
    plot = { pts: active.pts, xs, ys, height, idle: model.idle };

    el.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.svg.setAttribute('aria-label', `${model.label}. Use arrow keys to inspect values.`);

    const ns = 'http://www.w3.org/2000/svg';
    el.dim.replaceChildren(
      ...model.lines
        .filter((l) => !l.active && l.pts.length >= 2)
        .map((l) => {
          const path = document.createElementNS(ns, 'path');
          path.setAttribute('class', 'chart-line is-dim');
          path.setAttribute('d', pathOf(l.pts));
          return path;
        })
    );

    const path = pathOf(active.pts);
    el.line.setAttribute('d', path);
    // An area fill only reads well under a single line.
    const single = model.lines.length === 1;
    el.area.toggleAttribute('hidden', !single);
    if (single) el.area.setAttribute('d', `${path}L${xs.at(-1).toFixed(1)} ${height}L${xs[0].toFixed(1)} ${height}Z`);
    el.lastDot.setAttribute('cx', xs.at(-1));
    el.lastDot.setAttribute('cy', ys.at(-1));

    if (state.hoverIndex !== null) state.hoverIndex = Math.min(state.hoverIndex, active.pts.length - 1);
    renderHover();
  }

  function renderHover() {
    if (!plot) return;
    const i = state.hoverIndex;
    const hovering = i !== null;
    // SVG elements have no `hidden` property, only the attribute.
    el.cursor.toggleAttribute('hidden', !hovering);
    el.hoverDot.toggleAttribute('hidden', !hovering);

    if (!hovering) {
      el.readout.replaceChildren(...plot.idle.map((node) => node.cloneNode(true)));
      return;
    }

    el.cursor.setAttribute('x1', plot.xs[i]);
    el.cursor.setAttribute('x2', plot.xs[i]);
    el.cursor.setAttribute('y1', 0);
    el.cursor.setAttribute('y2', plot.height);
    el.hoverDot.setAttribute('cx', plot.xs[i]);
    el.hoverDot.setAttribute('cy', plot.ys[i]);
    el.readout.textContent = `${fmtMoney(plot.pts[i].value)} · ${plot.pts[i].label}`;
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

    el.bars.style.setProperty('--rows', Math.min(rows, shown.length || 1));
    // One shared width for the value column, so every bar starts and ends at the same x.
    el.bars.style.setProperty('--value-ch', Math.max(...labels.map((l) => l.length), 1) + 0.5);
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
    el.svg.addEventListener('blur', () => setHover(null));
    el.svg.addEventListener('keydown', (e) => {
      if (!plot) return;
      const lastIndex = plot.pts.length - 1;
      const i = state.hoverIndex ?? lastIndex;
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
