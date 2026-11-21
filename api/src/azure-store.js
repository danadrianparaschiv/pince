import { TableClient, odata } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueClient } from '@azure/storage-queue';

export class AzureStore {
  constructor(connection) {
    this.table = TableClient.fromConnectionString(connection, 'LibraryData', {
      allowInsecureConnection: connection.includes('UseDevelopmentStorage=true'),
    });
    this.images = BlobServiceClient.fromConnectionString(connection).getContainerClient('covers');
    this.coverQueue = new QueueClient(connection, 'library-cover-jobs');
  }
  async enqueueCover(job, visibilityTimeout = 0) {
    await this.coverQueue.sendMessage(Buffer.from(JSON.stringify(job)).toString('base64'), {
      visibilityTimeout, messageTimeToLive: 604800,
    });
  }
  async get(group, key) {
    try {
      const row = await this.table.getEntity(group, key);
      return { value: JSON.parse(row.data), etag: row.etag };
    } catch (error) {
      if (error.statusCode === 404 && error.code !== 'TableNotFound') return null;
      throw error;
    }
  }
  async cas(group, key, etag, value) {
    const row = { partitionKey: group, rowKey: key, data: JSON.stringify(value) };
    try {
      if (etag) await this.table.updateEntity(row, 'Replace', { etag });
      else await this.table.createEntity(row);
      return true;
    } catch (error) {
      if ([409, 412].includes(error.statusCode)) return false;
      throw error;
    }
  }
  async list(group) {
    const rows = [];
    for await (const row of this.table.listEntities({
      queryOptions: { filter: odata`PartitionKey eq ${group}`, select: ['data'] },
    }))
      rows.push(JSON.parse(row.data));
    return rows;
  }
  async putImage(name, bytes) {
    await this.images
      .getBlockBlobClient(name)
      .uploadData(bytes, { blobHTTPHeaders: { blobContentType: 'image/jpeg' } });
  }
  async getImage(name) {
    return this.images.getBlockBlobClient(name).downloadToBuffer();
  }
  async deleteImage(name) {
    await this.images.getBlockBlobClient(name).deleteIfExists();
  }
}
