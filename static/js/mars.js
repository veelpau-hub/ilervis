/* ─ Ilervis Module 03 — Mars comparison + D3 elevation profile ────────── */

(function () {

  // ── Load data ──────────────────────────────────────────────────────────────

  async function init() {
    const [meta, profile] = await Promise.all([
      fetch('/api/mars/metadata').then(r => r.json()).catch(() => ({ available: false })),
      fetch('/api/mars/profile').then(r => r.json()).catch(() => ({ available: false })),
    ]);

    setupImages(meta);
    setupMetrics(profile);
    drawElevationProfile(profile);
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  function setupImages(meta) {
    const img    = document.getElementById('mars-img');
    const noData = document.getElementById('mars-no-data');

    if (!meta.available) {
      img.style.display    = 'none';
      noData.style.display = 'flex';
      return;
    }

    img.style.display    = 'block';
    noData.style.display = 'none';
    img.src = '/static/mars_jezero.png';

    if (meta.product_id) {
      const statsEl = document.getElementById('mars-stats');
      if (statsEl) {
        statsEl.textContent = `${meta.product_id} · ${meta.resolution_cm} cm/px`;
      }
    }
  }

  // ── Metrics ────────────────────────────────────────────────────────────────

  function setupMetrics(profile) {
    if (!profile.available) return;

    const dBadge = document.getElementById('demo-badge');
    if (profile.source === 'sample' && dBadge) dBadge.style.display = 'inline';
    else if (dBadge) dBadge.style.display = 'none';

    if (profile.roughness) {
      setText('rug-segria', profile.roughness.segria?.toFixed(1) + ' m');
      setText('rug-mars',   profile.roughness.mars?.toFixed(1) + ' m');
    }
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Elevation profile chart ────────────────────────────────────────────────

  function drawElevationProfile(profile) {
    const svg = d3.select('#elevation-chart');
    if (!svg.node()) return;

    const W   = svg.node().getBoundingClientRect().width || 900;
    const H   = 220;
    const pad = { top: 20, right: 24, bottom: 40, left: 56 };

    svg.attr('viewBox', `0 0 ${W} ${H}`);
    svg.selectAll('*').remove();

    let segriaVals, marsVals, isSample;

    if (profile.available && profile.segria?.values?.length) {
      segriaVals = profile.segria.values;
      marsVals   = profile.mars.values;
      isSample   = profile.source === 'sample';
    } else {
      // Fallback inline demo if API not yet available
      isSample   = true;
      segriaVals = generateSegriaDemo(200);
      marsVals   = generateMarsDemo(200);
    }

    const n    = segriaVals.length;
    const allY = [...segriaVals, ...marsVals];

    const x = d3.scaleLinear()
      .domain([0, n - 1])
      .range([pad.left, W - pad.right]);

    const ySegria = d3.scaleLinear()
      .domain([d3.min(segriaVals) * 0.95, d3.max(segriaVals) * 1.05])
      .range([H - pad.bottom, pad.top]);

    const yMars = d3.scaleLinear()
      .domain([d3.min(marsVals) * 0.95, d3.max(marsVals) * 1.05])
      .range([H - pad.bottom, pad.top]);

    // Grid lines
    const gridVals = ySegria.ticks(4);
    svg.append('g')
      .selectAll('line')
      .data(gridVals)
      .join('line')
        .attr('x1', pad.left).attr('x2', W - pad.right)
        .attr('y1', d => ySegria(d)).attr('y2', d => ySegria(d))
        .attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 1);

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${H - pad.bottom})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(i => `${Math.round(i / n * 100)}%`))
      .call(g => g.select('.domain').attr('stroke', 'rgba(255,255,255,0.15)'))
      .call(g => g.selectAll('text').attr('fill', '#5a6a88').attr('font-size', 10).attr('font-family', 'JetBrains Mono, monospace'));

    svg.append('g')
      .attr('transform', `translate(${pad.left},0)`)
      .call(d3.axisLeft(ySegria).ticks(4).tickFormat(d => `${d}m`))
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('text').attr('fill', '#4ac8e8').attr('font-size', 10).attr('font-family', 'JetBrains Mono, monospace'));

    svg.append('g')
      .attr('transform', `translate(${W - pad.right},0)`)
      .call(d3.axisRight(yMars).ticks(4).tickFormat(d => `${d}m`))
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('text').attr('fill', '#fb923c').attr('font-size', 10).attr('font-family', 'JetBrains Mono, monospace'));

    // Area + line helpers
    function drawProfile(vals, yScale, color) {
      const lineGen = d3.line()
        .x((_, i) => x(i))
        .y(d => yScale(d))
        .curve(d3.curveCatmullRom.alpha(0.5));

      const areaGen = d3.area()
        .x((_, i) => x(i))
        .y0(H - pad.bottom)
        .y1(d => yScale(d))
        .curve(d3.curveCatmullRom.alpha(0.5));

      const gradId = `grad-${color.replace('#', '')}`;
      const defs = svg.append('defs');
      const grad = defs.append('linearGradient')
        .attr('id', gradId).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
      grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.25);
      grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);

      svg.append('path').datum(vals)
        .attr('fill', `url(#${gradId})`).attr('d', areaGen);
      svg.append('path').datum(vals)
        .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.8)
        .attr('d', lineGen);
    }

    drawProfile(segriaVals, ySegria, '#4ac8e8');
    drawProfile(marsVals,   yMars,   '#fb923c');

    // Sample watermark
    if (isSample) {
      svg.append('text')
        .attr('x', W / 2).attr('y', H / 2 + 8)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', 32).attr('font-weight', 600)
        .attr('fill', 'rgba(255,255,255,0.04)')
        .text('EXEMPLE');
    }
  }

  // ── Demo data generators ──────────────────────────────────────────────────

  function generateSegriaDemo(n) {
    const vals = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 4;
      vals.push(200 + 40 * Math.sin(t * 0.3) + 15 * Math.sin(t * 1.1) + 8 * Math.sin(t * 2.7) + (Math.random() - 0.5) * 6);
    }
    return vals.map(v => Math.round(v * 10) / 10);
  }

  function generateMarsDemo(n) {
    const vals = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 4;
      const crater = 350 * Math.exp(-Math.pow(t - Math.PI, 2) / 2.5);
      const floor  = -250 * Math.exp(-Math.pow(t - 2 * Math.PI, 2) / 1.8);
      const noise  = 80 * Math.sin(t * 0.8) + (Math.random() - 0.5) * 30;
      vals.push(Math.max(0, Math.min(800, 400 + crater + floor + noise)));
    }
    return vals.map(v => Math.round(v * 10) / 10);
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  init();

})();
