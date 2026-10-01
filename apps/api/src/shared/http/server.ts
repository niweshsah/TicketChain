export async function startHttpService(
  service?: 'identity' | 'booking' | 'payments' | 'catalog',
) {
  if (service) process.env.SERVICE_NAME = service;
  const { app } = await import('../../app');
  const { config } = await import('../config');
  const { db } = await import('../db');
  const { closeRedis } = await import('../infrastructure/redis');
  const server = app.listen(config.PORT, () =>
    console.log(
      JSON.stringify({
        event: 'api_started',
        service: config.SERVICE_NAME,
        port: config.PORT,
      }),
    ),
  );
  function shutdown() {
    server.close(() => {
      void closeRedis()
        .then(() => db.$disconnect())
        .then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
