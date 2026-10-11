// Secrets configured after deployment are not present in wrangler.jsonc.
interface Env {
  WEBDAV_PASSWORD?: string;
  WEBDAV_USERNAME?: string;
  FILES?: R2Bucket;
  USAGE_STORE?: DurableObjectNamespace;
  QUOTA_CLASS_A_MAX?: string;
  QUOTA_CLASS_B_MAX?: string;
  QUOTA_STORAGE_MAX_BYTES?: string;
  QUOTA_THRESHOLD_PERCENT?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  SHARE_SECRET?: string;
  FEISHU_WEBHOOK_URL?: string;
  FEISHU_WEBHOOK_SECRET?: string;
  FEISHU_ALERT_PERCENT?: string;
  R2_BUCKET_NAME?: string;
}
