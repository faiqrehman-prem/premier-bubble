import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE = process.env.DDB_TABLE || "url_ingestions";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

type IngestItem = {
  url: string;
  created_at: string;
  s3_uri?: string;
  text_sha256?: string;
  status?: string;
  error?: string;
  kb_id?: string;
  data_source_id?: string;
};

export async function upsertIngestion(item: IngestItem) {
  if (!item.url || !item.created_at) throw new Error("url and created_at required");
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: item
  }));
}

export async function setIngestionStatus(p: { 
  url: string; 
  created_at: string; 
  status: string; 
  error?: string;
  kb_id?: string;
  data_source_id?: string;
}) {
  const updateExpression = "SET #s = :s, #e = :e";
  const expressionAttributeNames: any = { "#s": "status", "#e": "error" };
  const expressionAttributeValues: any = { ":s": p.status, ":e": p.error ?? null };

  // Add kb_id and data_source_id if provided
  if (p.kb_id) {
    updateExpression.replace("SET ", "SET #kb = :kb, ");
    expressionAttributeNames["#kb"] = "kb_id";
    expressionAttributeValues[":kb"] = p.kb_id;
  }
  if (p.data_source_id) {
    updateExpression.replace("SET ", "SET #ds = :ds, ");
    expressionAttributeNames["#ds"] = "data_source_id";
    expressionAttributeValues[":ds"] = p.data_source_id;
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { url: p.url, created_at: p.created_at },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  }));
}
