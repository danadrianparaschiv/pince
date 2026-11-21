import { app } from '@azure/functions';
import { AzureStore } from './azure-store.js';
import { makeApp } from './app.js';
import { clientAddress } from './client-address.js';
let handle;
app.setup({ enableHttpStream: true });
app.http('library', {
  route: '{*path}',
  authLevel: 'anonymous',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  handler: async function (request) {
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING)
      return { status: 503, jsonBody: { error: 'configuration' } };
    handle ??= makeApp({
      store: new AzureStore(process.env.AZURE_STORAGE_CONNECTION_STRING),
      env: process.env,
    });
    const response = await handle(request, clientAddress(request.headers));
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    };
  },
});
