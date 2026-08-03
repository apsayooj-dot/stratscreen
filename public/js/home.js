// home.js - renders the 3 index charts (with 1D/1W/1M/6M/1Y/5Y/Max timeframe
// tabs) and the stock search + detail panel (with its own price chart).

let STOCK_DATA = null;
let INDEX_DATA = null;
const INDEX_CHARTS = {}; // key -> Chart.js instance
const INDEX_RANGE = { nifty50: "1d", sensex: "1d", banknifty: "1d" };
let STOCK_CHART = null;
let STOCK_CHART_RANGE = "1y";

const RANGE_LABELS = { "1d": "1D", "1w": "1W", "1m": "1M", "6m": "6M", "1y": "1Y", "5y": "5Y", max: "Max" };
const INTRADAY_RANGES = new Set(["1d", "1w"]);

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load " + url);
  return res.json();
}

function fmtLabel(point, rangeKey) {
  const d = new Date(point.t * 1000);
  if (INTRADAY_RANGES.has(rangeKey)) {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  if (rangeKey === "max") {
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function pctChangeFromPoints(points) {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1].c;
  const first = points[0].c;
  return ((last - first) / first) * 100;
}

function renderIndexCard(key, series, color) {
  const valueEl = document.getElementById(`${key}-value`);
  const changeEl = document.getElementById(`${key}-change`);
  const canvas = document.getElementById(`${key}-chart`);
  const rangeKey = INDEX_RANGE[key];
  const points = series && series[rangeKey];

  if (!points || !points.length) {
    valueEl.textContent = "No data yet";
    changeEl.textContent = "";
    return;
  }

  const last = points[points.length - 1];
  const change = pctChangeFromPoints(points);
  valueEl.textContent = last.c.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (change !== null) {
    changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}% (${RANGE_LABELS[rangeKey]})`;
    changeEl.className = "index-change " + (change >= 0 ? "positive" : "negative");
  } else {
    changeEl.textContent = "";
  }

  if (INDEX_CHARTS[key]) {
    INDEX_CHARTS[key].destroy();
  }
  INDEX_CHARTS[key] = new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => fmtLabel(p, rangeKey)),
      datasets: [
        {
          data: points.map((p) => p.c),
          borderColor: color,
          backgroundColor: color + "22",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

function wireRangeTabs() {
  document.querySelectorAll(".range-tabs[data-index]").forEach((wrap) => {
    const key = wrap.getAttribute("data-index");
    wrap.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        INDEX_RANGE[key] = btn.getAttribute("data-range");
        wrap.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        renderIndexCard(key, INDEX_DATA.series[key], colorFor(key));
      });
    });
  });
}

function colorFor(key) {
  return { nifty50: "#1d4ed8", sensex: "#059669", banknifty: "#d97706" }[key] || "#1d4ed8";
}

async function initIndices() {
  try {
    INDEX_DATA = await loadJson("data/indices.json");
    document.getElementById("indices-updated").textContent = "Updated " + INDEX_DATA.updated;
    renderIndexCard("nifty50", INDEX_DATA.series.nifty50, colorFor("nifty50"));
    renderIndexCard("sensex", INDEX_DATA.series.sensex, colorFor("sensex"));
    renderIndexCard("banknifty", INDEX_DATA.series.banknifty, colorFor("banknifty"));
    wireRangeTabs();
  } catch (err) {
    document.getElementById("indices-updated").textContent = "Index data unavailable right now.";
  }
}

function stockSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q || !STOCK_DATA) return [];
  return STOCK_DATA.stocks
    .filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        (s.name || "").toLowerCase().includes(q)
    )
    .slice(0, 15);
}

function renderSearchResults(list) {
  const wrap = document.getElementById("search-results");
  if (!list.length) {
    wrap.classList.remove("open");
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = list
    .map(
      (s) => `
    <div class="search-result-item" data-symbol="${s.symbol}">
      <strong>${s.symbol}</strong> &mdash; ${s.name}
      <br><small>${s.sector} &middot; &#8377;${(s.price || 0).toLocaleString("en-IN")}</small>
    </div>
  `
    )
    .join("");
  wrap.classList.add("open");
  wrap.querySelectorAll(".search-result-item").forEach((el) => {
    el.addEventListener("click", () => {
      showStockDetail(el.getAttribute("data-symbol"));
      wrap.classList.remove("open");
      document.getElementById("stock-search").value = el.getAttribute("data-symbol");
    });
  });
}

function fmtNum(v) {
  if (v === null || v === undefined) return "&ndash;";
  return typeof v === "number" ? v.toLocaleString("en-IN") : v;
}

function financialsTable(rows, cols) {
  if (!rows || !rows.length) {
    return `<p style="color:var(--text-muted);font-size:0.88rem;">No data available for this period.</p>`;
  }
  const head = cols.map((c) => `<th>${c.label}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => `<td>${c.key === "period" ? r[c.key] : fmtNum(r[c.key])}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<div class="financials-scroll"><table class="financials"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderStockChart(stock) {
  const canvas = document.getElementById("stock-chart");
  if (!canvas) return;
  const points = stock.charts && stock.charts[STOCK_CHART_RANGE];
  if (STOCK_CHART) {
    STOCK_CHART.destroy();
    STOCK_CHART = null;
  }
  if (!points || !points.length) return;
  STOCK_CHART = new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => fmtLabel(p, STOCK_CHART_RANGE === "5y" || STOCK_CHART_RANGE === "max" ? "max" : "6m")),
      datasets: [
        {
          data: points.map((p) => p.c),
          borderColor: "#1d4ed8",
          backgroundColor: "#1d4ed822",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: true, ticks: { font: { size: 10 } } } },
    },
  });
}

function wireStockRangeTabs(stock) {
  document.querySelectorAll(".range-tabs[data-stock-chart] button").forEach((btn) => {
    btn.addEventListener("click", () => {
      STOCK_CHART_RANGE = btn.getAttribute("data-range");
      document
        .querySelectorAll(".range-tabs[data-stock-chart] button")
        .forEach((b) => b.classList.toggle("active", b === btn));
      renderStockChart(stock);
    });
  });
}

function showStockDetail(symbol) {
  const s = STOCK_DATA.stocks.find((x) => x.symbol === symbol);
  const wrap = document.getElementById("stock-detail");
  if (!s) {
    wrap.innerHTML = `<div class="stock-detail-card"><p class="empty-hint">Stock not found.</p></div>`;
    return;
  }

  const quarterlyCols = [
    { key: "period", label: "Quarter" },
    { key: "revenue", label: "Revenue (Cr)" },
    { key: "net_profit", label: "Net Profit (Cr)" },
    { key: "opm_pct", label: "OPM %" },
  ];
  const yearlyCols = [
    { key: "period", label: "Year" },
    { key: "revenue", label: "Revenue (Cr)" },
    { key: "net_profit", label: "Net Profit (Cr)" },
  ];

  const quarterly = (s.quarterly || []).slice(-8);
  const yearly = (s.yearly || []).slice(-5);
  const hasCharts = s.charts && Object.keys(s.charts).some((k) => (s.charts[k] || []).length);
  STOCK_CHART_RANGE = "1y";

  const dayChange =
    s.day_change_pct !== undefined && s.day_change_pct !== null
      ? `<span class="${s.day_change_pct >= 0 ? "positive" : "negative"}" style="font-size:0.9rem;font-weight:600;margin-left:8px;">${
          s.day_change_pct >= 0 ? "+" : ""
        }${s.day_change_pct.toFixed(2)}% today</span>`
      : "";

  wrap.innerHTML = `
    <div class="stock-detail-card">
      <h2>${s.symbol} <small style="font-weight:400;color:var(--text-muted);">${s.name}</small></h2>
      <div class="sub">${s.sector} &middot; <a href="${s.screener_url}" target="_blank" rel="noopener">screener.in &#8594;</a></div>

      <div class="ratio-grid">
        <div class="ratio-item"><div class="label">Price</div><div class="value">&#8377;${fmtNum(s.price)}${dayChange}</div></div>
        <div class="ratio-item"><div class="label">Market Cap</div><div class="value">&#8377;${fmtNum(s.market_cap_cr)} Cr</div></div>
        <div class="ratio-item"><div class="label">P/E</div><div class="value">${fmtNum(s.pe)}</div></div>
        <div class="ratio-item"><div class="label">ROE</div><div class="value">${fmtNum(s.roe)}%</div></div>
        <div class="ratio-item"><div class="label">ROCE</div><div class="value">${fmtNum(s.roce)}%</div></div>
        <div class="ratio-item"><div class="label">3Y Profit Growth</div><div class="value">${fmtNum(s.profit_growth_3y)}%</div></div>
        <div class="ratio-item"><div class="label">3Y Sales Growth</div><div class="value">${fmtNum(s.sales_growth_3y)}%</div></div>
        <div class="ratio-item"><div class="label">3Y Price CAGR</div><div class="value">${fmtNum(s.price_cagr_3y)}%</div></div>
      </div>

      ${
        hasCharts
          ? `
      <div class="section-label">Price chart</div>
      <div class="range-tabs" data-stock-chart>
        <button data-range="1m">1M</button>
        <button data-range="6m">6M</button>
        <button data-range="1y" class="active">1Y</button>
        <button data-range="5y">5Y</button>
        <button data-range="max">Max</button>
      </div>
      <div class="stock-chart-wrap"><canvas id="stock-chart"></canvas></div>
      `
          : ""
      }

      <div class="section-label">Quarterly performance (last ${quarterly.length || 0} quarters)</div>
      ${financialsTable(quarterly, quarterlyCols)}

      <div class="section-label">Yearly performance (last ${yearly.length || 0} years)</div>
      ${financialsTable(yearly, yearlyCols)}

      <div class="section-label">Strategy fit</div>
      <span class="pill ${s.strategies.value ? "yes" : "no"}">Value ${s.strategies.value ? "✓" : ""}</span>
      <span class="pill ${s.strategies.growth ? "yes" : "no"}">Growth ${s.strategies.growth ? "✓" : ""}</span>
      <span class="pill ${s.strategies.technical ? "yes" : "no"}">Technical ${s.strategies.technical ? "✓" : ""}</span>
      <span class="pill ${s.smart_pick_qualified ? "yes" : "no"}">Smart Pick ${s.smart_pick_qualified ? "✓" : ""}</span>
      &nbsp; <a href="dashboard.html">See in Screens &#8594;</a>
    </div>
  `;

  if (hasCharts) {
    wireStockRangeTabs(s);
    renderStockChart(s);
  }
}

async function initSearch() {
  try {
    STOCK_DATA = await loadJson("data/stocks.json");
  } catch (err) {
    return;
  }
  const input = document.getElementById("stock-search");
  input.addEventListener("input", () => {
    renderSearchResults(stockSearchResults(input.value));
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) renderSearchResults(stockSearchResults(input.value));
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-card")) {
      document.getElementById("search-results").classList.remove("open");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("stock-search")) {
    initIndices();
    initSearch();
  }
});
