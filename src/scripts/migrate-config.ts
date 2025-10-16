import { ConfigManager, AppConfig } from '../services/config-manager';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Migration script to transfer config.json data to DynamoDB
 * Run this once to migrate existing configuration
 */
async function migrateConfigToDynamoDB() {
  console.log("🚀 Starting config.json migration to DynamoDB...");
  
  try {
    // Read existing config.json file
    const configPath = path.resolve(__dirname, "../../config.json");
    
    if (!fs.existsSync(configPath)) {
      console.log("❌ config.json file not found at:", configPath);
      process.exit(1);
    }

    console.log("📄 Reading config.json from:", configPath);
    const configContent = fs.readFileSync(configPath, 'utf8');
    const configData: AppConfig = JSON.parse(configContent);
    
    console.log("✅ Loaded configuration data:", JSON.stringify(configData, null, 2));

    // Validate configuration structure
    if (!configData.systemPrompt && configData.systemPrompt !== "") {
      console.log("⚠️  Warning: systemPrompt is missing, using default");
    }
    if (!configData.voice) {
      console.log("⚠️  Warning: voice is missing, using default 'matthew'");
    }
    if (!configData.chunkSize) {
      console.log("⚠️  Warning: chunkSize is missing, using default 512");
    }
    if (!Array.isArray(configData.enabledTools)) {
      console.log("⚠️  Warning: enabledTools is not an array, using default");
    }

    // Migrate to DynamoDB
    console.log("💾 Migrating configuration to DynamoDB...");
    await ConfigManager.migrateFromFile(configData);
    
    // Verify migration by reading back
    console.log("🔍 Verifying migration...");
    const migratedConfig = await ConfigManager.getConfig();
    console.log("✅ Successfully migrated configuration:", JSON.stringify(migratedConfig, null, 2));
    
    // Compare original and migrated data
    const isDataMatch = 
      migratedConfig.systemPrompt === configData.systemPrompt &&
      migratedConfig.voice === (configData.voice || "matthew") &&
      migratedConfig.chunkSize === (configData.chunkSize || 512) &&
      JSON.stringify(migratedConfig.enabledTools) === JSON.stringify(configData.enabledTools || ["retrieveFromKnowledgeBase"]);
    
    if (isDataMatch) {
      console.log("🎉 Migration successful! Data integrity verified.");
      console.log("🗃️  Configuration is now stored in DynamoDB table 'app_configurations'");
      console.log("📝 Config type: 'app_config', Config ID: 'main'");
      console.log("\n💡 Next steps:");
      console.log("   1. Update server.ts to use ConfigManager instead of file operations");
      console.log("   2. Test all configuration endpoints");
      console.log("   3. Backup and remove config.json file after testing");
    } else {
      console.log("❌ Migration verification failed! Data mismatch detected.");
      console.log("Original:", configData);
      console.log("Migrated:", migratedConfig);
      process.exit(1);
    }
    
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateConfigToDynamoDB().then(() => {
    console.log("✨ Migration completed successfully!");
    process.exit(0);
  }).catch((error) => {
    console.error("💥 Migration failed:", error);
    process.exit(1);
  });
}

export { migrateConfigToDynamoDB };
