// scripts/fetchFundamentals.js
// Daily job: rebuilds public/data/stocks.json (fundamentals, financials,
// per-stock price charts, strategy flags + accuracy) and
// public/data/radar.json entirely from Yahoo Finance - no screener.in
// scraping required.
//
// Runs via .github/workflows/fetch-fundamentals.yml once a day after market
// close. Fundamentals/financials don't change intraday, so this doesn't
// need to run more often; live prices are refreshed separately and more
// frequently by fetchLivePrices.js.
//
// Free-tier only: no paid data feed, no API key required.

const fs = require("fs");
const path = require("path");
const { getChart, getQuoteSummary, sleep } = require("./lib/yahoo");

const TICKERS_PATH = path.join(__dirname, "data", "nifty500_tickers.json");
const STOCKS_OUT = path.join(__dirname, "..", "public", "data", "stocks.json");
const RADAR_OUT = path.join(__dirname, "..", "public", "data", "radar.json");

const CONCURRENCY = 5; // be reasonably polite to Yahoo's endpoints
const CR = 1e7; // 1 crore = 10,000,000

function pct(fraction) {
  // Yahoo sometimes returns ratios as a fraction (0.144) and sometimes as
  // an already-scaled percent depending on the field; normalize fractions.
  if (fraction == null || !Number.isFinite(fraction)) return null;
  return Math.abs(fraction) <= 1.5 ? round2(fraction * 100) : round2(fraction);
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function crores(v) {
  return v == null ? null : Math.round((v / CR) * 100) / 100;
}

function median(values) {
  const clean = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function cagr(first, last, years) {
  if (first == null || last == null || first <= 0 || years <= 0) return null;
  return round2((Math.pow(last / first, 1 / years) - 1) * 100);
}

function priceAt(daysAgo, series) {
  if (!series || !series.length) return null;
  const targetT = series[series.length - 1].t - daysAgo * 86400;
  let best = null;
  for (const p of series) {
    if (p.t <= targetT) best = p;
    else break;
  }
  return best ? best.c : series[0].c;
}

function downsample(series, everyN) {
  if (!series) return [];
  return series.filter((_, i) => i % everyN === 0);
}

// --- fundamentals for a single symbol -------------------------------------

async function fetchOne(symbol) {
  const yahooSymbol = `${symbol}.NS`;
  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "assetProfile",
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
    "balanceSheetHistory",
  ].join(",");

  const summary = await getQuoteSummary(yahooSymbol, modules.split(","));
  const priceMod = summary.price || {};
  const sd = summary.summaryDetail || {};
  const ks = summary.defaultKeyStatistics || {};
  const fd = summary.financialData || {};
  const profile = summary.assetProfile || {};
  const annual = summary.incomeStatementHistory?.incomeStatementHistory || [];
  const quarterly = summary.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
  const balanceAnnual = summary.balanceSheetHistory?.balanceSheetStatements || [];

  const raw = (x) => (x && typeof x === "object" && "raw" in x ? x.raw : x);

  const yearly = annual
    .map((a) => ({
      period: a.endDate?.fmt || null,
      revenue: crores(raw(a.totalRevenue)),
      net_profit: crores(raw(a.netIncome)),
      _ebit: raw(a.ebit ?? a.operatingIncome),
      _endDate: raw(a.endDate),
    }))
    .filter((y) => y.period)
    .sort((a, b) => (a._endDate || 0) - (b._endDate || 0));

  const quarterlyOut = quarterly
    .map((q) => {
      const revenue = crores(raw(q.totalRevenue));
      const opInc = crores(raw(q.operatingIncome));
      return {
        period: q.endDate?.fmt || null,
        revenue,
        net_profit: crores(raw(q.netIncome)),
        opm_pct: revenue && opInc != null ? round2((opInc / revenue) * 100) : null,
        _endDate: raw(q.endDate),
      };
    })
    .filter((q) => q.period)
    .sort((a, b) => (a._endDate || 0) - (b._endDate || 0));

  // ROCE ~= EBIT / (Total Assets - Total Current Liabilities), most recent year available.
  let roce = null;
  const latestBalance = balanceAnnual[0];
  const latestEbit = yearly[yearly.length - 1]?._ebit;
  if (latestBalance && latestEbit != null) {
    const totalAssets = raw(latestBalance.totalAssets);
    const currentLiabilities = raw(latestBalance.totalCurrentLiabilities);
    if (totalAssets != null && currentLiabilities != null && totalAssets - currentLiabilities > 0) {
      roce = round2((latestEbit / (totalAssets - currentLiabilities)) * 100);
    }
  }

  // Growth rates (CAGR across whatever annual history Yahoo exposes, typically ~4y).
  const revSeries = yearly.map((y) => y.revenue).filter((v) => v != null);
  const profitSeries = yearly.map((y) => y.net_profit).filter((v) => v != null);
  const years = Math.max(yearly.length - 1, 0);
  const sales_growth_3y = revSeries.length >= 2 ? cagr(revSeries[0], revSeries[revSeries.length - 1], years) : null;
  const profit_growth_3y =
    profitSeries.length >= 2 ? cagr(profitSeries[0], profitSeries[profitSeries.length - 1], years) : null;

  // 5y daily chart -> backtest + price CAGR + downsampled chart tabs.
  let chart5y = [];
  try {
    chart5y = await getChart(yahooSymbol, "5y", "1d");
  } catch (err) {
    console.warn(`  [warn] ${symbol}: 5y chart fetch failed: ${err.message}`);
  }
  let chartMax = [];
  try {
    chartMax = await getChart(yahooSymbol, "max", "1mo");
  } catch (err) {
    console.warn(`  [warn] ${symbol}: max chart fetch failed: ${err.message}`);
  }

  const price_cagr_1y = chart5y.length ? cagr(priceAt(365, chart5y), chart5y[chart5y.length - 1].c, 1) : null;
  const price_cagr_3y = chart5y.length ? cagr(priceAt(3 * 365, chart5y), chart5y[chart5y.length - 1].c, 3) : null;

  const { crosses, winRate } = backtestGoldenCross(chart5y);

  const charts = {
    "1m": downsample(chart5y.slice(-22), 1),
    "6m": downsample(chart5y.slice(-126), 1),
    "1y": downsample(chart5y.slice(-252), 1),
    "5y": downsample(chart5y, 5),
    max: chartMax,
  };

  return {
    symbol,
    name: priceMod.longName || priceMod.shortName || symbol,
    sector: profile.sector || null,
    screener_url: `https://www.screener.in/company/${symbol}/consolidated/`,
    price: raw(priceMod.regularMarketPrice) ?? null,
    market_cap_cr: crores(raw(sd.marketCap)),
    pe: round2(raw(sd.trailingPE)),
    book_value: round2(raw(ks.bookValue)),
    price_to_book: round2(raw(ks.priceToBook)),
    div_yield: pct(raw(sd.dividendYield)),
    roce,
    roe: pct(raw(fd.returnOnEquity)),
    eps: round2(raw(ks.trailingEps)),
    sales_growth_3y,
    profit_growth_3y,
    price_cagr_1y,
    price_cagr_3y,
    roe_3y_avg: pct(raw(fd.returnOnEquity)), // Yahoo free tier only exposes current ROE, not a 3y trend
    quarterly: quarterlyOut.map(({ _endDate, ...rest }) => rest),
    yearly: yearly.map(({ _ebit, _endDate, ...rest }) => rest),
    charts,
    technical_backtest_crosses: crosses,
    technical_backtest_win_rate_pct: winRate,
  };
}

function backtestGoldenCross(series, forwardDays = 90) {
  if (!series || series.length < 210) return { crosses: 0, winRate: null };
  const closes = series.map((p) => p.c);
  const sma = (arr, i, n) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += arr[k];
    return sum / n;
  };
  const sma50 = closes.map((_, i) => sma(closes, i, 50));
  const sma200 = closes.map((_, i) => sma(closes, i, 200));

  let wins = 0;
  let total = 0;
  for (let i = 1; i < series.length; i++) {
    if (sma50[i] == null || sma200[i] == null || sma50[i - 1] == null || sma200[i - 1] == null) continue;
    const crossedUp = sma50[i] > sma200[i] && sma50[i - 1] <= sma200[i - 1];
    if (!crossedUp) continue;
    const entryPrice = closes[i];
    const targetT = series[i].t + forwardDays * 86400;
    const future = series.slice(i + 1).find((p) => p.t >= targetT);
    if (!future) continue;
    total++;
    if (future.c > entryPrice) wins++;
  }
  return { crosses: total, winRate: total ? round2((100 * wins) / total) : null };
}

// --- strategy classification + accuracy (same rules as the old scraper) --

function classifyAndScore(stocks) {
  const peMedian = median(stocks.map((s) => s.pe));
  const roeMedian = median(stocks.map((s) => s.roe));
  const profitGrowthMedian = median(stocks.map((s) => s.profit_growth_3y));
  const salesGrowthMedian = median(stocks.map((s) => s.sales_growth_3y));

  for (const s of stocks) {
    const valuePick = s.pe != null && peMedian != null && s.pe <= peMedian && s.roe != null && roeMedian != null && s.roe >= roeMedian;
    const growthPick =
      s.profit_growth_3y != null &&
      profitGrowthMedian != null &&
      s.profit_growth_3y >= profitGrowthMedian &&
      s.sales_growth_3y != null &&
      salesGrowthMedian != null &&
      s.sales_growth_3y >= salesGrowthMedian;
    const technicalPick = (s.technical_backtest_win_rate_pct || 0) >= 50;

    s.strategies = { value: valuePick, growth: growthPick, technical: technicalPick };
    s.smart_pick_qualified = [valuePick, growthPick, technicalPick].filter(Boolean).length >= 2;
  }

  function accuracyFor(pickKey) {
    const picked = pickKey === "smartpick" ? stocks.filter((s) => s.smart_pick_qualified) : stocks.filter((s) => s.strategies[pickKey]);
    if (!picked.length) return { picks: 0, hits: 0, accuracy_pct: 0, picked_symbols: [] };
    const hits = picked.filter((s) => (s.price_cagr_3y || 0) > 0);
    return {
      picks: picked.length,
      hits: hits.length,
      accuracy_pct: round2((100 * hits.length) / picked.length),
      picked_symbols: picked.map((s) => s.symbol),
    };
  }

  return {
    value: { label: "Value", description: "Below-median P/E and above-median ROE.", accuracy: accuracyFor("value") },
    growth: {
      label: "Growth",
      description: "Above-median 3-year profit and sales growth.",
      accuracy: accuracyFor("growth"),
    },
    technical: {
      label: "Technical / Momentum",
      description: "50/200-day SMA golden-cross win rate >= 50% over the last 5 years.",
      accuracy: accuracyFor("technical"),
    },
    smartpick: {
      label: "Smart Pick",
      description: "Qualifies under at least 2 of the 3 strategies above (Value/Growth/Technical).",
      accuracy: accuracyFor("smartpick"),
    },
  };
}

// --- Under Radar valuation re-rating (same methodology as before) --------

function buildRadar(stocks) {
  const bySector = {};
  for (const s of stocks) {
    if (s.pe == null || s.pe <= 0) continue;
    (bySector[s.sector || "Unknown"] = bySector[s.sector || "Unknown"] || []).push(s.pe);
  }
  const overallPeMedian = median(stocks.map((s) => s.pe));

  const picks = [];
  for (const s of stocks) {
    if (!(s.pe > 0) || !(s.eps > 0) || !(s.market_cap_cr >= 1000) || !(s.roe >= 10)) continue;
    const sectorPEs = bySector[s.sector || "Unknown"] || [];
    let fairPe = sectorPEs.length >= 3 ? median(sectorPEs) : overallPeMedian;
    if (fairPe == null) continue;
    fairPe = Math.max(6, Math.min(45, fairPe));
    fairPe = Math.max(s.pe * 0.75, Math.min(s.pe * 1.5, fairPe));
    const target = s.eps * fairPe;
    const potential = round2(((target - s.price) / s.price) * 100);
    if (potential >= 12 && potential <= 40) {
      picks.push({
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        buy_price: s.price,
        target_price: round2(target),
        potential_profit_pct: potential,
        pe: s.pe,
        fair_pe_used: round2(fairPe),
        roe: s.roe,
        market_cap_cr: s.market_cap_cr,
      });
    }
  }
  picks.sort((a, b) => b.potential_profit_pct - a.potential_profit_pct);

  return {
    generated_date: new Date().toISOString().slice(0, 10),
    methodology:
      "Fundamental valuation re-rating: Target Price = current EPS x fair sector-median P/E (bounded within 0.75x-1.5x of the stock's own P/E, capped at 12-40% potential upside, to avoid extreme/unreliable projections). Buy Price = current market price. Only profitable (positive EPS/PE), reasonably liquid (Market Cap > Rs 1,000 Cr) and quality (ROE >= 10%) companies are considered.",
    disclaimer:
      "Educational/informational only. This is an automated, rules-based screen, NOT personalized investment advice and NOT a guarantee of returns. Past accuracy of a strategy does not predict future performance. Please do your own research and consult a SEBI-registered financial advisor before investing.",
    stocks: picks.slice(0, 30),
  };
}

// --- main ------------------------------------------------------------------

async function processInBatches(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        console.warn(`  [warn] ${items[i].symbol} failed: ${err.message}`);
        results[i] = null;
      }
      await sleep(200);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner));
  return results.filter(Boolean);
}

async function main() {
  const tickers = JSON.parse(fs.readFileSync(TICKERS_PATH, "utf8"));
  console.log(`Fetching fundamentals for ${tickers.length} symbols from Yahoo Finance ...`);

  const fetched = await processInBatches(
    tickers,
    async (t, i) => {
      if (i % 25 === 0) console.log(`  [${i}/${tickers.length}] ...`);
      const data = await fetchOne(t.symbol);
      data.categories = t.categories;
      return data;
    },
    CONCURRENCY
  );

  if (!fetched.length) {
    console.error("No stocks fetched - aborting without overwriting existing data files.");
    process.exit(1);
  }

  const strategies = classifyAndScore(fetched);
  const categoryCounts = {};
  for (const s of fetched) for (const c of s.categories) categoryCounts[c] = (categoryCounts[c] || 0) + 1;

  const stocksOutput = {
    snapshot_date: new Date().toISOString().slice(0, 10),
    source: "Yahoo Finance (query1/query2.finance.yahoo.com), free/no key - automated daily fetch",
    disclaimer:
      "Educational/informational content only. Not registered investment advice under SEBI or any other regulator. Always do your own research.",
    methodology_note:
      "Value/Growth picks are relative to the median of this tracked universe. Technical picks are based on a real walk-forward 50/200-day moving-average golden-cross backtest over the last 5 years of daily price history. 'Smart Pick' means a stock qualifies under at least 2 of the 3 strategies above.",
    category_counts: categoryCounts,
    strategies,
    stocks: fetched,
  };

  fs.mkdirSync(path.dirname(STOCKS_OUT), { recursive: true });
  fs.writeFileSync(STOCKS_OUT, JSON.stringify(stocksOutput) + "\n");
  console.log(`Wrote ${fetched.length} stocks to ${STOCKS_OUT}`);

  const radar = buildRadar(fetched);
  fs.writeFileSync(RADAR_OUT, JSON.stringify(radar, null, 2) + "\n");
  console.log(`Wrote ${radar.stocks.length} radar picks to ${RADAR_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
