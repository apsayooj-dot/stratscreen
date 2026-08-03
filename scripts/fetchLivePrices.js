// scripts/fetchLivePrices.js
// Lightweight, frequent refresh: updates just the live `price` and
// `day_change_pct` fields for every tracked stock in public/data/stocks.json.
// Does NOT touch fundamentals, financials, or strategy flags - that's
// fetchFundamentals.js's job, which runs once a day since those numbers
// don't change intraday.
//
// Runs via .github/workflows/fetch-indices.yml every ~15 min during market
// hours, right after fetchIndices.js.

const fs = require("fs");
const path = require("path");
const { getChart, sleep } = require("./lib/yahoo");

const STOCKS_PATH = path.join(__dirname, "..", "public", "data", "stocks.json");
const TICKERS_PATH = path.join(__dirname, "data", "nifty500_tickers.json");
const CONCURRENCY = 10;

function nowIsoIST() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().replace("Z", "+05:30");
}

// NOTE: Yahoo's batched v7/finance/quote endpoint now requires a
// crumb/cookie and returns HTTP 401 without one, so this uses the same
// no-auth-required chart endpoint fetchIndices.js relies on instead - one
// lightweight intraday chart call per symbol (last close = live price,
// first-vs-last = today's % change so far), run with modest concurrency.
async function fetchOnePrice(symbol) {
  const points = await getChart(`${symbol}.NS`, "1d", "5m");
  if (!points || !points.length) return null;
  const last = points[points.length - 1].c;
  const first = points[0].c;
  const changePct = first ? ((last - first) / first) * 100 : null;
  return { price: last, changePct };
}

async function processInBatches(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i]);
      } catch (err) {
        results[i] = null;
      }
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner));
  return results;
}

async function main() {
  if (!fs.existsSync(STOCKS_PATH)) {
    console.error("public/data/stocks.json does not exist yet - run fetchFundamentals.js first.");
    process.exit(1);
  }
  const tickers = JSON.parse(fs.readFileSync(TICKERS_PATH, "utf8"));
  const data = JSON.parse(fs.readFileSync(STOCKS_PATH, "utf8"));
  const bySymbol = new Map(data.stocks.map((s) => [s.symbol, s]));

  console.log(`Fetching live prices for ${tickers.length} symbols via Yahoo chart API ...`);
  const quotes = await processInBatches(tickers, (t) => fetchOnePrice(t.symbol), CONCURRENCY);

  let updated = 0;
  for (let i = 0; i < tickers.length; i++) {
    const q = quotes[i];
    const stock = bySymbol.get(tickers[i].symbol);
    if (!q || !stock) continue;
    if (q.price != null) {
      stock.price = q.price;
      updated++;
    }
    if (q.changePct != null) stock.day_change_pct = Math.round(q.changePct * 100) / 100;
  }

  if (updated === 0) {
    console.error("No prices updated - leaving stocks.json unchanged (market likely closed or fetch blocked).");
    process.exit(1);
  }

  data.prices_updated = nowIsoIST();
  fs.writeFileSync(STOCKS_PATH, JSON.stringify(data) + "\n");
  console.log(`Updated live price for ${updated}/${tickers.length} stocks at ${data.prices_updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
