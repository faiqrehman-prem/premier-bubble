import { ToolConfigDynamoManager, UserDefinedTool } from '../services/tool-config-dynamo';
import * as fs from 'fs';
import * as path from 'path';

interface ToolConfiguration {
  user_tools: UserDefinedTool[];
}

/**
 * Migration script to move custom tools from tool-configurations.json to DynamoDB
 */
async function migrateToolsToDb() {
  console.log("🚀 Starting Phase 3 migration: Custom tools from file to DynamoDB");
  
  try {
    // Read existing tool configuration file
    const configPath = path.join(process.cwd(), 'tool-configurations.json');
    
    if (!fs.existsSync(configPath)) {
      console.log("❌ No tool-configurations.json file found");
      return;
    }

    console.log(`📁 Reading tools from: ${configPath}`);
    const configData = fs.readFileSync(configPath, 'utf8');
    const config: ToolConfiguration = JSON.parse(configData);
    
    if (!config.user_tools || !Array.isArray(config.user_tools)) {
      console.log("❌ No user_tools array found in configuration file");
      return;
    }

    console.log(`📋 Found ${config.user_tools.length} tools to migrate:`);
    config.user_tools.forEach((tool, index) => {
      console.log(`  ${index + 1}. ${tool.name} (${tool.type}, ${tool.enabled ? 'enabled' : 'disabled'})`);
    });

    // Perform migration
    console.log("\n🔄 Starting migration to DynamoDB...");
    const result = await ToolConfigDynamoManager.migrateFromFile(config.user_tools);

    // Report results
    console.log("\n📊 Migration Results:");
    console.log(`✅ Successfully migrated: ${result.migrated} tools`);
    
    if (result.errors.length > 0) {
      console.log(`❌ Errors encountered: ${result.errors.length}`);
      result.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (result.success) {
      console.log("\n🎉 Migration completed successfully!");
      
      // Verify migration by loading tools from DynamoDB
      console.log("\n🔍 Verifying migration...");
      const toolsFromDynamo = await ToolConfigDynamoManager.loadUserTools();
      console.log(`✅ Verification: Found ${toolsFromDynamo.length} tools in DynamoDB`);
      
      toolsFromDynamo.forEach((tool, index) => {
        console.log(`  ${index + 1}. ${tool.name} (${tool.type}, ${tool.enabled ? 'enabled' : 'disabled'})`);
      });
      
    } else {
      console.log("\n❌ Migration had errors. Please check the logs above.");
    }

  } catch (error) {
    console.error("💥 Migration failed:", error);
    process.exit(1);
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateToolsToDb()
    .then(() => {
      console.log("\n✨ Migration script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Migration script failed:", error);
      process.exit(1);
    });
}

export { migrateToolsToDb };
