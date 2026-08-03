// app.js - dashboard: loads data/stocks.json, renders the accuracy
// summary chips and the filterable/sortable stock table.

let DATA = null;
let currentStrategy = "all";
let currentCategory = "all";
let currentSort = { key: "market_cap_cr", dir: "desc" };

const STRATEGY_ORDER = ["value", "growth", "technical", "smartpick"];
const CATEGORY_LABELS = { bluechip: "Blue Chip", emerging: "Emerging", smartpick: "Smart Pick" };

async function loadData() {
  const res = await fetch("data/stocks.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load stock data");
  return res.json();
}

function renderAccuracyChips() {
  const wrap = document.getElementById("accuracy-chips");
  wrap.innerHTML = "";

  const allChip = document.createElement("div");
  allChip.className = "accuracy-chip" + (currentStrategy === "all" ? " active" : "");
  allChip.innerHTML = `<div class="pct">${DATA.stocks.length}</div><div class="label">All tracked stocks</div>`;
  allChip.onclick = () => setStrategy("all");
  wrap.appendChild(allChip);

  STRATEGY_ORDER.forEach((key) => {
    const meta = DATA.strategies[key];
    if (!meta) return;
    const chip = document.createElement("div");
    chip.className = "accuracy-chip" + (currentStrategy === key ? " active" : "");
    chip.innerHTML = `
      <div class="pct">${meta.accuracy.accuracy_pct}%</div>
      <div class="label">${meta.label} strategy accuracy (${meta.accuracy.picks} picks)</div>
    `;
    chip.title = meta.description;
    chip.onclick = () => setStrategy(key);
    wrap.appendChild(chip);
  });
}

function setStrategy(key) {
  currentStrategy = key;
  document.getElementById("strategy-select").value = key;
  renderAccuracyChips();
  renderTable();
}

function setCategory(key) {
  currentCategory = key;
  document.getElementById("category-select").value = key;
  renderTable();
}

function stockMatchesStrategy(s, key) {
  if (key === "smartpick") return !!s.smart_pick_qualified;
  return !!s.strategies[key];
}

function filteredStocks() {
  const search = document.getElementById("search-box").value.trim().toLowerCase();
  let list = DATA.stocks.slice();
  if (currentCategory !== "all") {
    list = list.filter((s) => (s.categories || []).includes(currentCategory));
  }
  if (currentStrategy !== "all") {
    list = list.filter((s) => stockMatchesStrategy(s, currentStrategy));
  }
  if (search) {
    list = list.filter(
      (s) =>
        (s.symbol || "").toLowerCase().includes(search) ||
        (s.name || "").toLowerCase().includes(search) ||
        (s.sector || "").toLowerCase().includes(search)
    );
  }
  list.sort((a, b) => {
    const dir = currentSort.dir === "asc" ? 1 : -1;
    const av = a[currentSort.key];
    const bv = b[currentSort.key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls sort last regardless of direction
    if (bv == null) return -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return list;
}

function pctClass(v) {
  return v > 0 ? "positive" : v < 0 ? "negative" : "";
}

// Yahoo Finance doesn't always have every field for every stock (unlike the
// old screener.in scrape) - format defensively so one missing field can't
// crash the whole table render.
function fmtCurrency(v) {
  return v === null || v === undefined ? "&ndash;" : `&#8377;${v.toLocaleString("en-IN")}`;
}
function fmtPct(v) {
  return v === null || v === undefined ? "&ndash;" : `${v}%`;
}
function fmtPlain(v) {
  return v === null || v === undefined ? "&ndash;" : v;
}

function pill(active, labelYes = "Pick", labelNo = "-") {
  return `<span class="pill ${active ? "yes" : "no"}">${active ? labelYes : labelNo}</span>`;
}

function categoryBadges(s) {
  const cats = s.categories || [];
  if (!cats.length) return `<span class="pill no">-</span>`;
  return cats.map((c) => `<span class="pill yes">${CATEGORY_LABELS[c] || c}</span>`).join(" ");
}

function renderTable() {
  const tbody = document.querySelector("#stocks-table tbody");
  const rows = filteredStocks();
  document.getElementById("result-count").textContent = `${rows.length} stock${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:#94a3b8;padding:24px;">No stocks match this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (s) => `
    <tr>
      <td><strong>${s.symbol}</strong></td>
      <td>${s.name}<br><small style="color:#94a3b8;">${s.sector || "&ndash;"}</small></td>
      <td>${categoryBadges(s)}</td>
      <td>${fmtCurrency(s.price)}</td>
      <td>${s.market_cap_cr == null ? "&ndash;" : fmtCurrency(s.market_cap_cr) + " Cr"}</td>
      <td>${fmtPlain(s.pe)}</td>
      <td>${fmtPct(s.roe)}</td>
      <td>${fmtPct(s.profit_growth_3y)}</td>
      <td class="${pctClass(s.price_cagr_3y)}">${fmtPct(s.price_cagr_3y)}</td>
      <td>${pill(s.strategies.value)}</td>
      <td>${pill(s.strategies.growth)}</td>
      <td>${pill(s.strategies.technical)}</td>
      <td>${pill(s.smart_pick_qualified)}</td>
      <td><a href="${s.screener_url}" target="_blank" rel="noopener">screener.in &#8594;</a></td>
    </tr>
  `
    )
    .join("");
}

function initSortHeaders() {
  document.querySelectorAll("#stocks-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (currentSort.key === key) {
        currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
      } else {
        currentSort = { key, dir: "desc" };
      }
      renderTable();
    });
  });
}

async function initDashboard() {
  const tbody = document.querySelector("#stocks-table tbody");
  tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:24px;">Loading stock data...</td></tr>`;
  try {
    DATA = await loadData();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:#dc2626;padding:24px;">${err.message}</td></tr>`;
    return;
  }

  document.getElementById("snapshot-date").textContent = DATA.snapshot_date;
  document.getElementById("methodology-note").textContent = DATA.methodology_note;

  renderAccuracyChips();
  renderTable();
  initSortHeaders();

  document.getElementById("strategy-select").addEventListener("change", (e) => setStrategy(e.target.value));
  document.getElementById("category-select").addEventListener("change", (e) => setCategory(e.target.value));
  document.getElementById("search-box").addEventListener("input", renderTable);
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("stocks-table")) {
    initDashboard();
  }
});
