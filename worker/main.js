import { app } from '@azure/functions';
import { QueueClient } from '@azure/storage-queue';
import { ManagedIdentityCredential } from '@azure/identity';
import { drainCoverQueue, processQueuedCover } from './src/cover-dispatch.js';

const queue = new QueueClient(process.env.COVER_QUEUE_URL,
  new ManagedIdentityCredential({ clientId: process.env.AZURE_CLIENT_ID }));
app.timer('findBookCovers', {
  schedule: '0 * * * * *', useMonitor: true,
  handler: () => drainCoverQueue(queue, job => processQueuedCover(job, process.env)),
});
