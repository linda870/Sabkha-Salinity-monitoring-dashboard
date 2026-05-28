/* ═══════════════════════════════════════════════════════
   filters.js · SalinityWatch Filter Module
   Handles: date filter (All / May 2025 / Jul 2025),
            index selector, reactive update of all views
════════════════════════════════════════════════════════ */

'use strict';

const FilterModule = (() => {

  /* ── APPLY DATE FILTER ─────────────────────────────
   * @param {Array}  features  - raw GeoJSON features array
   * @param {string} dateKey   - 'all' | 'YYYY-MM'
   * @returns {Array} filtered features
   */
  function applyFilters(features, dateKey) {
    if (!features || !features.length) return [];
    if (!dateKey || dateKey === 'all') return features;

    return features.filter(f => {
      const date = f.properties.Date || '';
      // Match YYYY-MM prefix (e.g. "2025-05")
      return date.startsWith(dateKey);
    });
  }

  /* ── DATE FILTER BUTTONS ───────────────────────────
   * Wires up the date filter button group in the header.
   */
  function initDateFilter() {
    const group = document.getElementById('dateFilter');
    if (!group) return;

    group.addEventListener('click', e => {
      const btn = e.target.closest('.btn-filter');
      if (!btn) return;

      const dateVal = btn.dataset.date;
      if (dateVal === AppState.selectedDate) return; // no change

      // Update active button
      group.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update state
      AppState.selectedDate = dateVal;

      // Re-filter & refresh all views
      applyAndRefresh();
    });
  }

  /* ── INDEX SELECTOR ────────────────────────────────
   * Wires up the index <select> in the header.
   */
  function initIndexSelector() {
    const sel = document.getElementById('indexSelect');
    if (!sel) return;

    sel.addEventListener('change', e => {
      AppState.selectedIndex = e.target.value;
      // Update map legend
      updateMapLegend(AppState.selectedIndex);
      // Update overview chart with new index
      ChartsModule.updateOverviewChart(AppState.filteredData, AppState.selectedIndex);
    });
  }

  /* ── APPLY FILTERS AND REFRESH ALL VIEWS ──────────
   * Central refresh function called whenever a filter changes.
   */
  function applyAndRefresh() {
    // 1. Recompute filtered dataset
    // Filter the FULL 18-row dataset (both dates), then
    // collapse to 9 unique points so counts stay correct.
    const full = AppState.geoDataFull || AppState.geoData;
    const filtered = applyFilters(full, AppState.selectedDate);
    AppState.filteredData = deduplicateToLatest(filtered);

    const data = AppState.filteredData;

    // 2. Stat cards
    updateStatCards(data);

    // 3. Overview chart
    ChartsModule.initOverviewChart(data);

    // 4. Risk donut
    ChartsModule.initRiskDonut(data);

    // 5. Indices charts
    ChartsModule.initIndicesCharts(data);

    // 6. Map points
    if (AppState.map) {
      renderMapPoints(data);
    }

    // 7. ML alarm table
    MLModule.buildAlarmTable(data);
  }

  /* ── ALERT TABLE FILTER (risk level) ──────────────
   * Separate filter within the Alarms section.
   */
  function initAlertFilters() {
    // Risk level filter buttons inside alerts section
    document.querySelectorAll('#section-alerts .btn-filter[data-risk]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#section-alerts .btn-filter[data-risk]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const risk = btn.dataset.risk;
        filterAlarmTable(risk, document.getElementById('alertSearch')?.value || '');
      });
    });

    // Search box
    const searchInput = document.getElementById('alertSearch');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        const activeRisk = document.querySelector('#section-alerts .btn-filter[data-risk].active')?.dataset.risk || 'all';
        filterAlarmTable(activeRisk, e.target.value);
      });
    }
  }

  /**
   * Filter alarm table rows by risk level and search text.
   * @param {string} risk   - 'all' | 'High' | 'Moderate'
   * @param {string} search - free text search
   */
  function filterAlarmTable(risk, search) {
    const rows = document.querySelectorAll('#alarmTableBody tr[data-risk]');
    const q = search.toLowerCase().trim();

    rows.forEach(row => {
      const rowRisk = row.dataset.risk || '';
      const text    = row.textContent.toLowerCase();
      const riskOk   = risk === 'all' || rowRisk === risk;
      const searchOk = !q || text.includes(q);
      row.style.display = riskOk && searchOk ? '' : 'none';
    });

    // Show "no results" row if everything hidden
    const visible = Array.from(rows).filter(r => r.style.display !== 'none');
    let emptyRow = document.getElementById('alarmEmptyRow');
    if (visible.length === 0) {
      if (!emptyRow) {
        emptyRow = document.createElement('tr');
        emptyRow.id = 'alarmEmptyRow';
        emptyRow.innerHTML = '<td colspan="8" class="table-empty">No matching alarm points.</td>';
        document.getElementById('alarmTableBody').appendChild(emptyRow);
      }
    } else if (emptyRow) {
      emptyRow.remove();
    }
  }

  /* ── PUBLIC INIT ───────────────────────────────── */
  function initFilters() {
    initDateFilter();
    initIndexSelector();
    initAlertFilters();
  }

  function deduplicateToLatest(features) {
    if (!features || !features.length) return [];
    const latest = {};
    features.forEach(f => {
      const id   = f.properties.Sampling;
      const date = f.properties.Date || '';
      if (!latest[id] || date > latest[id].properties.Date) {
        latest[id] = f;
      }
    });
    return Object.values(latest)
      .sort((a, b) => a.properties.Sampling.localeCompare(b.properties.Sampling));
  }

  return {
    applyFilters,
    applyAndRefresh,
    filterAlarmTable,
    deduplicateToLatest,
    initFilters,
  };
})();

/* Bind to global initFilters expected by app.js */
function initFilters() {
  FilterModule.initFilters();
}