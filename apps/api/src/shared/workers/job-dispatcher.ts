import { processBookingJob } from '../../services/booking/jobs';
import { processPaymentJob } from '../../services/payments/jobs';
import { type Job } from '../types';

export async function processJob(job: Job) {
  if (['expire', 'cancel', 'claim'].includes(job.kind))
    await processBookingJob(job);
  else await processPaymentJob(job);
}
