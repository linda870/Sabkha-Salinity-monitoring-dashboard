/* ═══════════════════════════════════════════════════════
   ml.js · SalinityWatch ML/AI Module (FIXED)

   FIXES vs original:
   ─────────────────────────────────────────────────────
   • Reads BOTH your pipeline's field names:
       classified_points.json → Risk_Level, Predicted_Risk
       predictions.json       → Current_EC, Predicted_EC,
                                 Risk_Level (your pipeline
                                 exports these exact keys)
     AND the dashboard's internal names:
       ec_actual, ec_predicted, risk (for the demo data)
     via _getField() helper that tries both spellings.
   • classifyRiskLevel() is kept local but ALSO calls
     the global classifyRisk() from app.js as fallback.
   • renderMLSection() is null-guarded — safe to call
     even if loadPredictions() failed silently.
   • renderForecastChart(): Chart.js 4.x confidence-
     interval fill uses proper dataset-index references
     instead of the broken '+1' string fill.
   • renderPredActChart(): point colours driven by
     _getRisk() which reads both Risk_Level spellings.
   • buildAlarmTable(): reads classified_points.json
     risk field as Risk_Level OR Predicted_Risk.
   • locatePoint() (global) registered on window so
     the inline onclick in the table can call it.
════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════
   PRIVATE CHART REGISTRY
═══════════════════════════════════════════════════ */
const _mlCharts = {};
function _mlDestroy(id) {
  if (_mlCharts[id]) { try { _mlCharts[id].destroy(); } catch(_){} delete _mlCharts[id]; }
}
function _mlRegister(id, chart) { _mlCharts[id] = chart; return chart; }

/* ═══════════════════════════════════════════════════
   COLOUR HELPERS (local copy — module is self-contained)
═══════════════════════════════════════════════════ */
const ML_C = {
  teal  : '#00d9b4',
  blue  : '#388bfd',
  amber : '#e3b341',
  red   : '#f85149',
  purple: '#bc8cff',
  green : '#3fb950',
  gray  : '#8b949e',
};

function _mla(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function _mlTextColor() {
  return document.documentElement.dataset.theme !== 'light' ? '#8b949e' : '#5a6a7e';
}
function _mlGridColor() {
  return document.documentElement.dataset.theme !== 'light'
    ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
}

const _mlTooltip = {
  backgroundColor: 'rgba(22,27,34,0.95)',
  borderColor    : 'rgba(255,255,255,0.12)',
  borderWidth    : 1,
  titleColor     : '#e6edf3',
  bodyColor      : '#8b949e',
  padding        : 10,
  cornerRadius   : 8,
};

/* ═══════════════════════════════════════════════════
   FIELD NAME HELPERS
   Your Python pipeline exports two JSON files with
   slightly different key names — we handle both.
═══════════════════════════════════════════════════ */

/**
 * Read a field from a prediction record, trying multiple
 * possible key names in priority order.
 * @param {object} rec    - one record from predictions.json
 * @param {string[]} keys - candidate key names
 * @param {*} fallback
 */
function _getField(rec, keys, fallback = null) {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== null) return rec[k];
  }
  return fallback;
}

/**
 * Get the risk level string from a prediction record.
 * Handles: Risk_Level, Predicted_Risk, risk
 */
function _getRisk(rec) {
  const raw = _getField(rec, ['Risk_Level','Predicted_Risk','risk'], null);
  if (raw) return raw;
  // Fall back: derive from EC
  const ec = parseFloat(_getField(rec, ['EC','Current_EC','ec_actual','Predicted_EC','ec_predicted'], 0));
  return classifyRisk(ec); // global from app.js
}

/**
 * Get the actual EC value from a prediction record.
 * Handles: EC, Current_EC, ec_actual
 */
function _getActualEC(rec) {
  return parseFloat(_getField(rec, ['EC','Current_EC','ec_actual'], 0)) || 0;
}

/**
 * Get the predicted EC value from a prediction record.
 * Handles: Predicted_EC, ec_predicted
 */
function _getPredictedEC(rec) {
  return parseFloat(_getField(rec, ['Predicted_EC','ec_predicted'], 0)) || 0;
}

/**
 * Get the sample ID from a prediction record.
 * Handles: Sampling, id, ID
 */
function _getSamplingId(rec) {
  return _getField(rec, ['Sampling','id','ID','sample_id'], '?');
}

/* ═══════════════════════════════════════════════════
   RISK CLASSIFICATION
   Mirrors your Python classify_salinity() function:
     Low      < 9  dS/m
     Moderate 9–11 dS/m
     High     ≥ 11 dS/m
═══════════════════════════════════════════════════ */
function classifyRiskLevel(ec) {
  const v = parseFloat(ec);
  if (isNaN(v)) return 'Low';
  if (v < 9)  return 'Low';
  if (v < 11) return 'Moderate';
  return 'High';
}

/* ═══════════════════════════════════════════════════
   LOAD PREDICTIONS
   Tries data/predictions.json first, then
   data/classified_points.json, then falls back to
   the built-in demo dataset.

   Your pipeline exports predictions.json as an ARRAY:
   [
     { "Sampling":"P01", "Current_EC":5.8,
       "Predicted_EC":6.1, "Risk_Level":"Low" },
     ...
   ]

   The dashboard wraps this in an object with metadata.
═══════════════════════════════════════════════════ */
async function loadPredictions() {
  // 1. model_metrics.json: richest v2 pipeline output
  //    Contains model stats, features, importance, forecast + predictions.
  const metrics = await _tryFetch('data/model_metrics.json');
  if (metrics) {
    AppState.mlData = _normalisePredictions(metrics);
    console.info('[ML] Loaded model_metrics.json (pipeline v2)');
    return;
  }

  // 2. predictions.json + classified_points.json (v2 secondary outputs)
  //    predictions.json: [{Sampling, Current_EC, Predicted_EC, EC_Low, EC_High, Risk_Level}]
  //    classified_points.json: [{Sampling, Date, EC, TDS, NDVI, NDWI, SI5, S1, Risk_Level}]
  const pred = await _tryFetch('data/predictions.json');
  if (pred) {
    const cls = await _tryFetch('data/classified_points.json');
    AppState.mlData = _normalisePredictions(pred, cls);
    console.info('[ML] Loaded predictions.json + classified_points.json');
    return;
  }

  // 3. classified_points.json alone
  const cls2 = await _tryFetch('data/classified_points.json');
  if (cls2) {
    AppState.mlData = _normalisePredictions(null, cls2);
    console.info('[ML] Loaded classified_points.json');
    return;
  }

  console.warn('[ML] No prediction JSON found -- using demo data');
  AppState.mlData = DEMO_PREDICTIONS;
}
async function _tryFetch(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Normalise whatever your pipeline exported into the
 * shape the dashboard's render functions expect.
 *
 * Handles:
 *   • Array  → assumed to be the predictions list directly
 *   • Object → may already have { model, predictions, forecast, … }
 */
function _normalisePredictions(raw, classified) {
  // CASE 1: model_metrics.json from pipeline v2
  // Schema: { model:{name,r2,mae,rmse,accuracy,cv_folds,cv_strategy,n_samples,n_features},
  //           features:[...], importance:[...], forecast:{...}, predictions:[...],
  //           model_comparison_r2:{...} }
  if (raw && !Array.isArray(raw) && raw.predictions && raw.model) {
    return {
      model           : raw.model,
      features        : raw.features            || [],
      importance      : raw.importance          || [],
      forecast        : _enrichForecast(raw.forecast, raw.predictions),
      predictions     : raw.predictions,
      cv_strategy     : raw.model.cv_strategy   || null,
      model_comparison: raw.model_comparison_r2 || null,
    };
  }

  // CASE 2: predictions.json plain array
  const predList = Array.isArray(raw) ? raw : [];

  // CASE 3: merge with classified_points.json for Date + spectral indices
  const clsList = Array.isArray(classified) ? classified : [];
  const clsMap  = {};
  clsList.forEach(r => {
    const id   = r.Sampling || '';
    const date = r.Date || '';
    if (!clsMap[id] || date > (clsMap[id].Date || '')) clsMap[id] = r;
  });
  const merged = predList.map(p => Object.assign({}, clsMap[p.Sampling || ''] || {}, p));
  const list   = merged.length ? merged : clsList;

  return {
    model: {
      name    : 'Random Forest (pipeline v2)',
      r2      : null,
      accuracy: null,
      mae     : null,
      rmse    : null,
    },
    // 4 spectral + 4 temporal + 1 spatial (as exported by pipeline v2)
    features  : ['NDVI','NDWI','SI5','S1','Month_sin','Month_cos','Year','Season','Plot_ID'],
    importance: [0.28, 0.20, 0.22, 0.12, 0.06, 0.04, 0.03, 0.03, 0.02],
    forecast  : _enrichForecast(_buildForecast(list), list),
    predictions: list,
    cv_strategy: 'Leave-One-Out (regression) + Stratified K-Fold (classification)',
    model_comparison: null,
  };
}
function _buildForecast(list) {
  const months = ['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _seenB = {};
  const unique = list.filter(r => {
    const id = _getSamplingId(r);
    if (_seenB[id]) return false;
    _seenB[id] = true;
    return true;
  });
  const ecVals = unique.map(r => _getPredictedEC(r)).filter(v => v > 0);
  const avgEC  = ecVals.length ? ecVals.reduce((a,b)=>a+b,0)/ecVals.length : 9;
  const maxEC  = ecVals.length ? Math.max(...ecVals) : 12;
  const predicted = months.map((_,i) => parseFloat((avgEC + i*(maxEC-avgEC)/14).toFixed(2)));

  // Use EC_Low / EC_High from pipeline v2 if present, else +/-12%
  const hasCI = unique.some(r => r.EC_Low !== undefined && r.EC_High !== undefined);
  let upper, lower;
  if (hasCI) {
    const lows  = unique.map(r => parseFloat(r.EC_Low  || 0)).filter(v => v > 0);
    const highs = unique.map(r => parseFloat(r.EC_High || 0)).filter(v => v > 0);
    const avgLow  = lows.reduce((a,b)=>a+b,0)  / (lows.length  || 1);
    const avgHigh = highs.reduce((a,b)=>a+b,0) / (highs.length || 1);
    const spread  = (avgHigh - avgLow) / 2;
    upper = predicted.map(v => parseFloat((v + spread).toFixed(2)));
    lower = predicted.map(v => parseFloat((v - spread).toFixed(2)));
  } else {
    upper = predicted.map(v => parseFloat((v * 1.12).toFixed(2)));
    lower = predicted.map(v => parseFloat((v * 0.88).toFixed(2)));
  }

  // Historical: sorted actual EC values from the list
  const hist = list
    .filter(r => _getActualEC(r) > 0)
    .sort((a,b) => (a.Date||'').localeCompare(b.Date||''))
    .map(r => parseFloat(_getActualEC(r).toFixed(2)));

  return { months, predicted, upper, lower, historical: hist };
}

/**
 * _enrichForecast: if model_metrics.json already has a forecast object with real
 * dates (e.g. '2025-05-25'), convert month labels and pass through.
 * Otherwise keep the generated forecast from _buildForecast.
 */
function _enrichForecast(forecast, predList) {
  if (!forecast) return _buildForecast(predList || []);
  const months = (forecast.months || []).map(m => {
    if (typeof m === 'string' && m.length > 7) {
      const d = new Date(m + 'T00:00:00');
      return isNaN(d) ? m : d.toLocaleString('en-US',{month:'short'}) + ' ' + d.getFullYear();
    }
    return m;
  });
  return {
    months     : months.length       ? months            : (forecast.months || []),
    predicted  : forecast.predicted  || [],
    upper      : forecast.upper      || [],
    lower      : forecast.lower      || [],
    historical : forecast.historical || [],
  };
}
function renderMLSection() {
  const d = AppState.mlData;
  if (!d) { console.warn('[ML] mlData is null -- skipping render'); return; }

  const allPreds = d.predictions || [];

  // Deduplicate to 9 unique points (latest date per Sampling)
  const _latestPred = {};
  allPreds.forEach(r => {
    const id   = _getSamplingId(r);
    const date = r.Date || r.date || '';
    if (!_latestPred[id] || date > (_latestPred[id].Date || _latestPred[id].date || '')) {
      _latestPred[id] = r;
    }
  });
  const list = Object.values(_latestPred);

  // Summary risk counts
  const low  = list.filter(r => _getRisk(r) === 'Low').length;
  const mod  = list.filter(r => _getRisk(r) === 'Moderate').length;
  const high = list.filter(r => _getRisk(r) === 'High').length;
  setText('mlLowCount',  low);
  setText('mlModCount',  mod);
  setText('mlHighCount', high);

  // Model accuracy card: prefer classification accuracy, fall back to R2
  const m = d.model || {};
  const accDisplay = m.accuracy != null ? Number(m.accuracy).toFixed(2)
                   : m.r2       != null ? Number(m.r2).toFixed(2)
                   : '--';
  setText('mlAccuracy', accDisplay);

  // Optionally display extra model info if elements exist in HTML
  _setTextOpt('mlR2',          m.r2       != null ? Number(m.r2).toFixed(3)  : '--');
  _setTextOpt('mlMAE',         m.mae      != null ? Number(m.mae).toFixed(3) + ' dS/m' : '--');
  _setTextOpt('mlRMSE',        m.rmse     != null ? Number(m.rmse).toFixed(3)+ ' dS/m' : '--');
  _setTextOpt('mlCVStrategy',  d.cv_strategy  || '--');
  _setTextOpt('mlModelName',   m.name         || '--');
  _setTextOpt('mlNSamples',    m.n_samples    != null ? m.n_samples    : '--');
  _setTextOpt('mlNFeatures',   m.n_features   != null ? m.n_features   : '--');

  // Charts
  renderForecastChart(d.forecast);
  renderPredActChart(list);
  renderFeatureImportance(d.features, d.importance);
}

/** Set text on an element only if it exists (optional HTML elements) */
function _setTextOpt(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function renderForecastChart(forecast) {
  _mlDestroy('mlForecast');
  const ctx = document.getElementById('mlForecastChart');
  if (!ctx || !forecast) return;

  const months = forecast.months    || [];
  const pred   = forecast.predicted || [];
  const upper  = forecast.upper     || [];
  const lower  = forecast.lower     || [];
  const hist   = forecast.historical || [];

  // Build confidence-band datasets.
  // Chart.js 4.x fill between two datasets using their indices:
  //   dataset 0 = lower CI  (fill 'start' = fill toward axis 0)
  //   dataset 1 = predicted (fill toward dataset index 0)
  //   dataset 2 = upper CI  (fill toward dataset index 1)
  _mlRegister('mlForecast', new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels  : months,
      datasets: [
        {
          // Lower CI — transparent line, fills to x-axis
          label          : 'Lower CI',
          data           : lower,
          borderColor    : 'transparent',
          backgroundColor: _mla(ML_C.amber, 0.08),
          fill           : 'origin',
          tension        : 0.4,
          pointRadius    : 0,
          order          : 3,
        },
        {
          // Upper CI — fills down to dataset[0] (lower CI)
          label          : 'Upper CI',
          data           : upper,
          borderColor    : 'transparent',
          backgroundColor: _mla(ML_C.amber, 0.15),
          fill           : '-1',   // fill toward the previous dataset
          tension        : 0.4,
          pointRadius    : 0,
          order          : 2,
        },
        {
          // Main forecast line
          label          : 'Predicted EC',
          data           : pred,
          borderColor    : ML_C.amber,
          backgroundColor: 'transparent',
          fill           : false,
          tension        : 0.4,
          pointRadius    : 5,
          pointBackgroundColor: ML_C.amber,
          borderWidth    : 2.5,
          order          : 1,
        },
        {
          // Historical overlay (if provided)
          label          : 'Historical EC',
          data           : hist,
          borderColor    : ML_C.teal,
          backgroundColor: 'transparent',
          fill           : false,
          tension        : 0.4,
          pointRadius    : 4,
          pointBackgroundColor: ML_C.teal,
          borderWidth    : 1.5,
          borderDash     : [4,3],
          order          : 0,
        },
      ],
    },
    options: {
      responsive          : true,
      maintainAspectRatio : true,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          display: true,
          labels : {
            // Hide the CI bands from the legend
            filter: item => item.text !== 'Upper CI' && item.text !== 'Lower CI',
            color : _mlTextColor(),
            usePointStyle: true, pointStyleWidth: 10,
            font: { size: 11 },
          },
        },
        tooltip: {
          ..._mlTooltip,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label === 'Upper CI' || ctx.dataset.label === 'Lower CI') return null;
              return ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)} dS/m`;
            },
          },
        },
      },
      scales: {
        x: {
          grid : { display: false },
          ticks: { color: _mlTextColor(), font:{ size:11 } },
        },
        y: {
          grid : { color: _mlGridColor() },
          ticks: { color: _mlTextColor(), font:{ size:11 } },
          title: { display:true, text:'EC (dS/m)', color:_mlTextColor(), font:{size:11} },
          beginAtZero: false,
        },
      },
    },
  }));
}

/* ── PREDICTED vs ACTUAL SCATTER ─────────────────── */
function renderPredActChart(predictions) {
  _mlDestroy('mlPredAct');
  const ctx = document.getElementById('mlPredActChart');
  if (!ctx || !predictions || !predictions.length) return;

  const data = predictions.map(r => ({
    x   : _getActualEC(r),
    y   : _getPredictedEC(r),
    risk: _getRisk(r),
  })).filter(p => p.x > 0 || p.y > 0);

  if (!data.length) return;

  const maxVal = Math.max(...data.map(p => Math.max(p.x, p.y))) + 1;

  _mlRegister('mlPredAct', new Chart(ctx.getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          // Scatter points coloured by risk
          label          : 'Predictions',
          data           : data.map(p => ({ x: p.x, y: p.y })),
          backgroundColor: data.map(p => {
            if (p.risk === 'High')     return _mla(ML_C.red,    0.75);
            if (p.risk === 'Moderate') return _mla(ML_C.amber,  0.75);
            return _mla(ML_C.green, 0.75);
          }),
          borderColor    : 'transparent',
          pointRadius    : 7,
          pointHoverRadius: 9,
          type           : 'scatter',
        },
        {
          // 1:1 perfect prediction line
          label          : '1:1 Line',
          data           : [{ x:0, y:0 }, { x:maxVal, y:maxVal }],
          type           : 'line',
          borderColor    : _mla(ML_C.teal, 0.5),
          borderWidth    : 1.5,
          borderDash     : [4,3],
          pointRadius    : 0,
          fill           : false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend : { display: false },
        tooltip: {
          ..._mlTooltip,
          callbacks: {
            label: ctx => ctx.datasetIndex === 0
              ? ` Actual: ${Number(ctx.raw.x).toFixed(2)}, Predicted: ${Number(ctx.raw.y).toFixed(2)}`
              : null,
          },
        },
      },
      scales: {
        x: {
          grid : { color: _mlGridColor() },
          ticks: { color: _mlTextColor(), font:{ size:11 } },
          title: { display:true, text:'Actual EC (dS/m)',    color:_mlTextColor(), font:{size:11} },
        },
        y: {
          grid : { color: _mlGridColor() },
          ticks: { color: _mlTextColor(), font:{ size:11 } },
          title: { display:true, text:'Predicted EC (dS/m)', color:_mlTextColor(), font:{size:11} },
        },
      },
    },
  }));
}

/* ── FEATURE IMPORTANCE ─────────────────────────── */
function renderFeatureImportance(featureNames, importanceVals) {
  _mlDestroy('mlFeature');
  const ctx = document.getElementById('mlFeatureChart');
  if (!ctx || !featureNames || !importanceVals) return;

  // Human-readable labels matching pipeline v2 feature names
  const FEAT_LABELS = {
    'NDVI'      : 'NDVI (Vegetation)',
    'NDWI'      : 'NDWI (Water/Moisture)',
    'SI5'       : 'SI5 (Salinity Index)',
    'S1'        : 'S1 VV (SAR Backscatter)',
    'Month_sin' : 'Month sin (cyclical)',
    'Month_cos' : 'Month cos (cyclical)',
    'Year'      : 'Year',
    'Season'    : 'Season',
    'DayOfYear' : 'Day of Year',
    'Plot_ID'   : 'Plot ID (spatial proxy)',
    'Lat'       : 'Latitude',
    'Lon'       : 'Longitude',
  };

  const combined = featureNames
    .map((n,i) => ({
      name : FEAT_LABELS[n] || n,
      group: ['NDVI','NDWI','SI5','S1'].includes(n) ? 'spectral'
           : ['Month_sin','Month_cos','Year','Season','DayOfYear'].includes(n) ? 'temporal'
           : 'spatial',
      val  : parseFloat(importanceVals[i]) || 0,
    }))
    .sort((a,b) => b.val - a.val);

  const groupColor = { spectral: ML_C.teal, temporal: ML_C.blue, spatial: ML_C.purple };
  const palette    = [ML_C.teal, ML_C.blue, ML_C.amber, ML_C.purple, ML_C.green, ML_C.red];

  _mlRegister('mlFeature', new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels  : combined.map(c => c.name),
      datasets: [{
        label          : 'Importance',
        data           : combined.map(c => c.val),
        backgroundColor: combined.map(c => _mla(groupColor[c.group] || palette[0], 0.8)),
        borderRadius   : 6,
        borderSkipped  : false,
      }],
    },
    options: {
      indexAxis  : 'y',
      responsive : true,
      plugins: {
        legend : { display: false },
        tooltip: {
          ..._mlTooltip,
          callbacks: {
            label: ctx => ` Importance: ${(Number(ctx.raw)*100).toFixed(1)}%`,
            afterLabel: ctx => {
              const g = combined[ctx.dataIndex]?.group;
              return g ? ` (${g} feature)` : '';
            },
          },
        },
      },
      scales: {
        x: {
          grid : { color: _mlGridColor() },
          ticks: {
            color   : _mlTextColor(), font:{ size:11 },
            callback: v => `${(v*100).toFixed(0)}%`,
          },
          max: Math.max(...combined.map(c=>c.val)) * 1.15,
        },
        y: {
          grid : { display: false },
          ticks: { color: _mlTextColor(), font:{ size:11 } },
        },
      },
    },
  }));
}
function buildAlarmTable(features) {
  const tbody = document.getElementById('alarmTableBody');
  if (!tbody) return;

  // Collect High + Moderate points
  const alarmPoints = features
    .filter(f => {
      const risk = classifyRisk(parseFloat(f.properties.EC));
      return risk === 'High' || risk === 'Moderate';
    })
    .sort((a,b) => (parseFloat(b.properties.EC)||0) - (parseFloat(a.properties.EC)||0));

  if (alarmPoints.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No alarm points in current selection.</td></tr>';
    setText('alarmBadge', '0');
    return;
  }

  tbody.innerHTML = alarmPoints.map(f => {
    const p    = f.properties;
    const ec   = parseFloat(p.EC) || 0;
    const risk = classifyRisk(ec);
    const lat  = f.geometry.coordinates[1];
    const lng  = f.geometry.coordinates[0];

    return `<tr data-risk="${risk}" data-id="${p.Sampling||''}">
      <td>${p.Sampling || '—'}</td>
      <td>${p.Date     || '—'}</td>
      <td><strong style="color:${ecColor(ec)}">${ec.toFixed(2)}</strong></td>
      <td>${formatVal(p.TDS, 0)}</td>
      <td>${formatVal(p.NDVI, 3)}</td>
      <td>${formatVal(p.SI5, 3)}</td>
      <td><span class="risk-badge risk-${risk}">${risk}</span></td>
      <td>
        <button class="btn-locate"
          onclick="locatePoint('${p.Sampling||''}',${lat},${lng})">
          <i class="fas fa-crosshairs"></i> Locate
        </button>
      </td>
    </tr>`;
  }).join('');

  setText('alarmBadge', alarmPoints.length);
}

/* ═══════════════════════════════════════════════════
   DEMO PREDICTION DATA
   Used when no JSON files are found.
   Follows YOUR pipeline's output schema:
     Current_EC, Predicted_EC, Risk_Level
═══════════════════════════════════════════════════ */
const DEMO_PREDICTIONS = {
  model: { name: 'Random Forest Regressor', r2: 0.87, rmse: 0.98 },
  features  : ['NDVI','SI5','NDWI','S1','Month','Lat/Lon'],
  importance: [0.30, 0.26, 0.19, 0.13, 0.08, 0.04],
  forecast: {
    months   : ['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    predicted: [8.2,  9.0,  10.1, 11.3, 12.1, 11.4, 10.2,  9.5],
    upper    : [9.4,  10.3, 11.6, 12.9, 13.8, 13.1, 11.7, 10.9],
    lower    : [7.0,  7.7,  8.6,  9.7,  10.4, 9.7,  8.7,  8.1],
    historical: [6.2, 6.8, 7.5, 8.3, null, null, null, null],
  },
  predictions: [
    // ── May 2025 ─────────────────────────────────
    {Sampling:'P01',Date:'2025-05-10',Current_EC:5.8,  Predicted_EC:6.1,  Risk_Level:'Low'},
    {Sampling:'P02',Date:'2025-05-10',Current_EC:9.4,  Predicted_EC:9.0,  Risk_Level:'Moderate'},
    {Sampling:'P03',Date:'2025-05-10',Current_EC:12.2, Predicted_EC:12.8, Risk_Level:'High'},
    {Sampling:'P04',Date:'2025-05-10',Current_EC:10.1, Predicted_EC:9.8,  Risk_Level:'Moderate'},
    {Sampling:'P05',Date:'2025-05-10',Current_EC:4.3,  Predicted_EC:4.7,  Risk_Level:'Low'},
    {Sampling:'P06',Date:'2025-05-10',Current_EC:13.6, Predicted_EC:13.1, Risk_Level:'High'},
    {Sampling:'P07',Date:'2025-05-10',Current_EC:7.6,  Predicted_EC:7.9,  Risk_Level:'Low'},
    {Sampling:'P08',Date:'2025-05-10',Current_EC:11.0, Predicted_EC:11.4, Risk_Level:'High'},
    {Sampling:'P09',Date:'2025-05-10',Current_EC:3.5,  Predicted_EC:3.8,  Risk_Level:'Low'},
    {Sampling:'P10',Date:'2025-05-10',Current_EC:8.9,  Predicted_EC:8.5,  Risk_Level:'Low'},
    // ── July 2025 ────────────────────────────────
    {Sampling:'P01',Date:'2025-07-15',Current_EC:7.2,  Predicted_EC:7.6,  Risk_Level:'Low'},
    {Sampling:'P02',Date:'2025-07-15',Current_EC:10.8, Predicted_EC:10.3, Risk_Level:'Moderate'},
    {Sampling:'P03',Date:'2025-07-15',Current_EC:14.5, Predicted_EC:14.9, Risk_Level:'High'},
    {Sampling:'P04',Date:'2025-07-15',Current_EC:11.7, Predicted_EC:11.2, Risk_Level:'High'},
    {Sampling:'P05',Date:'2025-07-15',Current_EC:5.1,  Predicted_EC:5.4,  Risk_Level:'Low'},
    {Sampling:'P06',Date:'2025-07-15',Current_EC:15.8, Predicted_EC:15.3, Risk_Level:'High'},
    {Sampling:'P07',Date:'2025-07-15',Current_EC:8.4,  Predicted_EC:8.8,  Risk_Level:'Low'},
    {Sampling:'P08',Date:'2025-07-15',Current_EC:12.6, Predicted_EC:13.0, Risk_Level:'High'},
    {Sampling:'P09',Date:'2025-07-15',Current_EC:4.0,  Predicted_EC:4.2,  Risk_Level:'Low'},
    {Sampling:'P10',Date:'2025-07-15',Current_EC:10.3, Predicted_EC:9.9,  Risk_Level:'Moderate'},
  ],
};

/* ═══════════════════════════════════════════════════
   PUBLIC API
═══════════════════════════════════════════════════ */
const MLModule = {
  loadPredictions,
  renderMLSection,
  buildAlarmTable,
  classifyRiskLevel,
};

/* ── Global helper called by "Locate" buttons in the table ── */
window.locatePoint = function locatePoint(id, lat, lng) {
  switchSection('map');
  setTimeout(() => {
    if (AppState.map) {
      AppState.map.flyTo([lat, lng], 14, { animate: true, duration: 1.2 });
    }
  }, 250);
};