// Vercel entry point. vercel.json routes every request here; Fastify does the rest.
// The app is built once per function instance and reused by the requests that instance serves.
let appPromise = null;

function getApp() {
  appPromise ??= (async () => {
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp();
    await app.ready();
    return app;
  })().catch((error) => {
    appPromise = null; // try again on the next request instead of staying broken
    throw error;
  });
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (error) {
    console.error(error);
    res.statusCode = 503;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    // Setup problems say what to fix (they name settings, never their values); anything else stays generic.
    res.end(error.name === 'ConfigError'
      ? `The shop is not set up yet. ${error.message}`
      : 'The shop could not start. The details are in the function logs on Vercel.');
  }
}
