import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const BUCKET = process.env.S3_BUCKET!;
const PREFIX = (process.env.S3_PREFIX || "ingested/urls").replace(/^\/+|\/+$/g, "");

const s3 = new S3Client({ region });

/**
 * Create a safe filename from URL
 */
function createSafeFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    // Create filename from domain and path
    let filename = urlObj.hostname + urlObj.pathname;
    
    // Replace invalid characters with underscores
    filename = filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    // Ensure it ends with .txt
    if (!filename.endsWith('.txt')) {
      filename += '.txt';
    }
    
    // Limit length and add hash suffix to avoid conflicts
    if (filename.length > 100) {
      const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 8);
      const extension = '.txt';
      const maxBaseLength = 100 - extension.length - hash.length - 1;
      filename = filename.slice(0, maxBaseLength) + '_' + hash + extension;
    }
    
    return filename;
  } catch (e) {
    // Fallback for invalid URLs
    const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
    return `url_${hash}.txt`;
  }
}

export async function putTextToS3(text: string, urlOrKey: string) {
  if (!BUCKET) throw new Error("S3_BUCKET required");
  
  let key: string;
  let isDirectKey = false;
  
  // Check if this is a direct S3 key (for document editing)
  if (urlOrKey.startsWith('s3-direct:')) {
    key = urlOrKey.replace('s3-direct:', '');
    isDirectKey = true;
  } else {
    // Original URL-based logic
    const filename = createSafeFilename(urlOrKey);
    key = `${PREFIX}/${filename}`;
  }
  
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  
  const metadata: Record<string, string> = {
    sha256
  };
  
  if (isDirectKey) {
    metadata.updated_at = new Date().toISOString();
  } else {
    metadata.source_url = urlOrKey;
    metadata.ingested_at = new Date().toISOString();
  }
  
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: text,
    ContentType: "text/plain; charset=utf-8",
    Metadata: metadata
  }));
  
  return { key, s3_uri: `s3://${BUCKET}/${key}` };
}

/**
 * Get text content from S3
 */
export async function getTextFromS3(key: string): Promise<string> {
  if (!BUCKET) throw new Error("S3_BUCKET required");
  
  const response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key
  }));
  
  if (!response.Body) {
    throw new Error("No content found");
  }
  
  // Convert stream to string
  const bodyContents = await response.Body.transformToString();
  return bodyContents;
}
