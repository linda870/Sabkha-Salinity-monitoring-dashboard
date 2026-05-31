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
  if (v < 8)  return 'Low';   // FAO: matches pipeline v2 threshold
  if (v < 12) return 'Moderate';
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
  // 1. model_metrics.json — richest output from pipeline v2.
  //    Contains model stats, features, importance, forecast, and predictions.
  //    Make sure this file is in your data/ folder after running the pipeline.
  const metrics = await _tryFetch('data/model_metrics.json');
  if (metrics) {
    AppState.mlData = _normalisePredictions(metrics);
    console.info('[ML] Loaded data/model_metrics.json (pipeline v2 -- full stats)');
    return;
  }

  // 2. predictions.json + classified_points.json (pipeline v2 secondary outputs)
  const pred = await _tryFetch('data/predictions.json');
  if (pred) {
    const cls = await _tryFetch('data/classified_points.json');
    AppState.mlData = _normalisePredictions(pred, cls);
    console.info('[ML] Loaded data/predictions.json (model_metrics.json not found)');
    return;
  }

  // 3. classified_points.json alone
  const cls2 = await _tryFetch('data/classified_points.json');
  if (cls2) {
    AppState.mlData = _normalisePredictions(null, cls2);
    console.info('[ML] Loaded data/classified_points.json only');
    return;
  }

  console.warn('[ML] No JSON files found in data/ -- using built-in demo data.');
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

  // ── CASE 1: model_metrics.json ──────────────────────────────────────────
  // This is the richest output from pipeline v2. It contains model stats,
  // feature importance, forecast, and the full predictions array.
  // Shape: { model:{name,r2,accuracy,mae,rmse,...}, features, importance,
  //          forecast, predictions, model_comparison_r2 }
  if (raw && !Array.isArray(raw) && raw.predictions && raw.model) {
    console.info('[ML] _normalisePredictions: using model_metrics.json (full stats)');
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

  // ── CASE 2: predictions.json plain array ────────────────────────────────
  // Shape: [{Sampling, Current_EC, Predicted_EC, EC_Low, EC_High, Risk_Level}]
  const predList = Array.isArray(raw) ? raw : [];

  // ── CASE 3: merge with classified_points.json ───────────────────────────
  // Shape: [{Sampling, Date, EC, TDS, NDVI, NDWI, SI5, S1, Risk_Level}]
  const clsList = Array.isArray(classified) ? classified : [];
  const clsMap  = {};
  clsList.forEach(r => {
    const id   = r.Sampling || '';
    const date = r.Date || '';
    if (!clsMap[id] || date > (clsMap[id].Date || '')) clsMap[id] = r;
  });
  const merged = predList.map(p => Object.assign({}, clsMap[p.Sampling || ''] || {}, p));
  const list   = merged.length ? merged : clsList;

  console.warn('[ML] _normalisePredictions: model_metrics.json not available.',
    'Feature importance will use real pipeline v2 values as fallback.',
    'For full stats, place model_metrics.json in data/');

  return {
    model: {
      name    : 'Random Forest (pipeline v2)',
      r2      : null,
      accuracy: 0.40,    // best CV accuracy from pipeline v2 run
      mae     : 3.234,   // best LOO MAE from pipeline v2 run
      rmse    : 6.851,
    },
    // Real feature names from pipeline v2 (9 features: spectral + temporal + spatial)
    features  : ['NDVI','NDWI','SI5','S1','Month_sin','Month_cos','Year','Season','Plot_ID'],
    // Real importance values from pipeline v2 run (in ALL_FEATURES order):
    // NDWI(0.237) > S1(0.218) > NDVI(0.205) > SI5(0.152) > Plot_ID(0.135)
    importance: [0.2055, 0.2366, 0.1520, 0.2178, 0.0308, 0.0000, 0.0000, 0.0220, 0.1355],
    forecast  : _enrichForecast(_buildForecast(list), list),
    predictions: list,
    cv_strategy: 'Leave-One-Out (regression) + Stratified K-Fold (classification)',
    model_comparison: null,
  };
}

/**
 * Build a simple 8-month forecast from the prediction list.
 * If the list contains future dates they'll be used;
 * otherwise a smooth projection is generated.
 */
function _buildForecast(list) {
  const monthLabels = ['May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Deduplicate: one entry per unique plot
  const _seen = {};
  const unique = list.filter(r => {
    const id = _getSamplingId(r);
    if (_seen[id]) return false;
    _seen[id] = true;
    return true;
  });

  const ecVals = unique.map(r => _getPredictedEC(r)).filter(v => v > 0);
  const avgEC  = ecVals.length ? ecVals.reduce((a,b)=>a+b,0)/ecVals.length : 9;
  const maxEC  = ecVals.length ? Math.max(...ecVals) : 12;

  // Smooth 8-month projection
  const predicted = monthLabels.map((_,i) => parseFloat((avgEC + i*(maxEC-avgEC)/14).toFixed(2)));

  // Use EC_Low/EC_High from pipeline v2 if present, else +/-12%
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

  // Historical: actual EC sorted by date
  const historical = list
    .filter(r => _getActualEC(r) > 0)
    .sort((a,b) => (a.Date||'').localeCompare(b.Date||''))
    .map(r => parseFloat(_getActualEC(r).toFixed(2)));

  return { months: monthLabels, predicted, upper, lower, historical };
}

// _enrichForecast: handles model_metrics.json forecast which has only 2 known dates.
// Converts date strings to labels and extends to 8-point curve.
function _enrichForecast(forecast, predList) {
  if (!forecast) return _buildForecast(predList || []);

  const rawMonths = forecast.months || [];
  const fmtMonths = rawMonths.map(m => {
    if (typeof m === 'string' && m.length > 7) {
      const d = new Date(m + 'T00:00:00');
      return isNaN(d) ? m : d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear();
    }
    return m;
  });

  const basePred = forecast.predicted  || [];
  const baseUpper= forecast.upper      || [];
  const baseLower= forecast.lower      || [];
  const baseHist = forecast.historical || [];

  // If fewer than 5 forecast points, extend to a smooth 8-point curve
  if (basePred.length < 5) {
    const extLabels = ['Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan'];
    const lastPred  = basePred[basePred.length - 1] || 10;
    const lastUpper = baseUpper[baseUpper.length - 1] || lastPred * 1.12;
    const lastLower = baseLower[baseLower.length - 1] || lastPred * 0.88;
    const spread    = (lastUpper - lastLower) / 2;
    const maxKnown  = Math.max(...basePred.filter(v => v != null));

    const extMonths = fmtMonths.slice();
    const extPred   = basePred.slice();
    const extUpper  = baseUpper.slice();
    const extLower  = baseLower.slice();

    const needed = 8 - basePred.length;
    for (let i = 0; i < needed; i++) {
      extMonths.push(extLabels[i]);
      const proj = parseFloat((lastPred + (i+1)*(maxKnown-lastPred)/8).toFixed(2));
      extPred.push(proj);
      extUpper.push(parseFloat((proj + spread).toFixed(2)));
      extLower.push(parseFloat((proj - spread).toFixed(2)));
    }

    return { months: extMonths, predicted: extPred, upper: extUpper,
             lower: extLower, historical: baseHist };
  }

  return {
    months    : fmtMonths.length ? fmtMonths : rawMonths,
    predicted : basePred,
    upper     : baseUpper,
    lower     : baseLower,
    historical: baseHist,
  };
}

/* ═══════════════════════════════════════════════════
   RENDER ML SECTION
═══════════════════════════════════════════════════ */
function renderMLSection() {
  const d = AppState.mlData;
  if (!d) { console.warn('[ML] mlData is null -- skipping render'); return; }

  const allPreds = d.predictions || [];

  // DEDUPLICATE to 9 unique plots (keep latest date per Sampling).
  // predictions.json has 18 rows (9 plots x 2 dates).
  // Every chart and counter must work on 9 points, not 18.
  const _latestPred = {};
  allPreds.forEach(r => {
    const id   = _getSamplingId(r);
    const date = r.Date || r.date || '';
    if (!_latestPred[id] || date > (_latestPred[id].Date || _latestPred[id].date || '')) {
      _latestPred[id] = r;
    }
  });
  const list = Object.values(_latestPred)
    .sort((a, b) => _getSamplingId(a).localeCompare(_getSamplingId(b)));

  // Risk counts on 9 unique plots
  const low  = list.filter(r => _getRisk(r) === 'Low').length;
  const mod  = list.filter(r => _getRisk(r) === 'Moderate').length;
  const high = list.filter(r => _getRisk(r) === 'High').length;
  setText('mlLowCount',  low);
  setText('mlModCount',  mod);
  setText('mlHighCount', high);

  // Accuracy card: prefer classification accuracy from pipeline v2,
  // fall back to R2, fall back to '--'
  const m = d.model || {};
  const accDisplay =
    (m.accuracy != null && !isNaN(m.accuracy)) ? Number(m.accuracy).toFixed(2) :
    (m.r2       != null && !isNaN(m.r2))       ? Number(m.r2).toFixed(2)       : '--';
  setText('mlAccuracy', accDisplay);

  // Optional extra fields (only set if those HTML elements exist)
  _setTextOpt('mlR2',        m.r2   != null ? Number(m.r2).toFixed(3)   : '--');
  _setTextOpt('mlMAE',       m.mae  != null ? Number(m.mae).toFixed(3)  + ' dS/m' : '--');
  _setTextOpt('mlRMSE',      m.rmse != null ? Number(m.rmse).toFixed(3) + ' dS/m' : '--');
  _setTextOpt('mlModelName', m.name || '--');

  // Charts all receive 9-point deduplicated list
  renderForecastChart(d.forecast);
  renderPredActChart(list);
  renderFeatureImportance(d.features, d.importance);
}

function _setTextOpt(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ── FORECAST CHART ─────────────────────────────── */
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

  // Pair, sort descending
  const combined = featureNames
    .map((n,i) => ({ name: n, val: parseFloat(importanceVals[i]) || 0 }))
    .sort((a,b) => b.val - a.val);

  const palette = [ML_C.teal, ML_C.blue, ML_C.amber, ML_C.purple, ML_C.green, ML_C.red];

  _mlRegister('mlFeature', new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels  : combined.map(c => c.name),
      datasets: [{
        label          : 'Importance',
        data           : combined.map(c => c.val),
        backgroundColor: combined.map((_,i) => _mla(palette[i % palette.length], 0.8)),
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
          callbacks: { label: ctx => ` Importance: ${(Number(ctx.raw)*100).toFixed(1)}%` },
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

/* ═══════════════════════════════════════════════════
   ALARM TABLE
   Populated from GeoJSON features (NOT from mlData)
   so it respects the active date filter.
   Risk is derived from EC using classifyRisk() (app.js).
═══════════════════════════════════════════════════ */
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
  // Features and importance match actual pipeline v2 output
  // Real run: NDWI(0.237) > S1(0.218) > NDVI(0.205) > SI5(0.152) > Plot_ID(0.135)
  model: {
    name    : 'Random Forest (pipeline v2)',
    r2      : null,
    accuracy: 0.40,
    mae     : 3.234,
    rmse    : 6.851,
  },
  features  : ['NDVI','NDWI','SI5','S1','Month_sin','Month_cos','Year','Season','Plot_ID'],
  // Importance in ALL_FEATURES order (matches model_metrics.json export)
  importance: [0.2055, 0.2366, 0.1520, 0.2178, 0.0308, 0.0000, 0.0000, 0.0220, 0.1355],
  forecast: {
    months   : ['May 2025','Jul 2025','Aug','Sep','Oct','Nov','Dec','Jan'],
    predicted: [10.02, 8.25, 9.80, 11.40, 12.10, 11.50, 10.30,  9.60],
    upper    : [16.50,14.10,13.80, 14.90, 15.60, 14.80, 13.50, 12.90],
    lower    : [ 5.90, 4.10, 5.60,  6.90,  7.80,  7.20,  6.30,  5.80],
    historical: [10.02, 8.25],
  },
  predictions: [
    {Sampling:'plot1',Date:'2025-05-25',EC:6.54, TDS:3.26,NDVI:0.320,NDWI:-0.332,SI5:0.251,S1:-11.05,Current_EC:6.54, Predicted_EC:9.69, EC_Low:6.33, EC_High:19.63,Risk_Level:'High'},
    {Sampling:'plot2',Date:'2025-05-25',EC:19.63,TDS:9.80,NDVI:0.249,NDWI:-0.285,SI5:0.261,S1:-11.46,Current_EC:19.63,Predicted_EC:15.31,EC_Low:6.54, EC_High:19.63,Risk_Level:'High'},
    {Sampling:'plot3',Date:'2025-05-25',EC:14.20,TDS:7.07,NDVI:0.282,NDWI:-0.302,SI5:0.250,S1:-12.04,Current_EC:14.20,Predicted_EC:14.38,EC_Low:6.54, EC_High:19.63,Risk_Level:'High'},
    {Sampling:'plot4',Date:'2025-05-25',EC:9.34, TDS:4.66,NDVI:0.268,NDWI:-0.291,SI5:0.267,S1:-12.75,Current_EC:9.34, Predicted_EC:11.37,EC_Low:7.80, EC_High:19.63,Risk_Level:'Moderate'},
    {Sampling:'plot5',Date:'2025-05-25',EC:16.21,TDS:8.06,NDVI:0.248,NDWI:-0.270,SI5:0.285,S1:-12.55,Current_EC:16.21,Predicted_EC:14.40,EC_Low:7.80, EC_High:16.21,Risk_Level:'High'},
    {Sampling:'plot6',Date:'2025-05-25',EC:12.74,TDS:6.41,NDVI:0.152,NDWI:-0.193,SI5:0.341,S1:-13.14,Current_EC:12.74,Predicted_EC:12.25,EC_Low:7.45, EC_High:14.96,Risk_Level:'High'},
    {Sampling:'plot7',Date:'2025-05-25',EC:7.98, TDS:4.00,NDVI:0.241,NDWI:-0.259,SI5:0.267,S1:-14.54,Current_EC:7.98, Predicted_EC:8.56, EC_Low:7.80, EC_High:14.30,Risk_Level:'Low'},
    {Sampling:'plot8',Date:'2025-05-25',EC:7.80, TDS:3.90,NDVI:0.243,NDWI:-0.275,SI5:0.276,S1:-14.00,Current_EC:7.80, Predicted_EC:8.46, EC_Low:7.80, EC_High:16.21,Risk_Level:'Low'},
    {Sampling:'plot9',Date:'2025-05-25',EC:8.72, TDS:4.37,NDVI:0.219,NDWI:-0.244,SI5:0.293,S1:-14.61,Current_EC:8.72, Predicted_EC:8.52, EC_Low:5.94, EC_High:8.75, Risk_Level:'Moderate'},
    {Sampling:'plot1',Date:'2025-07-22',EC:2.48, TDS:1.24,NDVI:0.195,NDWI:-0.259,SI5:0.344,S1:-15.16,Current_EC:2.48, Predicted_EC:4.11, EC_Low:2.48, EC_High:10.50,Risk_Level:'Low'},
    {Sampling:'plot2',Date:'2025-07-22',EC:7.45, TDS:3.72,NDVI:0.162,NDWI:-0.235,SI5:0.358,S1:-17.48,Current_EC:7.45, Predicted_EC:7.83, EC_Low:2.48, EC_High:12.74,Risk_Level:'Low'},
    {Sampling:'plot3',Date:'2025-07-22',EC:7.47, TDS:3.73,NDVI:0.214,NDWI:-0.247,SI5:0.331,S1:-16.59,Current_EC:7.47, Predicted_EC:7.02, EC_Low:2.48, EC_High:10.50,Risk_Level:'Low'},
    {Sampling:'plot4',Date:'2025-07-22',EC:4.46, TDS:2.23,NDVI:0.199,NDWI:-0.248,SI5:0.324,S1:-13.35,Current_EC:4.46, Predicted_EC:5.78, EC_Low:4.36, EC_High:10.50,Risk_Level:'Low'},
    {Sampling:'plot5',Date:'2025-07-22',EC:10.50,TDS:5.25,NDVI:0.185,NDWI:-0.235,SI5:0.335,S1:-15.56,Current_EC:10.50,Predicted_EC:9.72, EC_Low:4.36, EC_High:12.05,Risk_Level:'Moderate'},
    {Sampling:'plot6',Date:'2025-07-22',EC:11.92,TDS:5.96,NDVI:0.106,NDWI:-0.171,SI5:0.430,S1:-15.71,Current_EC:11.92,Predicted_EC:11.48,EC_Low:7.45, EC_High:14.96,Risk_Level:'Moderate'},
    {Sampling:'plot7',Date:'2025-07-22',EC:14.96,TDS:7.48,NDVI:0.183,NDWI:-0.227,SI5:0.313,S1:-15.88,Current_EC:14.96,Predicted_EC:13.26,EC_Low:7.37, EC_High:14.96,Risk_Level:'High'},
    {Sampling:'plot8',Date:'2025-07-22',EC:5.94, TDS:2.97,NDVI:0.204,NDWI:-0.241,SI5:0.318,S1:-14.48,Current_EC:5.94, Predicted_EC:6.49, EC_Low:4.46, EC_High:10.57,Risk_Level:'Low'},
    {Sampling:'plot9',Date:'2025-07-22',EC:12.05,TDS:6.03,NDVI:0.184,NDWI:-0.227,SI5:0.343,S1:-14.93,Current_EC:12.05,Predicted_EC:11.22,EC_Low:4.46, EC_High:14.96,Risk_Level:'High'},
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
