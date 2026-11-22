(() => {
  'use strict';

  /* ---------- Config ---------- */

  const CONFIG = {
    timeZone: '', // IANA name such as 'Europe/Berlin'; empty = the viewing device's zone — overridable with ?tz=
    showSeconds: false, // overridable with ?seconds=true|false
    hour12: false, // overridable with ?hour12=true|false
    locale: 'en-GB', // language of the weekday and month — overridable with ?locale=
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
  };

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

  function formatDate(now) {
    const weekday = weekdayFormat.format(now);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayFormat.format(now)}`;
  }

  /* ---------- Rendering ---------- */

  const $ = (id) => document.getElementById(id);
  const el = { clock: $('clock'), time: $('time'), date: $('date'), note: $('note') };

  function render() {
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

  // Re-render on each second or minute boundary rather than on a drifting interval.
  function tick() {
    render();
    const step = options.showSeconds ? 1000 : 60000;
    setTimeout(tick, step - (Date.now() % step) + 20);
  }

  /* ---------- Init ---------- */

  if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light';
  document.documentElement.lang = options.locale;
  document.body.classList.toggle('has-seconds', options.showSeconds);

  if (!zoneOk) {
    el.note.textContent = `Unknown time zone “${requestedZone}” — showing this device's time`;
    el.note.hidden = false;
  }

  tick();
  // Timers are throttled in background tabs, so catch up when the page is shown again.
  document.addEventListener('visibilitychange', () => !document.hidden && render());
})();
