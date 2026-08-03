// scripts/fetchLivePrices.js
// Lightweight, frequent refresh: updates just the live `price` and
// `day_change_pct` fields for every tracked stock in public/data/stocks.json,
// using Yahoo Finance's batched quote endpoint (a handful of requests for
// all 500 symbols, not 500 separate calls). Does NOT touch fundamentals,
// financials, or strategy flags - that's fetchFundamentals.js's job, which
// runs once a day since those numbers don't change intraday.
//
// Runs via .github/workflows/fetch-indices.yml every ~15 min during market
// hours, right after fetchIndices.js.

const fs = require("fs");
const path = require("path");
const { getQuoteBatch } = require("./lib/yahoo");

const STOCKS_PATH = path.join(__dirname, "..", "public", "data", "stocks.json");
const TICKERS_PATH = path.join(__dirname, "data", "nifty500_tickers.json");

function nowIsoIST() {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().replace("Z", "+05:30");
}

async function main() {
  if (!fs.existsSync(STOCKS_PATH)) {
    console.error("web/data/stocks.json does not exist yet - run fetchFundamentals.js first.");
    process.exit(1);
  }
  const tickers = JSON.parse(fs.readFileSync(TICKERS_PATH, "utf8"));
  const data = JSON.parse(fs.readFileSync(STOCKS_PATH, "utf8"));
  const bySymbol = new Map(data.stocks.map((s) => [s.symbol, s]));

  const yahooSymbols = tickers.map((t) => `${t.symbol}.NS`);
  console.log(`Fetching live quotes for ${yahooSymbols.length} symbols ...`);
  const quotes = await getQuoteBatch(yahooSymbols);

  let updated = 0;
  for (const t of tickers) {
    const q = quotes[`${t.symbol}.NS`];
    const stock = bySymbol.get(t.symbol);
    if (!q || !stock) continue;
    if (q.price != null) {
      stock.price = q.price;
      updated++;
    }
    if (q.changePct != null) stock.day_change_pct = q.changePct;
  }

  if (updated === 0) {
    console.error("No quotes updated - leaving stocks.json unchanged (market likely closed or fetch blocked).");
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
