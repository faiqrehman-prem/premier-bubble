import { config } from 'dotenv';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

// Load environment variables
config();

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE_NAME = process.env.APP_CONFIGURATIONS_TABLE || "app_configurations";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

async function checkDomainConfigs() {
  try {
    console.log("Checking for existing domain configurations in DynamoDB...");
    console.log(`Table: ${TABLE_NAME}`);
    
    const response = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "config_type = :config_type",
      ExpressionAttributeValues: {
        ":config_type": "domain_config"
      }
    }));

    console.log(`Found ${response.Items?.length || 0} domain config entries:`);
    
    if (response.Items && response.Items.length > 0) {
      response.Items.forEach((item, index) => {
        console.log(`\n--- Domain Config ${index + 1} ---`);
        console.log(`config_id: ${item.config_id}`);
        console.log(`config_data:`, JSON.stringify(item.config_data, null, 2));
        console.log(`created_at: ${item.created_at}`);
        console.log(`updated_at: ${item.updated_at}`);
      });
    } else {
      console.log("No domain configurations found in DynamoDB.");
    }

    // Also scan for any other config types to see the full table structure
    console.log("\n\nAll config types in table:");
    const allConfigsResponse = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: "config_type, config_id"
    }));

    const configTypes = new Set<string>();
    allConfigsResponse.Items?.forEach(item => {
      configTypes.add(item.config_type);
    });

    Array.from(configTypes).forEach(type => {
      const count = allConfigsResponse.Items?.filter(item => item.config_type === type).length || 0;
      console.log(`- ${type}: ${count} entries`);
    });

  } catch (error) {
    console.error("Error checking domain configurations:", error);
  }
}

if (require.main === module) {
  checkDomainConfigs();
}
