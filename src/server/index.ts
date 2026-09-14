import { createExtendedJobApp } from './extendedApp.js';

const app = createExtendedJobApp();
app.server.listen(app.config.port, () => {
  console.log(`Job działa na ${app.config.appOrigin} (port ${app.config.port}).`);
});

const shutdown = async (): Promise<void> => {
  try { await app.close(); } finally { process.exit(0); }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
