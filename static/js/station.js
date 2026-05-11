/* ─ Ilervis Station — D3.js widgets ─────────────────────────────────────── */

const POLL_INTERVAL = 30_000;  // ms

// ── State ─────────────────────────────────────────────────────────────────

let history = [];

// ── Fetch helpers ─────────────────────────────────────────────────────────

async function fetchLatest() {
  const r = await fetch('/api/station/latest');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchHistory() {
  const r = await fetch('/api/station/history?hours=24');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Status indicator ──────────────────────────────────────────────────────

function updateStatus(ageSeconds) {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  dot.classList.remove('online', 'delayed', 'offline');

  if (ageSeconds === null || ageSeconds === undefined) {
    dot.classList.add('offline');
    label.textContent = 'Sense dades';
    return;
  }
  if (ageSeconds < 120) {
    dot.classList.add('online');
    label.textContent = 'En línia';
  } else if (ageSeconds < 600) {
    dot.classList.add('delayed');
    label.textContent = 'Retard';
  } else {
    dot.classList.add('offline');
    label.textContent = 'Fora de línia';
  }
}

// ── Sparkline chart ───────────────────────────────────────────────────────

function drawSparkline(svgId, data, key, color) {
  const svg = d3.select(`#${svgId}`);
  svg.selectAll('*').remove();
  if (!data || data.length < 2) return;

  const W = svg.node().getBoundingClientRect().width || 260;
  const H = 64;
  const vals = data.map(d => d[key]).filter(v => v != null);
  if (!vals.length) return;

  const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, W]);
  const y = d3.scaleLinear().domain([d3.min(vals) * 0.995, d3.max(vals) * 1.005]).range([H - 4, 4]);

  const line = d3.line()
    .x((_, i) => x(i))
    .y(d => y(d[key] ?? 0))
    .defined(d => d[key] != null)
    .curve(d3.curveCatmullRom.alpha(0.5));

  const area = d3.area()
    .x((_, i) => x(i))
    .y0(H)
    .y1(d => y(d[key] ?? 0))
    .defined(d => d[key] != null)
    .curve(d3.curveCatmullRom.alpha(0.5));

  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', `grad-${svgId}`)
    .attr('x1', 0).attr('y1', 0)
    .attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.35);
  grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);

  svg.append('path')
    .datum(data)
    .attr('fill', `url(#grad-${svgId})`)
    .attr('d', area);

  svg.append('path')
    .datum(data)
    .attr('class', 'chart-line')
    .attr('stroke', color)
    .attr('d', line);

  // Latest dot
  const last = data.filter(d => d[key] != null).at(-1);
  if (last) {
    const i = data.lastIndexOf(last);
    svg.append('circle')
      .attr('cx', x(i))
      .attr('cy', y(last[key]))
      .attr('r', 3)
      .attr('fill', color);
  }
}

// ── Trend arrow ───────────────────────────────────────────────────────────

function trend(data, key) {
  const vals = data.map(d => d[key]).filter(v => v != null);
  if (vals.length < 4) return null;
  const recent = vals.slice(-4);
  const delta  = recent.at(-1) - recent[0];
  return delta;
}

function setTrend(elId, delta, unit = '') {
  const el = document.getElementById(elId);
  if (!el) return;
  if (delta === null) { el.textContent = ''; return; }
  const sign = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const cls  = delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : '';
  el.className = `widget-trend ${cls}`;
  el.textContent = `${sign} ${Math.abs(delta).toFixed(1)}${unit} en 4 mostres`;
}

// ── Humidity gauge (semicircle) ───────────────────────────────────────────

function drawGauge(value) {
  const svg = d3.select('#gauge-hum');
  svg.selectAll('*').remove();
  if (value == null) return;

  const W = 120, H = 70;
  const cx = W / 2, cy = H - 4;
  const r  = 52;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const startAngle = -Math.PI;
  const endAngle   = 0;

  const arcBg = d3.arc()
    .innerRadius(r - 10)
    .outerRadius(r)
    .startAngle(startAngle)
    .endAngle(endAngle);

  const arcFg = d3.arc()
    .innerRadius(r - 10)
    .outerRadius(r)
    .startAngle(startAngle)
    .endAngle(startAngle + (endAngle - startAngle) * pct)
    .cornerRadius(4);

  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

  g.append('path')
    .attr('d', arcBg())
    .attr('fill', 'rgba(255,255,255,0.05)');

  const color = pct < 0.3 ? '#f45f5f' : pct < 0.7 ? '#4ac8e8' : '#3dd68c';
  g.append('path')
    .attr('d', arcFg())
    .attr('fill', color);

  g.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '-6')
    .attr('font-family', 'JetBrains Mono, monospace')
    .attr('font-size', '13')
    .attr('font-weight', '500')
    .attr('fill', color)
    .text(`${Math.round(value)}%`);
}

// ── Update loop ───────────────────────────────────────────────────────────

function formatAge(s) {
  if (s < 60) return `fa ${s}s`;
  if (s < 3600) return `fa ${Math.floor(s / 60)}min`;
  return `fa ${Math.floor(s / 3600)}h`;
}

async function update() {
  try {
    const [latest, hist] = await Promise.all([fetchLatest(), fetchHistory()]);
    history = hist;

    if (!latest.available) {
      updateStatus(null);
      return;
    }

    // Values
    document.getElementById('temp-value').textContent = latest.temperature?.toFixed(1) ?? '—';
    document.getElementById('hum-value').textContent  = latest.humidity?.toFixed(1) ?? '—';
    document.getElementById('pres-value').textContent = latest.pressure?.toFixed(1) ?? '—';

    // Meta
    document.getElementById('station-age').textContent = formatAge(latest.age_seconds);
    document.getElementById('station-id').textContent  = latest.station_id ?? '';

    // Status
    updateStatus(latest.age_seconds);

    // Sparklines
    const accent  = '#4ac8e8';
    const green   = '#3dd68c';
    const purple  = '#a78bfa';
    drawSparkline('chart-temp', hist, 'temperature', accent);
    drawSparkline('chart-hum',  hist, 'humidity',    green);
    drawSparkline('chart-pres', hist, 'pressure',    purple);

    // Gauge
    drawGauge(latest.humidity);

    // Trends
    setTrend('temp-trend', trend(hist, 'temperature'), '°C');
    setTrend('pres-trend', trend(hist, 'pressure'),    ' hPa');

  } catch (err) {
    console.warn('[station]', err);
    updateStatus(99999);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────

update();
setInterval(update, POLL_INTERVAL);
