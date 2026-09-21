import { bulkSetStatus } from '@/api/client';
import type { AssetStatus, BulkResult } from '@/lib/types';

export const BULK_STATUS_CHUNK_SIZE = 50;
export const BULK_STATUS_CONCURRENCY = 2;

export type BulkChunkOutcome =
  | { ids: string[]; ok: true; result: BulkResult }
  | { ids: string[]; ok: false; error: unknown };

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += BULK_STATUS_CHUNK_SIZE) {
    chunks.push(ids.slice(start, start + BULK_STATUS_CHUNK_SIZE));
  }
  return chunks;
}

export async function runBulkStatusRequests(
  ids: string[],
  status: AssetStatus,
): Promise<BulkChunkOutcome[]> {
  const chunks = chunkIds(ids);
  const outcomes = new Array<BulkChunkOutcome>(chunks.length);
  let nextChunkIndex = 0;

  async function runWorker() {
    while (nextChunkIndex < chunks.length) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const chunk = chunks[chunkIndex];
      if (!chunk) return;

      try {
        outcomes[chunkIndex] = {
          ids: chunk,
          ok: true,
          result: await bulkSetStatus(chunk, status),
        };
      } catch (error) {
        outcomes[chunkIndex] = { ids: chunk, ok: false, error };
      }
    }
  }

  const workerCount = Math.min(BULK_STATUS_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return outcomes;
}
