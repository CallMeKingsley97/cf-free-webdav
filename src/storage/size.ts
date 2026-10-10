import { MAX_TREE_OBJECTS, StorageLimitError } from "./r2.js";

export async function estimatePrefixSize(bucket: R2Bucket, prefix: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  while (true) {
    const page = await bucket.list({ prefix, cursor, limit: MAX_TREE_OBJECTS });
    total += page.objects.reduce((sum, object) => sum + object.size, 0);
    if (!page.truncated) return total;
    if (!page.cursor) throw new StorageLimitError();
    cursor = page.cursor;
  }
}

export async function estimateUsageSize(bucket: R2Bucket): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  while (true) {
    const page = await bucket.list({ cursor, limit: MAX_TREE_OBJECTS });
    total += page.objects.reduce((sum, object) => sum + object.size, 0);
    if (!page.truncated) return total;
    if (!page.cursor) throw new StorageLimitError();
    cursor = page.cursor;
  }
}
