import type { DownloadJob } from './types';

export function shouldApplyDownloadReaction(job: DownloadJob, accountRevision: number): boolean {
  return job.combined && job.accountRevision === accountRevision &&
    ['complete', 'failed', 'cancelled'].includes(job.status);
}
