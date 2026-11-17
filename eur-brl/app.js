(() => {
  'use strict';

  /* ---------- Config ---------- */

  const CONFIG = {
    defaultFrom: 'EUR', // 'EUR' or 'BRL' — overridable with ?from=
    defaultPeriod: 30, // 7, 30, 90 or 365 — overridable with ?period=
    refreshMinutes: 30,
    rateDecimals: 4,
    locale: 'en-GB',
    apiBase: 'https://api.frankfurter.dev/v1',
    requestTimeoutMs: 10000,
  };

  const CURRENCIES = {
    EUR: { flag: '🇪🇺', symbol: '€' },
    BRL: { flag: '🇧🇷', symbol: 'R$ ' },
  };

  const PERIODS = [
    { days: 7, label: '7D', text: '7 days' },
    { days: 30, label: '30D', text: '30 days' },
    { days: 90, label: '90D', text: '90 days' },
    { days: 365, label: '1Y', text: '1 year' },
  ];

  const DAY_MS = 86400000;

  /* ---------- API ---------- */
  // Rates are always requested as EUR→BRL; the reverse direction is derived by inversion.

  async function getJson(path) {
    const res = await fetch(`${CONFIG.apiBase}/${path}?base=EUR&symbols=BRL`, {
      // The API sends max-age=86400, which would pin a stale rate in a long-lived embed.
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const isRate = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  async function fetchLatest() {
    const data = await getJson('latest');
    const value = data?.rates?.BRL;
    if (!isDate(data?.date) || !isRate(value)) throw new Error('Unexpected response');
    return { date: data.date, value };
  }

  // Only trading days are returned, so the series has gaps for weekends and holidays.
  async function fetchSeries() {
    const start = new Date(Date.now() - 375 * DAY_MS).toISOString().slice(0, 10);
    const data = await getJson(`${start}..`);
    if (!data?.rates || typeof data.rates !== 'object') throw new Error('Unexpected response');
    return Object.entries(data.rates)
      .filter(([date, rates]) => isDate(date) && isRate(rates?.BRL))
      .map(([date, rates]) => ({ date, value: rates.BRL }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ---------- Calculations ---------- */

  const pctChange = (from, to) => ((to - from) / from) * 100;

  function sliceByDays(points, days) {
    if (!points.length) return [];
    const cutoff = new Date(Date.parse(points.at(-1).date) - days * DAY_MS).toISOString().slice(0, 10);
    return points.filter((p) => p.date >= cutoff);
  }

  // Accepts both "1234.56" and "1.234,56"
  function parseAmount(text) {
    let s = text.replace(/\s/g, '');
    if (s.includes(',')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    }
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    return Number(s);
  }

  /* ---------- Formatting ---------- */

  const fmtNumber = (value, decimals) =>
    value.toLocaleString(CONFIG.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const fmtMoney = (value, code, decimals = 2) => CURRENCIES[code].symbol + fmtNumber(value, decimals);

  const fmtPct = (pct) => `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${fmtNumber(Math.abs(pct), 2)}%`;

  function fmtDate(iso, withYear = true) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(CONFIG.locale, {
      day: 'numeric',
      month: 'short',
      year: withYear ? 'numeric' : undefined,
      timeZone: 'UTC',
    });
  }

  const trendClass = (pct) => (pct > 0 ? 'up' : pct < 0 ? 'down' : '');

  /* ---------- State ---------- */

  const params = new URLSearchParams(location.search);
  const paramFrom = (params.get('from') || '').toUpperCase();
  const paramPeriod = Number(params.get('period'));

  const state = {
    from: paramFrom in CURRENCIES ? paramFrom : CONFIG.defaultFrom,
    period: PERIODS.some((p) => p.days === paramPeriod) ? paramPeriod : CONFIG.defaultPeriod,
    latest: null, // { date, value } in EUR→BRL
    series: [], // trading-day observations in EUR→BRL, oldest first
    loading: false,
    failed: false,
    lastAttempt: 0,
    hoverIndex: null,
  };

  const to = () => (state.from === 'EUR' ? 'BRL' : 'EUR');

  // Observations in the selected direction, ending with the latest known rate.
  function points() {
    const pts = state.series.slice();
    if (state.latest && (!pts.length || state.latest.date > pts.at(-1).date)) pts.push(state.latest);
    return state.from === 'EUR' ? pts : pts.map((p) => ({ date: p.date, value: 1 / p.value }));
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    state.lastAttempt = Date.now();
    render();

    const [latest, series] = await Promise.allSettled([fetchLatest(), state.series.length ? null : fetchSeries()]);
    state.failed = latest.status === 'rejected';

    if (latest.status === 'fulfilled') state.latest = latest.value;
    if (series.status === 'fulfilled' && series.value) state.series = series.value;

    // A new trading day appeared since the history was loaded: reload it rather than
    // appending, since days may have been skipped while the tab was asleep.
    const last = state.series.at(-1);
    if (state.latest && last && state.latest.date > last.date && !series.value) {
      state.series = await fetchSeries().catch(() => []);
    }

    state.loading = false;
    render();
  }

  /* ---------- Rendering ---------- */

  const $ = (id) => document.getElementById(id);
  const el = {
    card: $('card'),
    pair: $('pair'),
    rateBase: $('rate-base'),
    rateValue: $('rate-value'),
    change: $('change'),
    changeRef: $('change-ref'),
    amount: $('amount'),
    amountLabel: $('amount-label'),
    amountPrefix: $('amount-prefix'),
    result: $('result'),
    readout: $('readout'),
    periods: $('periods'),
    svg: $('chart-svg'),
    area: $('chart-area'),
    line: $('chart-line'),
    cursor: $('chart-cursor'),
    lastDot: $('chart-last'),
    hoverDot: $('chart-hover'),
    chartEmpty: $('chart-empty'),
    status: $('status'),
  };

  // Geometry of the drawn chart, kept for hit-testing on hover.
  let plot = null;

  function render() {
    const pts = points();
    const current = pts.at(-1);
    const previous = pts.at(-2);

    el.card.setAttribute('aria-busy', String(state.loading));
    el.card.classList.toggle('is-empty', !current);

    renderHeader();
    renderRate(current, previous);
    renderConverter(current);
    renderChart(sliceByDays(pts, state.period));
    renderStatus(current);
  }

  function renderHeader() {
    const side = (code) => `<span>${CURRENCIES[code].flag} ${code}</span>`;
    el.pair.innerHTML = `${side(state.from)}<span class="arrow" aria-hidden="true">→</span>${side(to())}`;
    el.pair.setAttribute('aria-label', `${state.from} to ${to()}`);
  }

  function renderRate(current, previous) {
    el.rateBase.textContent = `${fmtMoney(1, state.from, 0)} =`;
    el.rateValue.textContent = current ? fmtMoney(current.value, to(), CONFIG.rateDecimals) : '—';

    if (!current || !previous) {
      el.change.textContent = '';
      el.changeRef.textContent = '';
      return;
    }
    const pct = pctChange(previous.value, current.value);
    el.change.textContent = fmtPct(pct);
    el.change.className = `change ${trendClass(pct)}`;
    el.changeRef.textContent = `vs ${fmtDate(previous.date, false)}`;
    el.changeRef.title = `Previous available trading day: ${fmtDate(previous.date)}`;
  }

  function renderConverter(current) {
    el.amountPrefix.textContent = CURRENCIES[state.from].symbol.trim();
    el.amountLabel.textContent = `Amount in ${state.from}`;
    const amount = parseAmount(el.amount.value);
    el.result.textContent = current && amount !== null ? fmtMoney(amount * current.value, to()) : '—';
  }

  function renderStatus(current) {
    if (!current) {
      el.status.textContent = state.loading ? 'Loading rates…' : 'Couldn’t load rates — try refreshing.';
      return;
    }
    const date = fmtDate(current.date);
    el.status.textContent = state.failed
      ? `Couldn’t refresh · showing reference rate of ${date}`
      : `Reference rate · ${date}`;
    el.status.title = 'Daily reference rate from frankfurter.dev — not a real-time market rate.';
  }

  function renderPeriods() {
    el.periods.innerHTML = PERIODS.map(
      (p) => `<button type="button" data-days="${p.days}" aria-label="${p.text}">${p.label}</button>`
    ).join('');
  }

  function renderChart(pts) {
    for (const btn of el.periods.children) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.days) === state.period));
    }

    const width = el.svg.clientWidth;
    const height = el.svg.clientHeight;
    const drawable = pts.length >= 2 && width > 0 && height > 0;

    el.svg.style.visibility = drawable ? '' : 'hidden';
    el.chartEmpty.hidden = pts.length >= 2 || state.loading;
    el.chartEmpty.textContent = 'History unavailable';

    if (!drawable) {
      plot = null;
      el.readout.textContent = '';
      return;
    }

    const pad = { top: 8, right: 6, bottom: 8, left: 2 };
    const values = pts.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    // Evenly spaced by observation, so weekends and holidays don't draw flat segments.
    const xs = pts.map((_, i) => pad.left + (i / (pts.length - 1)) * innerW);
    const ys = pts.map((p) => pad.top + (max === min ? 0.5 : 1 - (p.value - min) / span) * innerH);
    plot = { pts, xs, ys, pad, innerW, height };

    const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join('');
    el.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el.line.setAttribute('d', path);
    el.area.setAttribute('d', `${path}L${xs.at(-1).toFixed(1)} ${height}L${xs[0].toFixed(1)} ${height}Z`);
    el.lastDot.setAttribute('cx', xs.at(-1));
    el.lastDot.setAttribute('cy', ys.at(-1));

    const period = PERIODS.find((p) => p.days === state.period);
    el.svg.setAttribute(
      'aria-label',
      `${state.from} to ${to()} over the last ${period.text}: from ${fmtNumber(pts[0].value, CONFIG.rateDecimals)} ` +
        `to ${fmtNumber(pts.at(-1).value, CONFIG.rateDecimals)}. Use arrow keys to inspect values.`
    );

    if (state.hoverIndex !== null) state.hoverIndex = Math.min(state.hoverIndex, pts.length - 1);
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
      const pct = pctChange(plot.pts[0].value, plot.pts.at(-1).value);
      const period = PERIODS.find((p) => p.days === state.period);
      el.readout.innerHTML = `<span class="${trendClass(pct)}">${fmtPct(pct)}</span> <span class="readout-note">in ${period.text}</span>`;
      return;
    }

    const x = plot.xs[i];
    el.cursor.setAttribute('x1', x);
    el.cursor.setAttribute('x2', x);
    el.cursor.setAttribute('y1', 0);
    el.cursor.setAttribute('y2', plot.height);
    el.hoverDot.setAttribute('cx', x);
    el.hoverDot.setAttribute('cy', plot.ys[i]);
    el.readout.textContent = `${fmtMoney(plot.pts[i].value, to(), CONFIG.rateDecimals)} · ${fmtDate(plot.pts[i].date, state.period > 90)}`;
  }

  /* ---------- Events ---------- */

  function setHover(index) {
    state.hoverIndex = index;
    renderHover();
  }

  function bindEvents() {
    $('refresh').addEventListener('click', refresh);

    $('swap').addEventListener('click', () => {
      state.from = to();
      state.hoverIndex = null;
      render();
    });

    el.amount.addEventListener('input', () => renderConverter(points().at(-1)));
    $('converter').addEventListener('submit', (e) => e.preventDefault());

    el.periods.addEventListener('click', (e) => {
      const days = Number(e.target.closest('button')?.dataset.days);
      if (!days) return;
      state.period = days;
      state.hoverIndex = null;
      render();
    });

    const indexAt = (clientX) => {
      const x = clientX - el.svg.getBoundingClientRect().left - plot.pad.left;
      const i = Math.round((x / plot.innerW) * (plot.pts.length - 1));
      return Math.max(0, Math.min(plot.pts.length - 1, i));
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

    new ResizeObserver(() => renderChart(sliceByDays(points(), state.period))).observe(el.svg);

    const interval = CONFIG.refreshMinutes * 60000;
    setInterval(() => !document.hidden && refresh(), interval);
    // Timers are throttled in background tabs, so catch up when the page is shown again.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - state.lastAttempt >= interval) refresh();
    });
  }

  /* ---------- Init ---------- */

  const theme = params.get('theme');
  if (theme === 'light') document.documentElement.dataset.theme = theme;

  renderPeriods();
  bindEvents();
  refresh();
})();
