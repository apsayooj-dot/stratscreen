// scripts/fetchIndices.js
// Fetches Nifty 50 / Nifty Bank / Sensex chart data from Yahoo Finance
// across 7 timeframes (1D intraday through Max) and writes public/data/indices.json.
//
// Runs via .github/workflows/fetch-indices.yml every ~15 min during NSE/BSE
// market hours (weekdays). Replaces the old daily-only version that mixed
// NSE archive CSVs with Yahoo Finance for a single close-of-day point.
//
// Free-tier only: no paid data feed, no API key required.

const fs = require("fs");
const path = require("path");
const { getChart } = require("./lib/yahoo");

const DATA_PATH = path.join(__dirname, "..", "public", "data", "indices.json");

const INDICES = {
  nifty50: { yahoo: "^NSEI", label: "Nifty 50" },
  banknifty: { yahoo: "^NSEBANK", label: "Nifty Bank" },
  sensex: { yahoo: "^BSESN", label: "Sensex" },
};

// Yahoo range/interval pairs per timeframe tab shown in the UI.
const RANGES = {
  "1d": { range: "1d", interval: "5m" },
  "1w": { range: "5d", interval: "15m" },
  "1m": { range: "1mo", interval: "1d" },
  "6m": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "5y": { range: "5y", interval: "1wk" },
  max: { range: "max", interval: "1mo" },
};

function nowIsoIST() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().replace("Z", "+05:30");
}

async function fetchAllRangesFor(yahooSymbol) {
  const out = {};
  for (const [key, { range, interval }] of Object.entries(RANGES)) {
    try {
      out[key] = await getChart(yahooSymbol, range, interval);
    } catch (err) {
      console.warn(`  [warn] ${yahooSymbol} range=${key} failed: ${err.message}`);
      out[key] = null; // leave previous value in place below rather than wiping it
    }
  }
  return out;
}

async function main() {
  let existing = { series: {} };
  try {
    existing = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    // first run - no prior file
  }

  const series = existing.series || {};
  let anySuccess = false;

  for (const [key, meta] of Object.entries(INDICES)) {
    console.log(`Fetching ${meta.label} (${meta.yahoo}) ...`);
    const ranges = await fetchAllRangesFor(meta.yahoo);
    series[key] = series[key] || {};
    for (const [rangeKey, points] of Object.entries(ranges)) {
      if (points && points.length) {
        series[key][rangeKey] = points;
        anySuccess = true;
      }
      // if a fetch failed (null), keep whatever was already stored for that range
    }
    series[key].label = meta.label;
  }

  if (!anySuccess) {
    console.error("All index fetches failed - leaving indices.json unchanged.");
    process.exit(1);
  }

  const output = {
    updated: nowIsoIST(),
    source: "Yahoo Finance chart API (query1/query2.finance.yahoo.com), free/no key",
    ranges_available: Object.keys(RANGES),
    series,
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output) + "\n");
  console.log("web/data/indices.json updated at", output.updated);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
