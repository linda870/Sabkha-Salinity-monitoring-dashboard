/* ═══════════════════════════════════════════════════════
   charts.js · SalinityWatch Chart Module
   Handles: Overview, Donut, Time-Series, Scatter,
            Radar, Bar, Feature Importance charts
════════════════════════════════════════════════════════ */

'use strict';

/* ── CHART.JS GLOBAL DEFAULTS ─────────────────────── */
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.color        = '#8b949e';
Chart.defaults.borderColor  = 'rgba(255,255,255,0.07)';
Chart.defaults.plugins.legend.display = false;
Chart.defaults.animation.duration     = 600;

/* ── THEME HELPERS ────────────────────────────────── */
function getThemeColor(opacity = 1) {
  const isDark = document.documentElement.dataset.theme !== 'light';
  return isDark
    ? `rgba(255,255,255,${opacity})`
    : `rgba(26,35,50,${opacity})`;
}

function getGridColor() {
  const isDark = document.documentElement.dataset.theme !== 'light';
  return isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
}

/* ── COLOUR PALETTE ───────────────────────────────── */
const COLORS = {
  teal  : '#00d9b4',
  blue  : '#388bfd',
  amber : '#e3b341',
  red   : '#f85149',
  purple: '#bc8cff',
  green : '#3fb950',
  gray  : '#8b949e',
};

function alpha(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Common axis config */
function axisConfig(title) {
  return {
    grid: { color: getGridColor() },
    ticks: { color: '#8b949e', font: { size: 11 } },
    title: title ? { display: true, text: title, color: '#8b949e', font: { size: 11 } } : undefined,
  };
}

/* ── CHART REGISTRY (for cleanup/resize) ─────────── */
const _charts = {};

function destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function register(id, chart) {
  _charts[id] = chart;
  return chart;
}

/* ══════════════════════════════════════════════════
   OVERVIEW CHART  (line or bar of EC/TDS per point)
══════════════════════════════════════════════════ */
const ChartsModule = (() => {

  /* ── 1. OVERVIEW CHART ─────────────────────────── */
  function initOverviewChart(features) {
    destroyChart('overview');
    const labels = features.map(f => f.properties.Sampling || '?');
    const ecVals = features.map(f => f.properties.EC  ?? 0);
    const tdVals = features.map(f => (f.properties.TDS ?? 0) / 1000); // convert to g/L for scale

    const ctx = document.getElementById('overviewChart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'EC (dS/m)',
            data: ecVals,
            borderColor: COLORS.amber,
            backgroundColor: alpha(COLORS.amber, 0.12),
            tension: 0.4,
            fill: true,
            pointBackgroundColor: ecVals.map(v => ecColor(v)),
            pointRadius: 5,
            pointHoverRadius: 7,
            borderWidth: 2,
            yAxisID: 'yEC',
          },
          {
            label: 'TDS (g/L)',
            data: tdVals,
            borderColor: COLORS.blue,
            backgroundColor: alpha(COLORS.blue, 0.08),
            tension: 0.4,
            fill: false,
            borderDash: [5,3],
            pointRadius: 4,
            borderWidth: 2,
            yAxisID: 'yTDS',
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#8b949e', usePointStyle: true, pointStyleWidth: 10, font:{ size:11 } },
          },
          tooltip: {
            backgroundColor: 'rgba(22,27,34,0.95)',
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            titleColor: '#e6edf3',
            bodyColor: '#8b949e',
          },
        },
        scales: {
          x: { ...axisConfig(), grid: { display: false } },
          yEC:  { ...axisConfig('EC (dS/m)'),  position: 'left',  suggestedMin: 0 },
          yTDS: { ...axisConfig('TDS (g/L)'), position: 'right', grid: { display: false }, suggestedMin: 0 },
        },
      },
    });
    register('overview', chart);

    // Toggle line/bar
    document.querySelectorAll('[data-chart-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-chart-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        chart.config.type = btn.dataset.chartView;
        chart.update();
      });
    });
  }

  function updateOverviewChart(features, index) {
    const chart = _charts['overview'];
    if (!chart) return;
    const labels = features.map(f => f.properties.Sampling || '?');
    const vals   = features.map(f => f.properties[index] ?? 0);
    chart.data.labels = labels;
    chart.data.datasets[0].data = vals;
    chart.data.datasets[0].label = index;
    chart.update();
  }

  /* ── 2. RISK DONUT ─────────────────────────────── */
  function initRiskDonut(features) {
    destroyChart('riskDonut');
    const low  = features.filter(f => classifyRisk(f.properties.EC) === 'Low').length;
    const mod  = features.filter(f => classifyRisk(f.properties.EC) === 'Moderate').length;
    const high = features.filter(f => classifyRisk(f.properties.EC) === 'High').length;
    const total = features.length;

    const ctx = document.getElementById('riskDonutChart').getContext('2d');
    register('riskDonut', new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Low', 'Moderate', 'High'],
        datasets: [{
          data: [low, mod, high],
          backgroundColor: [alpha(COLORS.green,0.85), alpha(COLORS.amber,0.85), alpha(COLORS.red,0.85)],
          borderColor: 'transparent',
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(22,27,34,0.95)',
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.raw} (${total ? ((ctx.raw/total)*100).toFixed(0) : 0}%)`,
            },
          },
        },
      },
      plugins: [{
        id: 'centerText',
        beforeDraw(chart) {
          const { ctx: c, chartArea: { width, height, top } } = chart;
          const cx = width / 2;
          const cy = top + height / 2;
          c.save();
          c.textAlign = 'center';
          c.font = "bold 22px 'Space Mono', monospace";
          c.fillStyle = getThemeColor(0.9);
          c.fillText(total, cx, cy);
          c.font = "11px 'DM Sans', sans-serif";
          c.fillStyle = '#8b949e';
          c.fillText('Points', cx, cy + 17);
          c.restore();
        },
      }],
    }));

    // Custom legend
    const legendEl = document.getElementById('donutLegend');
    if (legendEl) {
      const items = [
        { color: COLORS.green, label: 'Low', count: low },
        { color: COLORS.amber, label: 'Moderate', count: mod },
        { color: COLORS.red,   label: 'High', count: high },
      ];
      legendEl.innerHTML = items.map(i =>
        `<div class="legend-item">
           <span class="legend-dot" style="background:${i.color}"></span>
           ${i.label} (${i.count})
         </div>`
      ).join('');
    }
  }

  /* ── 3. TIME-SERIES CHARTS ─────────────────────── */
  function initTimeSeriesCharts(ts) {

    if (!Array.isArray(ts) || ts.length === 0) {
      console.warn('Invalid or empty time series data');
      return;
    }

    /* 1. DEDUPLICATE */
    const seen = new Set();
    ts = ts.filter(row => {
      const key = `${row.Date}_${row.Sampling}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    /* 2. SORT BY DATE */
    ts.sort((a, b) => new Date(a.Date) - new Date(b.Date));

    /* 3. UNIQUE DATES — grouped by year for x-axis label */
    const rawDates = [...new Set(ts.map(d => d.Date))];

    /* Labels: "YYYY Mon" so year is always visible */
    const labels = rawDates.map(d => {
      const dt = new Date(d + 'T00:00:00');
      return dt.getFullYear() + ' ' +
        dt.toLocaleString('en-US', { month: 'short' });
    });

    /* 4. GROUP BY SAMPLING POINT */
    const groups = {};
    ts.forEach(row => {
      const id = row.Sampling || 'Unknown';
      if (!groups[id]) groups[id] = {};
      groups[id][row.Date] = {
        NDVI: row.NDVI  != null ? Number(row.NDVI)  : null,
        NDWI: row.NDWI  != null ? Number(row.NDWI)  : null,
        SI5 : row.SI5   != null ? Number(row.SI5)   : null,
        S1  : row.S1    != null ? Number(row.S1)    :
              row.S1_VV != null ? Number(row.S1_VV) : null,
      };
    });

    /* 5. FIXED COLOUR PALETTE — one colour per sampling point */
    const colorPalette = [
      COLORS.teal, COLORS.blue, COLORS.amber,
      COLORS.red,  COLORS.green, COLORS.purple,
      '#ff7b72',   '#79c0ff',    '#d2a8ff',
    ];
    const plotIds   = Object.keys(groups).sort();
    const plotColor = {};
    plotIds.forEach((id, i) => { plotColor[id] = colorPalette[i % colorPalette.length]; });

    /* 6. BUILD DATASETS */
    function makeDatasets(key) {
      return plotIds.map(id => ({
        label           : id,
        data            : rawDates.map(date => groups[id]?.[date]?.[key] ?? null),
        borderColor     : plotColor[id],
        backgroundColor : plotColor[id],
        borderWidth     : 2,
        tension         : 0.35,
        pointRadius     : 3,
        pointHoverRadius: 5,
        fill            : false,
        spanGaps        : true,
      }));
    }

    /* 7. LINE OPTIONS — compact (for dashboard) or expanded (for modal) */
    function buildOptions(yLabel, expanded) {
      return {
        responsive         : true,
        maintainAspectRatio: !expanded,
        interaction        : { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display  : true,
            position : 'top',
            labels   : {
              color          : '#8b949e',
              usePointStyle  : true,
              pointStyleWidth: 10,
              font           : { size: expanded ? 12 : 10 },
              boxWidth       : 12,
              padding        : expanded ? 16 : 10,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(22,27,34,0.95)',
            borderColor    : 'rgba(255,255,255,0.12)',
            borderWidth    : 1,
            titleColor     : '#e6edf3',
            bodyColor      : '#8b949e',
            callbacks: {
              title : items => items[0].label,
              label : ctx  => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(4) : '—'}`,
            },
          },
        },
        scales: {
          x: {
            ...axisConfig(),
            grid  : { display: false },
            ticks : {
              color     : '#8b949e',
              font      : { size: expanded ? 11 : 9 },
              maxRotation: 45,
              autoSkip  : true,
              maxTicksLimit: expanded ? 37 : 12,
            },
          },
          y: {
            ...axisConfig(yLabel),
            beginAtZero: false,
            ticks: { color: '#8b949e', font: { size: expanded ? 11 : 9 } },
          },
        },
      };
    }

    /* 8. CHART CREATOR */
    function createLineChart(chartId, key, yLabel) {
      const canvas = document.getElementById(chartId);
      if (!canvas) { console.warn(`Canvas not found: ${chartId}`); return; }
      destroyChart(chartId);
      const chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: makeDatasets(key) },
        options: buildOptions(yLabel, false),
      });
      register(chartId, chart);

      /* ── EXPAND BUTTON wired here ── */
      const expandBtn = canvas.closest('.chart-card, .card, [data-chart-card]')
                          ?.querySelector('[data-expand-chart]');
      if (expandBtn) {
        // remove previous listener by cloning
        const fresh = expandBtn.cloneNode(true);
        expandBtn.parentNode.replaceChild(fresh, expandBtn);
        fresh.addEventListener('click', () =>
          openChartModal(key, yLabel, labels, makeDatasets(key), buildOptions)
        );
      }
    }

    /* 9. CREATE ALL FOUR CHARTS */
    createLineChart('tsNDVIChart', 'NDVI', 'NDVI');
    createLineChart('tsNDWIChart', 'NDWI', 'NDWI');
    createLineChart('tsSI5Chart',  'SI5',  'SI5');
    createLineChart('tsS1Chart',   'S1',   'S1 backscatter (dB)');

    /* 10. INJECT EXPAND MODAL (once) */
    injectChartModal();
  }

  /* ── EXPAND MODAL ─────────────────────────────── */
  function injectChartModal() {
    if (document.getElementById('chartExpandModal')) return;

    const modal = document.createElement('div');
    modal.id        = 'chartExpandModal';
    modal.innerHTML = `
      <div class="chart-modal-backdrop" id="chartModalBackdrop"></div>
      <div class="chart-modal-box">
        <div class="chart-modal-header">
          <span class="chart-modal-title" id="chartModalTitle"></span>
          <button class="chart-modal-close" id="chartModalClose" title="Close">✕</button>
        </div>
        <div class="chart-modal-body">
          <canvas id="chartModalCanvas"></canvas>
        </div>
      </div>`;
    document.body.appendChild(modal);

    /* Style injection */
    if (!document.getElementById('chartModalStyle')) {
      const s = document.createElement('style');
      s.id = 'chartModalStyle';
      s.textContent = `
        #chartExpandModal {
          display: none; position: fixed; inset: 0;
          z-index: 9999; align-items: center; justify-content: center;
        }
        #chartExpandModal.open { display: flex; }
        .chart-modal-backdrop {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.72); backdrop-filter: blur(4px);
        }
        .chart-modal-box {
          position: relative; z-index: 1;
          background: var(--bg-card, #161b22);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          width: min(92vw, 1100px);
          height: min(82vh, 680px);
          display: flex; flex-direction: column;
          box-shadow: 0 24px 64px rgba(0,0,0,0.55);
        }
        .chart-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 20px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .chart-modal-title {
          font-size: 14px; font-weight: 600;
          color: var(--text-primary, #e6edf3); letter-spacing: 0.02em;
        }
        .chart-modal-close {
          background: none; border: none; cursor: pointer;
          color: #8b949e; font-size: 16px; padding: 4px 8px;
          border-radius: 6px; transition: background 0.15s;
        }
        .chart-modal-close:hover { background: rgba(255,255,255,0.08); color: #e6edf3; }
        .chart-modal-body {
          flex: 1; padding: 16px 20px 20px; min-height: 0;
          position: relative;
        }
        .chart-modal-body canvas { width: 100% !important; height: 100% !important; }
      `;
      document.head.appendChild(s);
    }

    /* Close handlers */
    document.getElementById('chartModalClose').addEventListener('click', closeChartModal);
    document.getElementById('chartModalBackdrop').addEventListener('click', closeChartModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChartModal(); });
  }

  function openChartModal(key, yLabel, labels, datasets, buildOptions) {
    const modal = document.getElementById('chartExpandModal');
    if (!modal) return;

    document.getElementById('chartModalTitle').textContent =
      `Time Series — ${yLabel} (all sampling points, 2016–2025)`;

    destroyChart('__modal__');
    const canvas = document.getElementById('chartModalCanvas');
    /* Reset canvas size */
    canvas.removeAttribute('style');
    canvas.width  = canvas.parentElement.offsetWidth  || 900;
    canvas.height = canvas.parentElement.offsetHeight || 500;

    const chart = new Chart(canvas.getContext('2d'), {
      type   : 'line',
      data   : { labels, datasets },
      options: buildOptions(yLabel, true),
    });
    register('__modal__', chart);

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeChartModal() {
    const modal = document.getElementById('chartExpandModal');
    if (modal) modal.classList.remove('open');
    destroyChart('__modal__');
    document.body.style.overflow = '';
  }

  /* lineOptions removed — replaced by buildOptions inside initTimeSeriesCharts */

  /* ── 4. SCATTER CHARTS ─────────────────────────── */
  function initIndicesCharts(features) {
    scatterECvs(features, 'NDVI', 'scatterECNDVI', COLORS.green);
    scatterECvs(features, 'SI5',  'scatterECSI5',  COLORS.purple);
    initRadar(features);
    initIndexBar(features);
  }

  function scatterECvs(features, index, canvasId, color) {
    destroyChart(canvasId);
    const data = features.map(f => ({
      x: f.properties.EC    ?? 0,
      y: f.properties[index] ?? 0,
    }));
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    register(canvasId, new Chart(ctx.getContext('2d'), {
      type: 'scatter',
      data: {
        datasets: [{
          label: `EC vs ${index}`,
          data,
          backgroundColor: alpha(color, 0.7),
          borderColor: color,
          borderWidth: 1,
          pointRadius: 7,
          pointHoverRadius: 9,
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(22,27,34,0.95)',
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            callbacks: {
              label: ctx => `EC: ${ctx.raw.x.toFixed(2)}, ${index}: ${ctx.raw.y.toFixed(3)}`,
            },
          },
        },
        scales: {
          x: { ...axisConfig('EC (dS/m)') },
          y: { ...axisConfig(index) },
        },
      },
    }));
  }

  /* ── 5. RADAR CHART ────────────────────────────── */
  function initRadar(features) {
    destroyChart('radar');
    const avg = (key) => {
      const vals = features.map(f => f.properties[key]).filter(v => v != null && !isNaN(v));
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    };
    // Normalise to [0,1] range for radar
    const norm = (v, min, max) => Math.max(0, Math.min(1, (v-min)/(max-min)));
    const normVals = [
      norm(avg('EC'),   0, 10),
      norm(avg('TDS'),  0, 6400),
      norm(avg('NDVI'), 0, 1),
      1 - norm(avg('NDWI'), -0.5, 0.5), // invert: more water = less stress
      norm(avg('SI5'),  0, 1),
      norm(avg('S1'),   0, 0.6),
    ];
    const ctx = document.getElementById('radarChart');
    if (!ctx) return;
    register('radar', new Chart(ctx.getContext('2d'), {
      type: 'radar',
      data: {
        labels: ['EC', 'TDS', 'NDVI', 'NDWI', 'SI5', 'S1'],
        datasets: [{
          label: 'Avg Indices',
          data: normVals,
          borderColor: COLORS.teal,
          backgroundColor: alpha(COLORS.teal, 0.15),
          borderWidth: 2,
          pointBackgroundColor: COLORS.teal,
          pointRadius: 4,
        }],
      },
      options: {
        scales: {
          r: {
            suggestedMin: 0, suggestedMax: 1,
            grid: { color: getGridColor() },
            ticks: { display: false },
            pointLabels: { color: '#8b949e', font: { size: 11 } },
            angleLines: { color: getGridColor() },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(22,27,34,0.95)',
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
          },
        },
      },
    }));
  }

  /* ── 6. INDEX BAR COMPARISON ───────────────────── */
  function initIndexBar(features) {
    destroyChart('indexBar');
    // Group by date and compute averages
    const byDate = {};
    features.forEach(f => {
      const d = f.properties.Date ? f.properties.Date.slice(0,7) : 'unknown';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(f.properties);
    });
    const dates = Object.keys(byDate).sort();
    const ecAvg   = dates.map(d => avg(byDate[d], 'EC'));
    const si5Avg  = dates.map(d => avg(byDate[d], 'SI5'));
    const ndviAvg = dates.map(d => avg(byDate[d], 'NDVI'));
    const ctx = document.getElementById('indexBarChart');
    if (!ctx) return;
    register('indexBar', new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: dates,
        datasets: [
          { label: 'Avg EC',   data: ecAvg,   backgroundColor: alpha(COLORS.amber, 0.8),  borderRadius: 5 },
          { label: 'Avg SI5',  data: si5Avg,  backgroundColor: alpha(COLORS.purple,0.8), borderRadius: 5 },
          { label: 'Avg NDVI', data: ndviAvg, backgroundColor: alpha(COLORS.green, 0.8), borderRadius: 5 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true, labels: { color:'#8b949e', usePointStyle:true, pointStyleWidth:10, font:{size:11} } },
          tooltip: {
            backgroundColor:'rgba(22,27,34,0.95)', borderColor:'rgba(255,255,255,0.12)', borderWidth:1,
          },
        },
        scales: {
          x: { ...axisConfig(), grid: { display: false } },
          y: { ...axisConfig('Value'), beginAtZero: true },
        },
      },
    }));
  }

  /* ── REFRESH THEME ─────────────────────────────── */
  function refreshTheme() {
    // Update grid line colours after theme switch
    Chart.defaults.borderColor = getGridColor();
    Object.values(_charts).forEach(c => {
      if (c.options.scales) {
        Object.values(c.options.scales).forEach(ax => {
          if (ax.grid) ax.grid.color = getGridColor();
        });
      }
      c.update();
    });
  }

  /* ── HELPER ────────────────────────────────────── */
  function avg(arr, key) {
    const vals = arr.map(o => o[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
  }

  return {
    initOverviewChart,
    updateOverviewChart,
    initRiskDonut,
    initTimeSeriesCharts,
    initIndicesCharts,
    refreshTheme,
  };
})();
function toLatLng(f) {
  return [
    parseFloat(f.geometry.coordinates[1]),
    parseFloat(f.geometry.coordinates[0])
  ];
}

function toXY(f) {
  return {
    x: parseFloat(f.geometry.coordinates[0]),
    y: parseFloat(f.geometry.coordinates[1]),
    value: parseFloat(f.properties.EC)
  };
}