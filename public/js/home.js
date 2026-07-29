// home.js - renders the 3 index mini-charts and the stock search + detail panel.

let STOCK_DATA = null;

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load " + url);
  return res.json();
}

function pctChange(series) {
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1].close;
  const prev = series[series.length - 2].close;
  return ((last - prev) / prev) * 100;
}

function renderIndexCard(key, label, series, color) {
  const valueEl = document.getElementById(`${key}-value`);
  const changeEl = document.getElementById(`${key}-change`);
  const canvas = document.getElementById(`${key}-chart`);
  if (!series || !series.length) {
    valueEl.textContent = "No data yet";
    changeEl.textContent = "";
    return;
  }
  const last = series[series.length - 1];
  const change = pctChange(series);
  valueEl.textContent = last.close.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (change !== null) {
    changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}% vs prev.`;
    changeEl.className = "index-change " + (change >= 0 ? "positive" : "negative");
  } else {
    changeEl.textContent = "";
  }

  new Chart(canvas, {
    type: "line",
    data: {
      labels: series.map((p) => p.date),
      datasets: [
        {
          data: series.map((p) => p.close),
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
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

async function initIndices() {
  try {
    const data = await loadJson("data/indices.json");
    document.getElementById("indices-updated").textContent = "Updated " + data.updated;
    renderIndexCard("nifty50", "Nifty 50", data.series.nifty50, "#1d4ed8");
    renderIndexCard("sensex", "Sensex", data.series.sensex, "#059669");
    renderIndexCard("banknifty", "Bank Nifty", data.series.banknifty, "#d97706");
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

  wrap.innerHTML = `
    <div class="stock-detail-card">
      <h2>${s.symbol} <small style="font-weight:400;color:var(--text-muted);">${s.name}</small></h2>
      <div class="sub">${s.sector} &middot; <a href="${s.screener_url}" target="_blank" rel="noopener">screener.in &#8594;</a></div>

      <div class="ratio-grid">
        <div class="ratio-item"><div class="label">Price</div><div class="value">&#8377;${fmtNum(s.price)}</div></div>
        <div class="ratio-item"><div class="label">Market Cap</div><div class="value">&#8377;${fmtNum(s.market_cap_cr)} Cr</div></div>
        <div class="ratio-item"><div class="label">P/E</div><div class="value">${fmtNum(s.pe)}</div></div>
        <div class="ratio-item"><div class="label">ROE</div><div class="value">${fmtNum(s.roe)}%</div></div>
        <div class="ratio-item"><div class="label">ROCE</div><div class="value">${fmtNum(s.roce)}%</div></div>
        <div class="ratio-item"><div class="label">3Y Profit Growth</div><div class="value">${fmtNum(s.profit_growth_3y)}%</div></div>
        <div class="ratio-item"><div class="label">3Y Sales Growth</div><div class="value">${fmtNum(s.sales_growth_3y)}%</div></div>
        <div class="ratio-item"><div class="label">3Y Price CAGR</div><div class="value">${fmtNum(s.price_cagr_3y)}%</div></div>
      </div>

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
