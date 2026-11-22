(() => {
  'use strict';

  /* ---------- Config ---------- */

  const CONFIG = {
    timeZone: '', // IANA name such as 'Europe/Berlin'; empty = the viewing device's zone — overridable with ?tz=
    showSeconds: false, // overridable with ?seconds=true|false
    hour12: false, // overridable with ?hour12=true|false
    locale: 'en-GB', // language of the weekday and month — overridable with ?locale=

    showWeather: true, // overridable with ?weather=true|false
    place: '', // city name such as 'Lisbon'; empty = approximate location from the IP address — overridable with ?place=
    units: 'c', // 'c' or 'f' — overridable with ?units=
    forecastDays: 3, // days shown after today
    weatherRefreshMinutes: 30,
    requestTimeoutMs: 10000,
    forecastApi: 'https://api.open-meteo.com/v1/forecast',
    geocodingApi: 'https://geocoding-api.open-meteo.com/v1/search',
    ipLocationApi: 'https://get.geojs.io/v1/ip/geo.json',
  };

  // WMO weather interpretation codes, as returned by Open-Meteo.
  const CONDITIONS = [
    { codes: [0, 1], label: 'Clear', icon: 'clear' },
    { codes: [2], label: 'Partly cloudy', icon: 'partly' },
    { codes: [3], label: 'Cloudy', icon: 'cloudy' },
    { codes: [45, 48], label: 'Fog', icon: 'fog' },
    { codes: [51, 53, 55, 56, 57], label: 'Drizzle', icon: 'drizzle' },
    { codes: [61, 63, 65, 66, 67], label: 'Rain', icon: 'rain' },
    { codes: [80, 81, 82], label: 'Showers', icon: 'rain' },
    { codes: [71, 73, 75, 77, 85, 86], label: 'Snow', icon: 'snow' },
    { codes: [95, 96, 99], label: 'Thunderstorm', icon: 'thunder' },
  ];

  // Icons are drawn on a 24×24 grid with the current text color.
  const CLOUD = '<path class="cloud" d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.2A4.6 4.6 0 0 1 17 18z"/>';
  const RAISED_CLOUD = `<g transform="translate(0 -3.5)">${CLOUD}</g>`;
  const SMALL_CLOUD = `<g transform="translate(6.5 7.2) scale(.7)">${CLOUD}</g>`;
  const SUN =
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
  const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>';

  const ICONS = {
    'clear-day': SUN,
    'clear-night': MOON,
    'partly-day': `<g transform="translate(1.2 .8) scale(.64)">${SUN}</g>${SMALL_CLOUD}`,
    'partly-night': `<g transform="translate(1.5 .5) scale(.6)">${MOON}</g>${SMALL_CLOUD}`,
    cloudy: CLOUD,
    fog: `${RAISED_CLOUD}<path d="M6 18h12M8.5 21h7"/>`,
    drizzle: `${RAISED_CLOUD}<path d="M9.5 17.5l-.8 2.2M14.5 17.5l-.8 2.2"/>`,
    rain: `${RAISED_CLOUD}<path d="M8 17.5l-1.2 3.5M12 17.5l-1.2 3.5M16 17.5l-1.2 3.5"/>`,
    snow: `${RAISED_CLOUD}<path class="dots" d="M8 18.2h.01M12 20.6h.01M16 18.2h.01"/>`,
    thunder: `${RAISED_CLOUD}<path d="M12.8 16.5l-2.6 3h3l-2 3"/>`,
  };

  /* ---------- Options ---------- */

  const params = new URLSearchParams(location.search);

  function boolParam(name, fallback) {
    const value = params.get(name);
    return value === null ? fallback : ['true', '1'].includes(value);
  }

  // Intl throws a RangeError for a zone or locale it does not know.
  function isSupported(options, locale) {
    try {
      new Intl.DateTimeFormat(locale, options);
      return true;
    } catch {
      return false;
    }
  }

  const requestedZone = params.get('tz') || CONFIG.timeZone;
  const zoneOk = !requestedZone || isSupported({ timeZone: requestedZone });
  const requestedLocale = params.get('locale') || CONFIG.locale;

  const options = {
    timeZone: requestedZone && zoneOk ? requestedZone : undefined,
    showSeconds: boolParam('seconds', CONFIG.showSeconds),
    hour12: boolParam('hour12', CONFIG.hour12),
    locale: isSupported({}, requestedLocale) ? requestedLocale : CONFIG.locale,
    showWeather: boolParam('weather', CONFIG.showWeather),
    place: (params.get('place') || CONFIG.place).trim(),
    fahrenheit: (params.get('units') || CONFIG.units).toLowerCase() === 'f',
  };

  /* ---------- API ---------- */

  async function getJson(url, query = {}) {
    const res = await fetch(`${url}?${new URLSearchParams(query)}`.replace(/\?$/, ''), {
      signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
  const isCoord = (lat, lon) => isNumber(lat) && isNumber(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  // A named place, resolved to coordinates. The best-known match is used.
  async function fetchPlace(name) {
    const data = await getJson(CONFIG.geocodingApi, { name, count: 1, language: 'en', format: 'json' });
    const hit = data?.results?.[0];
    if (!hit) throw new Error('place-not-found');
    if (!isCoord(hit.latitude, hit.longitude)) throw new Error('Unexpected response');
    return { lat: hit.latitude, lon: hit.longitude, name: text(hit.name) || name };
  }

  // City-level location of the viewer's IP address. Coordinates arrive as strings.
  async function fetchIpLocation() {
    const data = await getJson(CONFIG.ipLocationApi);
    const lat = text(data?.latitude) ? Number(data.latitude) : NaN;
    const lon = text(data?.longitude) ? Number(data.longitude) : NaN;
    if (!isCoord(lat, lon)) throw new Error('Unexpected response');
    return { lat, lon, name: text(data.city) || text(data.region) || text(data.country) };
  }

  async function fetchForecast({ lat, lon }) {
    const data = await getJson(CONFIG.forecastApi, {
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      current: 'temperature_2m,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      temperature_unit: options.fahrenheit ? 'fahrenheit' : 'celsius',
      timezone: 'auto', // days are the place's own calendar days
      forecast_days: CONFIG.forecastDays + 1,
    });

    const { current, daily } = data ?? {};
    if (!isNumber(current?.temperature_2m) || !isNumber(current?.weather_code)) throw new Error('Unexpected response');
    if (!Array.isArray(daily?.time)) throw new Error('Unexpected response');

    const days = daily.time
      .map((date, i) => ({
        date,
        code: daily.weather_code?.[i],
        max: daily.temperature_2m_max?.[i],
        min: daily.temperature_2m_min?.[i],
      }))
      .filter((d) => isDate(d.date) && isNumber(d.code) && isNumber(d.max) && isNumber(d.min));
    if (!days.length) throw new Error('Unexpected response');

    return {
      now: { temp: current.temperature_2m, code: current.weather_code, isDay: current.is_day !== 0 },
      today: days[0],
      next: days.slice(1, CONFIG.forecastDays + 1),
    };
  }

  /* ---------- Calculations ---------- */

  function condition(code, isDay = true) {
    const match = CONDITIONS.find((c) => c.codes.includes(code));
    if (!match) return { label: '', icon: '' };
    const variants = ['clear', 'partly'].includes(match.icon);
    return { label: match.label, icon: variants ? `${match.icon}-${isDay ? 'day' : 'night'}` : match.icon };
  }

  /* ---------- Formatting ---------- */

  const timeFormat = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    hour: options.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    second: options.showSeconds ? '2-digit' : undefined,
    hourCycle: options.hour12 ? 'h12' : 'h23',
  });

  const weekdayFormat = new Intl.DateTimeFormat(options.locale, { timeZone: options.timeZone, weekday: 'long' });

  const dayFormat = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Machine-readable local date and time for the <time> element.
  const isoFormat = new Intl.DateTimeFormat('sv-SE', {
    timeZone: options.timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  // Forecast dates are plain calendar days, so they are formatted in UTC to avoid shifting.
  const forecastDayFormat = (weekday) => new Intl.DateTimeFormat(options.locale, { timeZone: 'UTC', weekday });
  const shortDayFormat = forecastDayFormat('short');
  const longDayFormat = forecastDayFormat('long');

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function formatTime(now) {
    const parts = timeFormat.formatToParts(now);
    return {
      digits: parts
        .filter((p) => p.type !== 'dayPeriod')
        .map((p) => p.value)
        .join('')
        .trim(),
      period: parts.find((p) => p.type === 'dayPeriod')?.value ?? '',
    };
  }

  const formatDate = (now) => `${capitalize(weekdayFormat.format(now))}, ${dayFormat.format(now)}`;

  // Math.round can give -0, which would print as "-0°".
  const formatTemp = (value) => `${Math.round(value) || 0}°`;

  const formatClock = (date) =>
    date.toLocaleTimeString(options.locale, { hour: '2-digit', minute: '2-digit', timeZone: options.timeZone });

  /* ---------- Rendering ---------- */

  const $ = (id) => document.getElementById(id);
  const el = {
    clock: $('clock'),
    time: $('time'),
    date: $('date'),
    clockNote: $('clock-note'),
    weather: $('weather'),
    today: $('today'),
    place: $('place'),
    nowIcon: $('now-icon'),
    nowTemp: $('now-temp'),
    nowLabel: $('now-label'),
    range: $('range'),
    days: $('days'),
    weatherNote: $('weather-note'),
  };

  function renderClock() {
    const now = new Date();
    const { digits, period } = formatTime(now);

    el.time.textContent = digits;
    if (period) {
      const suffix = document.createElement('span');
      suffix.className = 'period';
      suffix.textContent = period;
      el.time.append(suffix);
    }

    const date = formatDate(now);
    if (el.date.textContent !== date) el.date.textContent = date;
    el.clock.dateTime = isoFormat.format(now).replace(' ', 'T');
  }

  // Icon markup comes only from the ICONS table above; the label is set as an attribute.
  function iconSvg(name, label) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    if (label) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
    } else {
      svg.setAttribute('aria-hidden', 'true');
    }
    svg.innerHTML = ICONS[name] ?? '';
    return svg;
  }

  function span(className, content) {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = content;
    return node;
  }

  function renderWeather() {
    const { place, forecast, loading, error, loadedAt } = weather;
    el.weather.setAttribute('aria-busy', String(loading));
    el.today.hidden = !forecast;
    el.days.hidden = !forecast?.next.length;

    if (forecast) {
      const now = condition(forecast.now.code, forecast.now.isDay);
      el.place.textContent = place?.name ?? '';
      el.place.hidden = !place?.name;
      el.nowIcon.replaceChildren(iconSvg(now.icon));
      el.nowTemp.textContent = formatTemp(forecast.now.temp);
      el.nowLabel.textContent = now.label;
      el.range.replaceChildren(
        span('visually-hidden', `High ${formatTemp(forecast.today.max)}, low ${formatTemp(forecast.today.min)}`),
        span('range-text', `${formatTemp(forecast.today.max)} / ${formatTemp(forecast.today.min)}`),
      );
      el.range.lastChild.setAttribute('aria-hidden', 'true');

      el.days.replaceChildren(
        ...forecast.next.map((day) => {
          const date = new Date(`${day.date}T00:00:00Z`);
          const item = document.createElement('li');
          const name = span('day-name', capitalize(shortDayFormat.format(date)).replace('.', ''));
          name.setAttribute('aria-hidden', 'true');
          const temps = span('day-temps', '');
          temps.append(span('hi', formatTemp(day.max)), span('lo', formatTemp(day.min)));
          temps.setAttribute('aria-hidden', 'true');
          const spoken = `${capitalize(longDayFormat.format(date))}: ${condition(day.code).label || 'forecast'}, high ${formatTemp(day.max)}, low ${formatTemp(day.min)}`;
          item.append(span('visually-hidden', spoken), name, iconSvg(condition(day.code).icon), temps);
          return item;
        }),
      );
    }

    let note = '';
    if (error === 'place-not-found') note = `No place found for “${options.place}”`;
    else if (error && forecast) note = `Couldn't update · weather from ${formatClock(loadedAt)}`;
    else if (error) note = 'Weather unavailable';
    else if (loading && !forecast) note = 'Loading weather…';
    el.weatherNote.textContent = note;
    el.weatherNote.hidden = !note;
    el.weatherNote.classList.toggle('is-loading', loading && !forecast);
  }

  /* ---------- State and updates ---------- */

  const weather = { place: null, forecast: null, loading: false, error: '', loadedAt: null, lastAttempt: 0 };

  async function refreshWeather() {
    if (weather.loading) return;
    weather.loading = true;
    weather.lastAttempt = Date.now();
    renderWeather();

    try {
      // The location is looked up once and reused for every later refresh.
      weather.place ??= await (options.place ? fetchPlace(options.place) : fetchIpLocation());
      weather.forecast = await fetchForecast(weather.place);
      weather.loadedAt = new Date();
      weather.error = '';
    } catch (err) {
      weather.error = err?.message === 'place-not-found' ? 'place-not-found' : 'failed';
    }

    weather.loading = false;
    renderWeather();
  }

  // Re-render on each second or minute boundary rather than on a drifting interval.
  function tick() {
    renderClock();
    const step = options.showSeconds ? 1000 : 60000;
    setTimeout(tick, step - (Date.now() % step) + 20);
  }

  /* ---------- Init ---------- */

  if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light';
  document.documentElement.lang = options.locale;
  document.body.classList.toggle('has-seconds', options.showSeconds);
  document.body.classList.toggle('has-weather', options.showWeather);

  if (!zoneOk) {
    el.clockNote.textContent = `Unknown time zone “${requestedZone}” — showing this device's time`;
    el.clockNote.hidden = false;
  }

  tick();

  const weatherInterval = CONFIG.weatherRefreshMinutes * 60000;
  if (options.showWeather) {
    el.weather.hidden = false;
    refreshWeather();
    setInterval(() => !document.hidden && refreshWeather(), weatherInterval);
  }

  // Timers are throttled in background tabs, so catch up when the page is shown again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    renderClock();
    if (options.showWeather && Date.now() - weather.lastAttempt >= weatherInterval) refreshWeather();
  });
})();
