const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');
const path = require('path');

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require(path.join(__dirname, '..', 'serviceAccountKey.json'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK'];

// Max number of history points kept per symbol (older points are pruned).
// At ~7 fetches/day (hourly, market hours only) this holds roughly 6 months of history.
const HISTORY_CAP = 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, /',
};

async function fetchYahooQuote(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '.NS';
  const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });

  const result = response.data && response.data.chart && response.data.chart.result && response.data.chart.result[0];
  if (!result) throw new Error('No data returned from Yahoo Finance');

  const meta = result.meta;
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const lastIndex = (quote && quote.close ? quote.close.length : 1) - 1;

  return {
    lastPrice: meta.regularMarketPrice != null ? meta.regularMarketPrice : null,
    previousClose: meta.previousClose != null ? meta.previousClose : null,
    dayHigh: meta.regularMarketDayHigh != null ? meta.regularMarketDayHigh : null,
    dayLow: meta.regularMarketDayLow != null ? meta.regularMarketDayLow : null,
    volume: (quote && quote.volume && quote.volume[lastIndex] != null) ? quote.volume[lastIndex] : meta.regularMarketVolume,
    currency: meta.currency || 'INR',
  };
}

function computeChange(lastPrice, previousClose) {
  if (lastPrice == null || previousClose == null || previousClose === 0) {
    return { change: null, pChange: null };
  }
  const change = lastPrice - previousClose;
  const pChange = (change / previousClose) * 100;
  return {
    change: Number(change.toFixed(2)),
    pChange: Number(pChange.toFixed(2)),
  };
}

// Appends one history point for this symbol and prunes old points beyond HISTORY_CAP.
async function appendHistory(symbol, doc) {
  const historyRef = db.collection('stocks').doc(symbol).collection('history');

  await historyRef.add({
    price: doc.lastPrice,
    pChange: doc.pChange,
    timestamp: FieldValue.serverTimestamp(),
  });

  const snapshot = await historyRef.orderBy('timestamp', 'asc').get();
  if (snapshot.size > HISTORY_CAP) {
    const excess = snapshot.size - HISTORY_CAP;
    const batch = db.batch();
    snapshot.docs.slice(0, excess).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function run() {
  console.log('Starting fetch run: ' + new Date().toISOString());

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    try {
      const yahooData = await fetchYahooQuote(symbol);
      const result = computeChange(yahooData.lastPrice, yahooData.previousClose);

      const doc = {
        symbol: symbol,
        lastPrice: yahooData.lastPrice,
        previousClose: yahooData.previousClose,
        change: result.change,
        pChange: result.pChange,
        dayHigh: yahooData.dayHigh,
        dayLow: yahooData.dayLow,
        volume: yahooData.volume,
        lastUpdated: FieldValue.serverTimestamp(),
      };

      await db.collection('stocks').doc(symbol).set(doc, { merge: true });
      await appendHistory(symbol, doc);

      console.log('OK ' + symbol + ': Rs' + doc.lastPrice + ' (' + result.pChange + '%)');
      successCount++;

      await new Promise(function(resolve) { setTimeout(resolve, 500); });
    } catch (err) {
      console.error('FAILED ' + symbol + ': ' + err.message);
      failCount++;
    }
  }

  await db.collection('scanLogs').add({
    runAt: FieldValue.serverTimestamp(),
    stocksScanned: SYMBOLS.length,
    successCount: successCount,
    failCount: failCount,
  });

  console.log('Done. ' + successCount + ' succeeded, ' + failCount + ' failed.');
  process.exit(0);
}

run();
