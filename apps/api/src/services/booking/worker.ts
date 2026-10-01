process.env.SERVICE_NAME = 'booking';
void import('../../shared/workers/broker-worker').then(({ startWorker }) =>
  startWorker(),
);
