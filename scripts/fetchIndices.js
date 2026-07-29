// scripts/fetchIndices.js
// Runs daily via GitHub Actions (.github/workflows/fetch-indices.yml) after market close.
// Appends one new data point per trading day to public/data/indices.json for
// Nifty 50, Nifty Bank (from NSE archives) and Sensex (from a public chart API).
// Free-tier only: no paid data feed, no API key required.

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "public", "data", "indices.json");
const MAX_POINTS = 250; // keep roughly a year of trading days per series

function todayIST() {
  // Format as DD MM YYYY in IST for NSE archive filenames and as YYYY-MM-DD for storage.
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000); // shift to IST
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = now.getUTCFullYear();
  return {
    ddmmyyyy: `${dd}${mm}${yyyy}`,
    iso: `${yyyy}-${mm}-${dd}`,
  };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "text/csv,*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Parses the NSE "ind_close_all_DDMMYYYY.csv" file and pulls out the closing
// value for a given index name (exact match on the "Index Name" column).
function parseNseIndexClose(csvText, indexName) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  const header = lines[0].split(",");
  const nameIdx = header.indexOf("Index Name");
  const closeIdx = header.indexOf("Closing Index Value");
  if (nameIdx === -1 || closeIdx === -1) return null;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols[nameIdx] === indexName) {
      const val = parseFloat(cols[closeIdx]);
      return Number.isFinite(val) ? val : null;
    }
  }
  return null;
}

async function fetchNiftyAndBankNifty(ddmmyyyy) {
  const url = `https://archives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy}.csv`;
  const csv = await fetchText(url);
  return {
    nifty50: parseNseIndexClose(csv, "Nifty 50"),
    banknifty: parseNseIndexClose(csv, "Nifty Bank"),
  };
}

// Sensex isn't published by NSE. Try a couple of free, no-key sources and use
// whichever responds. GitHub Actions runners have full outbound internet
// access, unlike some restricted sandboxes, so these should resolve fine.
async function fetchSensex() {
  const attempts = [
    async () => {
      const j = await fetchText(
        "https://query1.finance.yahoo.com/v8/finance/chart/%5EBSESN?range=5d&interval=1d"
      );
      const data = JSON.parse(j);
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      const val = closes?.filter((v) => v != null).pop();
      return typeof val === "number" ? val : null;
    },
    async () => {
      const j = await fetchText(
        "https://query2.finance.yahoo.com/v8/finance/chart/%5EBSESN?range=5d&interval=1d"
      );
      const data = JSON.parse(j);
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      const val = closes?.filter((v) => v != null).pop();
      return typeof val === "number" ? val : null;
    },
  ];
  for (const attempt of attempts) {
    try {
      const val = await attempt();
      if (val) return val;
    } catch (err) {
      console.warn("Sensex source failed:", err.message);
    }
  }
  return null;
}

function upsertPoint(series, point) {
  const idx = series.findIndex((p) => p.date === point.date);
  if (idx >= 0) {
    series[idx] = point;
  } else {
    series.push(point);
  }
  series.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (series.length > MAX_POINTS) {
    series.splice(0, series.length - MAX_POINTS);
  }
  return series;
}

async function main() {
  const { ddmmyyyy, iso } = todayIST();

  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    data = { updated: iso, note: "", series: { nifty50: [], banknifty: [], sensex: [] } };
  }
  data.series.nifty50 = data.series.nifty50 || [];
  data.series.banknifty = data.series.banknifty || [];
  data.series.sensex = data.series.sensex || [];

  let wrote = false;

  try {
    const { nifty50, banknifty } = await fetchNiftyAndBankNifty(ddmmyyyy);
    if (nifty50 != null) {
      upsertPoint(data.series.nifty50, { date: iso, close: nifty50 });
      wrote = true;
    }
    if (banknifty != null) {
      upsertPoint(data.series.banknifty, { date: iso, close: banknifty });
      wrote = true;
    }
  } catch (err) {
    console.warn("NSE archive fetch failed (likely a holiday/weekend or not yet published):", err.message);
  }

  try {
    const sensex = await fetchSensex();
    if (sensex != null) {
      upsertPoint(data.series.sensex, { date: iso, close: sensex });
      wrote = true;
    }
  } catch (err) {
    console.warn("Sensex fetch failed:", err.message);
  }

  if (wrote) {
    data.updated = iso;
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log("indices.json updated for", iso);
  } else {
    console.log("No new data for", iso, "- leaving indices.json unchanged (likely a non-trading day).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
