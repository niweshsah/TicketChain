process.env.SERVICE_NAME = 'payments';
void import('../../shared/workers/broker-worker').then(({ startWorker }) =>
  startWorker(),
);
