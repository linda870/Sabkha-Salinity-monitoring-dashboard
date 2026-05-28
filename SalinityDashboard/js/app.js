/* ═══════════════════════════════════════════════════════
   app.js · SalinityWatch Core Module
   Handles: init, navigation, Leaflet map, GeoJSON,
            raster overlays, popup info panel, stat cards
════════════════════════════════════════════════════════ */

'use strict';

/* ── GLOBAL STATE ────────────────────────────────────── */
const AppState = {
  activeSection : 'overview',
  selectedDate  : 'all',
  selectedIndex : 'EC',
  sidebarCollapsed: false,
  map           : null,
  baseLayers    : {},
  activeBase    : 'osm',
  overlayLayers : {},    // raster image overlays keyed by layer name
  pointsLayer   : null,  // GeoJSON sampling points
  alarmLayer    : null,  // alarm highlight circles
  rasterOpacity : 0.6,
  geoData       : [],    // raw GeoJSON features
  filteredData  : [],    // after date/index filter
  mlData        : null,  // predictions.json
  timeSeriesData: null,  // timeseries.json
};

/* ── COLOUR HELPERS ──────────────────────────────────── */
/**
 * Returns a colour for an EC value using a green→amber→red scale.
 * Low: EC < 2  |  Moderate: 2–4  |  High: > 4
 */
/**
 * INDEX COLOUR RULES
 * Each index has 3 classes: [threshold1, threshold2, color1, color2, color3]
 * color1 = below threshold1, color2 = between, color3 = above threshold2
 * Matches the LEGENDS object exactly.
 */
const INDEX_COLOR_RULES = {
  EC  : { t: [8, 14],    c: ['#3fb950','#e3b341','#f85149'] },  // low / moderate / high salinity
  TDS : { t: [3, 7],     c: ['#3fb950','#e3b341','#f85149'] },  // brackish / saline / hypersaline
  NDVI: { t: [0.15,0.25],c: ['#f85149','#e3b341','#3fb950'] },  // bare / sparse / moderate (inverted)
  NDWI: { t: [-0.3,-0.2],c: ['#f85149','#e3b341','#388bfd'] },  // very dry / dry / moist
  SI5 : { t: [0.28,0.35],c: ['#3fb950','#e3b341','#f85149'] },  // low / moderate / high salinity
  S1  : { t: [-15,-13],  c: ['#9ecae1','#969696','#252525'] },  // moist / moderate / dry-rough
};

/**
 * Return a CSS color for a given index and its value.
 * Falls back to EC rules if index is unknown.
 */
function indexColor(index, value) {
  if (value === null || value === undefined || isNaN(value)) return '#8b949e';
  const rule = INDEX_COLOR_RULES[index] || INDEX_COLOR_RULES.EC;
  if (value < rule.t[0]) return rule.c[0];
  if (value < rule.t[1]) return rule.c[1];
  return rule.c[2];
}

/** Classify EC into Low / Moderate / High (used for alarm table & badge) */
function ecColor(ec) {
  return indexColor('EC', ec);
}

/** Generic colour ramp (kept for any callers that still use it) */
function rampColor(val, colors) {
  colors = colors || ['#3fb950', '#e3b341', '#f85149'];
  const n = colors.length - 1;
  const t = Math.max(0, Math.min(1, val));
  const idx = Math.floor(t * n);
  return colors[Math.min(idx, n)];
}

/* ── NAVIGATION ──────────────────────────────────────── */
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-section]');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      switchSection(section);
      // Close mobile sidebar
      closeMobileSidebar();
    });
  });
}

function switchSection(section) {
  AppState.activeSection = section;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const active = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (active) active.classList.add('active');

  // Update sections
  document.querySelectorAll('.dashboard-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.add('active');

  // Update header breadcrumb
  const titles = {
    overview     : 'Dashboard Overview',
    map          : 'Field Map',
    timeseries   : 'Time Series Analysis',
    indices      : 'Remote Sensing Indices',
    interpolation: 'Interpolation Maps',
    ml           : 'AI Predictions',
    alerts       : 'Alarm Points',
  };
  document.getElementById('pageTitle').textContent = titles[section] || section;

  // Lazy-init map when its tab is activated
  if (section === 'map' && !AppState.map) {
    initMap();
  } else if (section === 'map' && AppState.map) {
    // Leaflet needs resize event after becoming visible
    setTimeout(() => AppState.map.invalidateSize(), 100);
  }
}

/* ── SIDEBAR TOGGLE ──────────────────────────────────── */
function initSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const mainContent = document.getElementById('mainContent');
  const toggleBtn   = document.getElementById('sidebarToggle');
  const mobileBtn   = document.getElementById('mobileMenuBtn');

  // Desktop collapse
  toggleBtn.addEventListener('click', () => {
    AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
    sidebar.classList.toggle('collapsed', AppState.sidebarCollapsed);
    mainContent.classList.toggle('expanded', AppState.sidebarCollapsed);
    if (AppState.map) setTimeout(() => AppState.map.invalidateSize(), 300);
  });

  // Mobile open
  mobileBtn.addEventListener('click', openMobileSidebar);

  // Add backdrop element
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebarBackdrop';
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', closeMobileSidebar);
}

function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebarBackdrop').classList.add('visible');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop').classList.remove('visible');
}

/* ── THEME TOGGLE ────────────────────────────────────── */
function initTheme() {
  const btn  = document.getElementById('themeToggle');
  const icon = document.getElementById('themeIcon');
  // Default is light mode — icon shows moon (click → go dark)
  icon.className = 'fas fa-moon';
  btn.addEventListener('click', () => {
    const html = document.documentElement;
    const isDark = html.dataset.theme === 'dark';
    html.dataset.theme = isDark ? 'light' : 'dark';
    icon.className = isDark ? 'fas fa-moon' : 'fas fa-sun';
    // Update chart backgrounds after theme switch
    if (window.ChartsModule) ChartsModule.refreshTheme();
  });
}

/* ══════════════════════════════════════════════════════
   LEAFLET MAP
══════════════════════════════════════════════════════ */
function initMap() {
  /* Base tile layers */
  const osmLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxZoom: 19 }
  );
  const satLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri', maxZoom: 19 }
  );
  const terrainLayer = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenTopoMap', maxZoom: 17 }
  );

  AppState.baseLayers = { osm: osmLayer, satellite: satLayer, terrain: terrainLayer };

  /* Create map — default center: Tunisia */
  AppState.map = L.map('map', {
    center: [36.72, 10.49],
    zoom: 16,
    layers: [osmLayer],
    zoomControl: true,
  });

  /* Base layer switcher */
  document.getElementById('baseLayerControl').addEventListener('click', e => {
    const btn = e.target.closest('.btn-filter');
    if (!btn) return;
    const base = btn.dataset.base;
    if (!base) return;
    document.querySelectorAll('#baseLayerControl .btn-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(AppState.baseLayers).forEach(l => AppState.map.removeLayer(l));
    AppState.baseLayers[base].addTo(AppState.map);
    AppState.activeBase = base;
  });

  /* Opacity slider */
    document.getElementById('rasterOpacity').addEventListener('input', e => {
    AppState.rasterOpacity = e.target.value / 100;

    Object.values(AppState.overlayLayers).forEach(layer => {
        if (layer.setOpacity) {
        layer.setOpacity(AppState.rasterOpacity);
        }
    });
    });
  /* Overlay checkboxes */
  initOverlayCheckboxes();

  /* Load GeoJSON points on map */
  renderMapPoints(AppState.filteredData);

  /* Info panel close */
  document.getElementById('infoPanelClose').addEventListener('click', () => {
    document.getElementById('mapInfoPanel').classList.remove('visible');
  });

  /* Update map legend for selected index */
  updateMapLegend(AppState.selectedIndex);
}

/* ── OVERLAY CHECKBOXES ──────────────────────────────── */
function initOverlayCheckboxes() {
    const rasterCheckboxes = [
    { id: 'overlayEC',   layer: 'EC',   src: 'images/EC.png' },
    { id: 'overlayTDS',  layer: 'TDS',  src: 'images/TDS.png' },
    { id: 'overlayNDVI', layer: 'NDVI', src: 'images/NDVI.png' },
    { id: 'overlayNDWI', layer: 'NDWI', src: 'images/NDWI.png' },
    { id: 'overlaySI5',  layer: 'SI5',  src: 'images/SI5.png' },
    { id: 'overlayS1',   layer: 'S1',   src: 'images/S1.png' },
    ];

  rasterCheckboxes.forEach(({ id, layer, src }) => {
    const cb = document.getElementById(id);
    if (!cb) return;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        addRasterOverlay(layer, src);
      } else {
        removeRasterOverlay(layer);
      }
    });
    // Load EC by default
    if (id === 'overlayEC' && cb.checked) addRasterOverlay(layer, src);
  });

  // Points checkbox
  const ptsCB = document.getElementById('overlayPoints');
  ptsCB && ptsCB.addEventListener('change', () => {
    if (ptsCB.checked) {
      if (AppState.pointsLayer) AppState.map.addLayer(AppState.pointsLayer);
    } else {
      if (AppState.pointsLayer) AppState.map.removeLayer(AppState.pointsLayer);
    }
  });

  // Alarms checkbox
  const almCB = document.getElementById('overlayAlarms');
  almCB && almCB.addEventListener('change', () => {
    if (almCB.checked) {
      if (AppState.alarmLayer) AppState.map.addLayer(AppState.alarmLayer);
    } else {
      if (AppState.alarmLayer) AppState.map.removeLayer(AppState.alarmLayer);
    }
  });
}

/**
 * Add a PNG raster image overlay to the Leaflet map.
 * The bounds MUST match your exported raster's geographic extent.
 * UPDATE these coordinates to match your actual QGIS export bounds!
 */
function addRasterOverlay(layerName, src) {
  removeRasterOverlay(layerName);

  // IMPORTANT:
  // These bounds MUST match your QGIS export extent (EPSG:4326)
  // Format: [[southWest_lat, southWest_lng], [northEast_lat, northEast_lng]]

    const boundsMap = {

    EC: [
        [36.72106305103069, 10.49298094697381],
        [36.72248718416699, 10.49437549285659]
    ],

    TDS: [
        [36.72106305103069, 10.49298094697381],
        [36.72248718416699, 10.49437549285659]
    ],

    NDVI: [
        [36.72106305103069, 10.49298094697381],
        [36.72248718416699, 10.49437549285659]
    ],

    NDWI: [
        [36.72106305103069, 10.49298094697381],
        [36.72248718416699, 10.49437549285659]
    ],

    SI5: [
        [36.72106305103069, 10.49298094697381],
        [36.72248718416699, 10.49437549285659]
    ],

    S1: [
        [36.72106305103069, 10.49298094697381],
        [36.72248718416699, 10.49437549285659]
    ]
    };

  const bounds = boundsMap[layerName];

  const layer = L.imageOverlay(src, bounds, {
    opacity: AppState.rasterOpacity,
    interactive: false,
    crossOrigin: true
  });

  layer.addTo(AppState.map);
  AppState.overlayLayers[layerName] = layer;
}

function removeRasterOverlay(layerName) {
  const layer = AppState.overlayLayers[layerName];
  if (layer) {
    AppState.map.removeLayer(layer);
    delete AppState.overlayLayers[layerName];
  }
}

/* ── RENDER MAP POINTS ───────────────────────────────── */
function renderMapPoints(features) {
  if (!AppState.map) return;

  // Remove existing layers
  if (AppState.pointsLayer) AppState.map.removeLayer(AppState.pointsLayer);
  if (AppState.alarmLayer)  AppState.map.removeLayer(AppState.alarmLayer);

  if (!features || features.length === 0) return;

  const alarmCircles = [];
  const idx = AppState.selectedIndex || 'EC';

  // Build GeoJSON layer with dynamic index-colored markers
  AppState.pointsLayer = L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      pointToLayer(feature, latlng) {
        const p     = feature.properties;
        const val   = parseFloat(p[idx]);
        const color = indexColor(idx, val);
        const label = p.Sampling || '';
        // Build inline-styled marker so color works without CSS class
        const html  = `<div class="custom-marker" style="background:${color};border-color:rgba(255,255,255,0.7)" `
                    + `title="${idx}: ${isNaN(val) ? '?' : val.toFixed(3)}">${label}</div>`;
        const icon  = L.divIcon({
          className: '',
          html,
          iconSize  : [32, 32],
          iconAnchor: [16, 16],
        });
        return L.marker(latlng, { icon });
      },
      onEachFeature(feature, layer) {
        const p    = feature.properties;
        const ec   = p.EC || 0;
        const risk = classifyRisk(ec);  // alarm logic always uses EC

        // Leaflet popup
        layer.bindPopup(buildPopupHTML(p, risk), { maxWidth: 260 });

        // Click → info panel
        layer.on('click', () => showInfoPanel(p, risk));

        // Collect high/moderate (EC-based) for alarm layer
        if (risk === 'High' || risk === 'Moderate') {
          const latlng = layer.getLatLng();
          alarmCircles.push({ latlng, risk, props: p });
        }
      },
    }
  );

  AppState.pointsLayer.addTo(AppState.map);

  // Alarm highlight layer (pulsing circles for high risk)
  const alarmGroup = L.layerGroup();
  alarmCircles.forEach(({ latlng, risk, props }) => {
    const color = risk === 'High' ? '#f85149' : '#e3b341';
    L.circle(latlng, {
      radius: 600,
      color, fillColor: color,
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '5,5',
    }).bindPopup(buildPopupHTML(props, risk))
      .addTo(alarmGroup);
  });

  AppState.alarmLayer = alarmGroup;

  // Check "show alarms" checkbox
  const almCB = document.getElementById('overlayAlarms');
  if (almCB && almCB.checked) AppState.alarmLayer.addTo(AppState.map);

  // Fit map to points
  try {
    const bounds = AppState.pointsLayer.getBounds();
    if (bounds.isValid()) AppState.map.fitBounds(bounds, { padding: [40, 40] });
  } catch(e) { /* no valid bounds */ }
}

function buildPopupHTML(p, risk) {
  return `
    <div class="popup-title">
      Point ${p.Sampling || '?'}
      <span class="risk-badge risk-${risk}">${risk}</span>
    </div>
    <div class="popup-grid">
      <div class="popup-row"><span class="popup-key">Date</span></div>
      <div class="popup-row"><span class="popup-val">${p.Date || '—'}</span></div>
      <div class="popup-row"><span class="popup-key">EC</span></div>
      <div class="popup-row"><span class="popup-val">${formatVal(p.EC)} dS/m</span></div>
      <div class="popup-row"><span class="popup-key">TDS</span></div>
      <div class="popup-row"><span class="popup-val">${formatVal(p.TDS)} mg/L</span></div>
      <div class="popup-row"><span class="popup-key">NDVI</span></div>
      <div class="popup-row"><span class="popup-val">${formatVal(p.NDVI, 3)}</span></div>
      <div class="popup-row"><span class="popup-key">NDWI</span></div>
      <div class="popup-row"><span class="popup-val">${formatVal(p.NDWI, 3)}</span></div>
      <div class="popup-row"><span class="popup-key">SI5</span></div>
      <div class="popup-row"><span class="popup-val">${formatVal(p.SI5, 3)}</span></div>
      <div class="popup-row"><span class="popup-key">S1</span></div>
      <div class="popup-row"><span class="popup-val">${formatVal(p.S1, 3)}</span></div>
    </div>`;
}

function showInfoPanel(props, risk) {
  const panel = document.getElementById('mapInfoPanel');
  const body  = document.getElementById('infoPanelBody');
  body.innerHTML = `
    <div class="info-row"><span class="info-key">Sample ID</span><span class="info-val">${props.Sampling || '—'}</span></div>
    <div class="info-row"><span class="info-key">Date</span><span class="info-val">${props.Date || '—'}</span></div>
    <div class="info-row"><span class="info-key">Risk Level</span><span class="info-val"><span class="risk-badge risk-${risk}">${risk}</span></span></div>
    <div class="info-row"><span class="info-key">EC</span><span class="info-val">${formatVal(props.EC)} dS/m</span></div>
    <div class="info-row"><span class="info-key">TDS</span><span class="info-val">${formatVal(props.TDS)} mg/L</span></div>
    <div class="info-row"><span class="info-key">NDVI</span><span class="info-val">${formatVal(props.NDVI, 3)}</span></div>
    <div class="info-row"><span class="info-key">NDWI</span><span class="info-val">${formatVal(props.NDWI, 3)}</span></div>
    <div class="info-row"><span class="info-key">SI5</span><span class="info-val">${formatVal(props.SI5, 3)}</span></div>
    <div class="info-row"><span class="info-key">S1</span><span class="info-val">${formatVal(props.S1, 3)}</span></div>`;
  panel.classList.add('visible');
}

/* ── MAP LEGEND ──────────────────────────────────────── */
const LEGENDS = {
  EC  : { title: 'EC (dS/m) — FAO classes',
          items: [['#3fb950','< 8  (low)'],['#e3b341','8–14 (moderate)'],['#f85149','> 14 (high)']] },
  TDS : { title: 'TDS (g/L)',
          items: [['#3fb950','< 3  (brackish)'],['#e3b341','3–7 (saline)'],['#f85149','> 7 (hypersaline)']] },
  NDVI: { title: 'NDVI — vegetation cover',
          items: [['#f85149','< 0.15 (bare)'],['#e3b341','0.15–0.25 (sparse)'],['#3fb950','> 0.25 (moderate)']] },
  NDWI: { title: 'NDWI — soil moisture',
          items: [['#f85149','< −0.3 (very dry)'],['#e3b341','−0.3 to −0.2 (dry)'],['#388bfd','> −0.2 (moist)']] },
  SI5 : { title: 'SI5 — salinity index',
          items: [['#3fb950','< 0.28 (low)'],['#e3b341','0.28–0.35 (moderate)'],['#f85149','> 0.35 (high)']] },
  S1  : { title: 'S1 VV (dB) — backscatter',
          items: [['#9ecae1','< −15 (moist/smooth)'],['#969696','−15 to −13 (moderate)'],['#252525','> −13 (dry/rough)']] },
};

function updateMapLegend(index) {
  const cfg = LEGENDS[index] || LEGENDS.EC;
  document.getElementById('legendTitle').textContent = cfg.title;
  const scaleEl = document.getElementById('legendScale');
  scaleEl.innerHTML = cfg.items.map(([color, label]) =>
    `<div class="legend-item-row">
       <div class="legend-swatch" style="background:${color}"></div>
       <span>${label}</span>
     </div>`
  ).join('');
}

/* ── INTERPOLATION PAGE — "Load on Map" ──────────────── */
function initInterpButtons() {
  document.querySelectorAll('.btn-load-overlay').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      const src   = btn.dataset.src;
      // Switch to map section
      switchSection('map');
      if (!AppState.map) {
        // Wait for map init
        setTimeout(() => { addRasterOverlay(layer, src); syncOverlayCheckbox(layer, true); }, 400);
      } else {
        addRasterOverlay(layer, src);
        syncOverlayCheckbox(layer, true);
      }
    });
  });
}

function syncOverlayCheckbox(layer, state) {

  const map = {
    EC:   'overlayEC',
    TDS:  'overlayTDS',
    NDVI: 'overlayNDVI',
    NDWI: 'overlayNDWI',
    SI5:  'overlaySI5',
    S1:   'overlayS1'
  };

  const cb = document.getElementById(map[layer]);

  if (cb) cb.checked = state;
}

/* ══════════════════════════════════════════════════════
   DATA LOADING
══════════════════════════════════════════════════════ */

/**
 * Load GeoJSON file (from QGIS export).
 * Falls back to embedded demo data if file is not found.
 */
async function loadGeoJSON() {
  let features;

  try {
    const resp = await fetch('data/points.geojson');
    if (!resp.ok) throw new Error('not found');

    const geojson = await resp.json();
    features = geojson.features || [];

    console.info(`[GeoJSON] Loaded ${features.length} features`);
  } catch {
    console.warn('[GeoJSON] Using demo data');
    features = DEMO_GEOJSON.features;
  }

  // ✅ APPLY CLEANING HERE
  const cleaned = cleanFeatures(features);

  // DEDUPLICATE TO 9 UNIQUE POINTS
  // classified_points.json has 18 rows (9 points x 2 field dates).
  // Stat cards, alarm table, map markers and ML counts need exactly 1 row per point.
  const latestByPoint = {};
  cleaned.forEach(f => {
    const id   = f.properties.Sampling;
    const date = f.properties.Date || '';
    if (!latestByPoint[id] || date > latestByPoint[id].properties.Date) {
      latestByPoint[id] = f;
    }
  });
  AppState.geoData     = Object.values(latestByPoint)
                           .sort((a, b) => a.properties.Sampling.localeCompare(b.properties.Sampling));
  AppState.geoDataFull = cleaned; // full 18-row set (both dates), used by overview chart
}

/**
 * Load time-series JSON (from Google Earth Engine export).
 */
async function loadTimeSeries() {
  try {
    const resp = await fetch('data/timeseries.json');
    if (!resp.ok) throw new Error('not found');

    const data = await resp.json();

    // Expect a flat array of records with Date, Sampling, NDVI, NDWI, SI5, S1 fields
    if (!Array.isArray(data) || data.length === 0) throw new Error('Invalid TS format');
    if (!('Date' in data[0])) throw new Error('Missing Date field in TS records');

    AppState.timeSeriesData = data;

    console.info(`[TimeSeries] Loaded ${data.length} records`);
  } catch (err) {
    console.warn('[TimeSeries] Using demo data —', err.message);
    AppState.timeSeriesData = DEMO_TIMESERIES_ARRAY;
  }
}

/* ══════════════════════════════════════════════════════
   STATS CARDS
══════════════════════════════════════════════════════ */
function updateStatCards(features) {
  const vals = (key) => features.map(f => f.properties[key]).filter(v => v !== null && v !== undefined && !isNaN(v));
  const avg  = (arr) => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;

  const ec    = avg(vals('EC'));
  const tds   = avg(vals('TDS'));
  const ndvi  = avg(vals('NDVI'));
  const ndwi  = avg(vals('NDWI'));
  const si5   = avg(vals('SI5'));
  const alarms = features.filter(f => classifyRisk(f.properties.EC) === 'High').length;

  setText('statEC',    ec    !== null ? ec.toFixed(2)   : '—');
  setText('statTDS',   tds   !== null ? tds.toFixed(0)  : '—');
  setText('statNDVI',  ndvi  !== null ? ndvi.toFixed(3) : '—');
  setText('statNDWI',  ndwi  !== null ? ndwi.toFixed(3) : '—');
  setText('statSI5',   si5   !== null ? si5.toFixed(3)  : '—');
  setText('statAlarms', alarms);

  // Trends (demo: compare May vs July averages)
  setTrend('trendEC',    ec,    2.5,  'dS/m', true);
  setTrend('trendTDS',   tds,   1600, 'mg/L', true);
  setTrend('trendNDVI',  ndvi,  0.3,  '',     false);
  setTrend('trendNDWI',  ndwi,  0,    '',     false);
  setTrend('trendSI5',   si5,   0.3,  '',     true);

  // Update alarm badge in sidebar
  const badge = document.getElementById('alarmBadge');
  if (badge) badge.textContent = alarms;
}

function setTrend(id, val, baseline, unit, highIsBad) {
  if (val === null) return;
  const el = document.getElementById(id);
  if (!el) return;
  const diff = val - baseline;
  const isUp = diff > 0;
  const isBad = highIsBad ? isUp : !isUp;
  const cls = isBad ? 'trend-up' : 'trend-down';
  const arrow = isUp ? '▲' : '▼';
  el.className = `stat-trend ${cls}`;
  el.textContent = `${arrow} ${Math.abs(diff).toFixed(2)}${unit} vs baseline`;
}

/* ══════════════════════════════════════════════════════
   MAIN INIT
══════════════════════════════════════════════════════ */
async function init() {
  initNavigation();
  initSidebar();
  initTheme();
  initFilters();          // from filters.js
  initInterpButtons();

  // Load data
  await loadGeoJSON();
  await loadTimeSeries();

  // Apply default filters
  // Filter geoDataFull (18 rows) by date, then deduplicate to 9 unique points.
  // This ensures May filter shows May data, July shows July data, All shows latest.
  const _full = AppState.geoDataFull || AppState.geoData;
  const _filtered = FilterModule?.applyFilters
    ? FilterModule.applyFilters(_full, AppState.selectedDate)
    : _full;
  AppState.filteredData = FilterModule?.deduplicateToLatest
    ? FilterModule.deduplicateToLatest(_filtered)
    : _filtered;

  // Render stat cards
  updateStatCards(AppState.filteredData);

  // Render charts
  ChartsModule.initOverviewChart(AppState.filteredData);
  ChartsModule.initRiskDonut(AppState.filteredData);
  ChartsModule.initTimeSeriesCharts(AppState.timeSeriesData);
  ChartsModule.initIndicesCharts(AppState.filteredData);

  // ML / predictions
  await MLModule.loadPredictions();
  MLModule.renderMLSection();
  MLModule.buildAlarmTable(AppState.filteredData);

  // Index selector updates legend
  document.getElementById('indexSelect').addEventListener('change', e => {
    AppState.selectedIndex = e.target.value;
    updateMapLegend(AppState.selectedIndex);
    ChartsModule.updateOverviewChart(AppState.filteredData, AppState.selectedIndex);
    // Re-render map markers with new index colors
    if (AppState.map) renderMapPoints(AppState.filteredData);
  });

  // Update date label
  document.getElementById('lastUpdated').textContent = 'Last sync: Jul 2025';
}

/* DOM ready */
document.addEventListener('DOMContentLoaded', init);

/* ══════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════ */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatVal(v, dec = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Number(v).toFixed(dec);
}

/** Classify EC value into Low / Moderate / High */
function classifyRisk(ec) {
  if (!ec && ec !== 0) return 'Low';
  if (ec < 8)  return 'Low';       // FAO: non-saline to slightly saline
  if (ec < 14) return 'Moderate';  // FAO: moderately saline
  return 'High';                   // FAO: strongly/very strongly saline
}

/* ══════════════════════════════════════════════════════
   DEMO DATA — used when JSON files are absent
   Replace with your real GeoJSON / JSON exports
══════════════════════════════════════════════════════ */
const DEMO_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    // ── May 2025 points ──────────────────────────────────
    { type:'Feature', geometry:{type:'Point',coordinates:[9.12,34.22]}, properties:{Sampling:'P01',Date:'2025-05-10',EC:1.4,TDS:896,NDVI:0.42,NDWI:0.12,SI5:0.18,S1:0.11} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.25,34.18]}, properties:{Sampling:'P02',Date:'2025-05-10',EC:2.8,TDS:1792,NDVI:0.31,NDWI:0.05,SI5:0.29,S1:0.17} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.38,34.30]}, properties:{Sampling:'P03',Date:'2025-05-10',EC:5.2,TDS:3328,NDVI:0.18,NDWI:-0.08,SI5:0.51,S1:0.32} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.02,34.35]}, properties:{Sampling:'P04',Date:'2025-05-10',EC:3.7,TDS:2368,NDVI:0.22,NDWI:-0.03,SI5:0.38,S1:0.24} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.55,34.10]}, properties:{Sampling:'P05',Date:'2025-05-10',EC:1.1,TDS:704,NDVI:0.50,NDWI:0.18,SI5:0.14,S1:0.08} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.18,34.40]}, properties:{Sampling:'P06',Date:'2025-05-10',EC:6.8,TDS:4352,NDVI:0.09,NDWI:-0.15,SI5:0.62,S1:0.41} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.32,34.05]}, properties:{Sampling:'P07',Date:'2025-05-10',EC:2.2,TDS:1408,NDVI:0.37,NDWI:0.08,SI5:0.24,S1:0.14} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.45,34.25]}, properties:{Sampling:'P08',Date:'2025-05-10',EC:4.1,TDS:2624,NDVI:0.20,NDWI:-0.06,SI5:0.44,S1:0.28} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.08,34.15]}, properties:{Sampling:'P09',Date:'2025-05-10',EC:0.9,TDS:576,NDVI:0.55,NDWI:0.22,SI5:0.11,S1:0.07} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.42,34.38]}, properties:{Sampling:'P10',Date:'2025-05-10',EC:3.3,TDS:2112,NDVI:0.27,NDWI:0.01,SI5:0.34,S1:0.22} },
    // ── July 2025 points ─────────────────────────────────
    { type:'Feature', geometry:{type:'Point',coordinates:[9.12,34.22]}, properties:{Sampling:'P01',Date:'2025-07-15',EC:1.8,TDS:1152,NDVI:0.38,NDWI:0.09,SI5:0.21,S1:0.13} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.25,34.18]}, properties:{Sampling:'P02',Date:'2025-07-15',EC:3.4,TDS:2176,NDVI:0.26,NDWI:0.01,SI5:0.34,S1:0.21} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.38,34.30]}, properties:{Sampling:'P03',Date:'2025-07-15',EC:6.1,TDS:3904,NDVI:0.14,NDWI:-0.12,SI5:0.58,S1:0.38} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.02,34.35]}, properties:{Sampling:'P04',Date:'2025-07-15',EC:4.3,TDS:2752,NDVI:0.19,NDWI:-0.05,SI5:0.43,S1:0.27} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.55,34.10]}, properties:{Sampling:'P05',Date:'2025-07-15',EC:1.4,TDS:896,NDVI:0.46,NDWI:0.15,SI5:0.17,S1:0.10} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.18,34.40]}, properties:{Sampling:'P06',Date:'2025-07-15',EC:7.9,TDS:5056,NDVI:0.06,NDWI:-0.20,SI5:0.70,S1:0.48} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.32,34.05]}, properties:{Sampling:'P07',Date:'2025-07-15',EC:2.7,TDS:1728,NDVI:0.32,NDWI:0.06,SI5:0.28,S1:0.18} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.45,34.25]}, properties:{Sampling:'P08',Date:'2025-07-15',EC:5.0,TDS:3200,NDVI:0.16,NDWI:-0.10,SI5:0.50,S1:0.33} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.08,34.15]}, properties:{Sampling:'P09',Date:'2025-07-15',EC:1.2,TDS:768,NDVI:0.51,NDWI:0.20,SI5:0.13,S1:0.09} },
    { type:'Feature', geometry:{type:'Point',coordinates:[9.42,34.38]}, properties:{Sampling:'P10',Date:'2025-07-15',EC:4.0,TDS:2560,NDVI:0.23,NDWI:-0.02,SI5:0.40,S1:0.25} },
  ],
};

const DEMO_TIMESERIES_ARRAY = [
  { Date: '2016-06-01', Sampling: 'plot1', NDVI: 0.24, NDWI: -0.28, SI5: 0.34, S1: -11.71 },
  { Date: '2016-06-01', Sampling: 'plot2', NDVI: 0.18, NDWI: -0.33, SI5: 0.40, S1: -12.10 },
  { Date: '2017-06-01', Sampling: 'plot1', NDVI: 0.27, NDWI: -0.25, SI5: 0.31, S1: -11.20 },
  { Date: '2017-06-01', Sampling: 'plot2', NDVI: 0.20, NDWI: -0.30, SI5: 0.37, S1: -11.85 },
  { Date: '2018-06-01', Sampling: 'plot1', NDVI: 0.22, NDWI: -0.30, SI5: 0.36, S1: -11.50 },
  { Date: '2018-06-01', Sampling: 'plot2', NDVI: 0.16, NDWI: -0.35, SI5: 0.43, S1: -12.30 },
  { Date: '2019-06-01', Sampling: 'plot1', NDVI: 0.29, NDWI: -0.22, SI5: 0.29, S1: -10.90 },
  { Date: '2019-06-01', Sampling: 'plot2', NDVI: 0.23, NDWI: -0.27, SI5: 0.35, S1: -11.60 },
  { Date: '2020-06-01', Sampling: 'plot1', NDVI: 0.25, NDWI: -0.26, SI5: 0.33, S1: -11.40 },
  { Date: '2020-06-01', Sampling: 'plot2', NDVI: 0.19, NDWI: -0.31, SI5: 0.39, S1: -12.00 },
];

// Legacy shape kept for reference — no longer used by initTimeSeriesCharts
const DEMO_TIMESERIES = {
  months : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'],
  EC     : [1.8, 2.0, 2.3, 2.8, 3.2, 3.5, 3.9, 4.1],
  TDS    : [1152,1280,1472,1792,2048,2240,2496,2624],
  NDVI   : [0.42,0.40,0.37,0.33,0.29,0.26,0.23,0.21],
  NDWI   : [0.08,0.06,0.04,0.01,-0.02,-0.06,-0.10,-0.13],
  SI5    : [0.18,0.21,0.24,0.28,0.32,0.36,0.42,0.46],
  S1     : [0.11,0.13,0.15,0.18,0.21,0.24,0.27,0.30],
};
function cleanFeatures(features) {
  return features.map(f => {

    const coords = f.geometry.coordinates;

    return {
      ...f,

      // KEEP GEOJSON FORMAT = [lng, lat]
      geometry: {
        ...f.geometry,
        coordinates: [
          parseFloat(coords[0]),
          parseFloat(coords[1])
        ]
      },

      properties: {
        ...f.properties,

        EC:   parseFloat(f.properties.EC),
        TDS:  parseFloat(f.properties.TDS),
        NDVI: parseFloat(f.properties.NDVI),
        NDWI: parseFloat(f.properties.NDWI),
        SI5:  parseFloat(f.properties.SI5),
        S1:   parseFloat(f.properties.S1),
      }
    };
  });
}