process.env.SERVICE_NAME = 'catalog';
void import('../../shared/workers/broker-worker').then(({ startWorker }) =>
  startWorker(),
);
