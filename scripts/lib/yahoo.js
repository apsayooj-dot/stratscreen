// scripts/lib/yahoo.js
// Shared helpers for talking to Yahoo Finance's public (unofficial, free,
// no-API-key) endpoints. Used by fetchIndices.js, fetchLivePrices.js and
// fetchFundamentals.js.
//
// NOTE: these endpoints are undocumented and can change or rate-limit
// without notice. GitHub Actions runners have normal outbound internet
// access (unlike some restricted sandboxes), which is where this is meant
// to run.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchJson(url, { retries = 2, retryDelayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(retryDelayMs);
    }
  }
  throw lastErr;
}

// Chart/history endpoint - works for both indices (^NSEI, ^BSESN, ^NSEBANK)
// and equities (SYMBOL.NS). Tries query1 then falls back to query2.
async function getChart(symbol, range, interval) {
  const encoded = encodeURIComponent(symbol);
  const hosts = ["query1", "query2"];
  let lastErr;
  for (const host of hosts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encoded}?range=${range}&interval=${interval}`;
      const json = await fetchJson(url, { retries: 1 });
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error("empty chart result");
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const points = timestamps
        .map((t, i) => ({ t, c: closes[i] }))
        .filter((p) => p.c != null && Number.isFinite(p.c));
      return points;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Batch quote endpoint - up to ~50 symbols per call is a safe chunk size.
// Returns { [symbol]: { price, changePct } }.
async function getQuoteBatch(symbols) {
  const out = {};
  for (const group of chunk(symbols, 50)) {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${group
      .map(encodeURIComponent)
      .join(",")}`;
    try {
      const json = await fetchJson(url, { retries: 1 });
      const results = json?.quoteResponse?.result || [];
      for (const r of results) {
        out[r.symbol] = {
          price: r.regularMarketPrice ?? null,
          changePct: r.regularMarketChangePercent ?? null,
        };
      }
    } catch (err) {
      console.warn(`  [warn] quote batch failed for ${group.length} symbols:`, err.message);
    }
    await sleep(250);
  }
  return out;
}

// quoteSummary (v10) and the batched quote endpoint (v7) both now require a
// session cookie + "crumb" token - calling them without one returns HTTP 401.
// This fetches a cookie from Yahoo, then exchanges it for a crumb, and
// caches both for the life of the process (one crumb fetch per script run,
// not per symbol).
let crumbPromise = null;

function parseCookie(setCookieValues) {
  return setCookieValues.map((c) => c.split(";")[0]).join("; ");
}

async function fetchCrumb() {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
  });
  const setCookie =
    typeof cookieRes.headers.getSetCookie === "function"
      ? cookieRes.headers.getSetCookie()
      : [cookieRes.headers.get("set-cookie")].filter(Boolean);
  if (!setCookie.length) throw new Error("no Set-Cookie from fc.yahoo.com");
  const cookie = parseCookie(setCookie);

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  if (!crumbRes.ok) throw new Error(`HTTP ${crumbRes.status} fetching crumb`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb) throw new Error("empty crumb response");
  return { cookie, crumb };
}

async function getCrumb() {
  if (!crumbPromise) crumbPromise = fetchCrumb();
  try {
    return await crumbPromise;
  } catch (err) {
    crumbPromise = null; // allow a retry on the next call instead of caching a failure forever
    throw err;
  }
}

// quoteSummary - fundamentals. modules is an array of Yahoo module names.
async function getQuoteSummary(symbol, modules) {
  const { cookie, crumb } = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    symbol
  )}?modules=${modules.join(",")}&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: cookie, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for quoteSummary ${symbol}`);
  const json = await res.json();
  const result = json?.quoteSummary?.result?.[0];
  if (!result) throw new Error("empty quoteSummary result");
  return result;
}

module.exports = { sleep, chunk, fetchJson, getChart, getQuoteBatch, getQuoteSummary, getCrumb, UA };
