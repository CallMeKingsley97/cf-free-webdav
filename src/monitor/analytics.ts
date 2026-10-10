const CLASS_A_ACTIONS = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "ListObjectsV1",
  "ListObjectsV2",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

const CLASS_B_ACTIONS = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

export interface R2UsageSnapshot {
  classAOperations: number;
  classBOperations: number;
  storageBytes: number;
}

interface OperationsGroup {
  sum: { requests: number };
  dimensions: { actionType: string };
}

interface StorageGroup {
  max: { payloadSize: number };
}

interface GraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        r2OperationsAdaptiveGroups?: OperationsGroup[];
        r2StorageAdaptiveGroups?: StorageGroup[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

export async function fetchOfficialUsage(
  accountId: string,
  apiToken: string,
  bucketName: string,
  startOfMonth: string,
): Promise<R2UsageSnapshot> {
  const now = new Date();
  const query = `
    query R2Usage($accountTag: string!, $startDate: Time, $endDate: Time, $bucketName: string) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: {
              datetime_geq: $startDate
              datetime_leq: $endDate
              bucketName: $bucketName
            }
          ) {
            sum { requests }
            dimensions { actionType }
          }
          r2StorageAdaptiveGroups(
            limit: 1
            filter: {
              datetime_geq: $startDate
              datetime_leq: $endDate
              bucketName: $bucketName
            }
            orderBy: [datetime_DESC]
          ) {
            max { payloadSize }
          }
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: accountId,
        startDate: startOfMonth,
        endDate: now.toISOString(),
        bucketName,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cloudflare Analytics API returned ${response.status}: ${body}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }

  const account = result.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("Cloudflare Analytics API returned no account data.");

  let classA = 0;
  let classB = 0;
  for (const group of account.r2OperationsAdaptiveGroups ?? []) {
    if (CLASS_A_ACTIONS.has(group.dimensions.actionType)) classA += group.sum.requests;
    if (CLASS_B_ACTIONS.has(group.dimensions.actionType)) classB += group.sum.requests;
  }

  const storage = account.r2StorageAdaptiveGroups?.[0]?.max.payloadSize ?? 0;
  return { classAOperations: classA, classBOperations: classB, storageBytes: storage };
}

export function startOfMonthISO(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}
