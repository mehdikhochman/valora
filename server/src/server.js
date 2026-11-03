// Starts the HTTP server. Configuration comes from environment variables (see .env.example).
import { config } from './config.js';
import { buildApp } from './app.js';

const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, closing`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
