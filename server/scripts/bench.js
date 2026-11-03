// Measures how fast the server answers the requests shoppers make most.
//   npm run bench               (against http://127.0.0.1:3000)
//   BENCH_URL=https://vallora.ci npm run bench
const BASE = process.env.BENCH_URL ?? 'http://127.0.0.1:3000';
const REQUESTS = 400;
const CONCURRENCY = 20;

async function measure(label, path, headers = {}) {
  const timings = [];
  let next = 0;
  async function worker() {
    while (next < REQUESTS) {
      next += 1;
      const start = performance.now();
      const response = await fetch(BASE + path, { headers });
      await response.arrayBuffer();
      timings.push(performance.now() - start);
    }
  }
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seconds = (performance.now() - started) / 1000;
  timings.sort((a, b) => a - b);
  const pick = (q) => timings[Math.floor(q * (timings.length - 1))].toFixed(1);
  console.log(`${label.padEnd(34)} p50 ${pick(0.5)} ms   p95 ${pick(0.95)} ms   ${Math.round(REQUESTS / seconds)} req/s`);
}

const home = await fetch(`${BASE}/`);
const etag = home.headers.get('etag');
await measure('Shop page (first visit)', '/', { 'accept-encoding': 'br' });
await measure('Shop page (returning visitor, 304)', '/', { 'if-none-match': etag });
await measure('Health check', '/health');
