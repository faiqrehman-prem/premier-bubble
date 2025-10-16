import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ScriptTemplateManager, ScriptConfig } from '../services/script-template-manager';

// Load environment variables
config();

async function migrateScriptTemplates() {
  try {
    console.log("Starting script templates migration...");
    
    // Load the script-templates.json file
    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    const configPath = path.join(configDir, 'script-templates.json');
    
    console.log(`Loading script templates from: ${configPath}`);
    
    if (!fs.existsSync(configPath)) {
      console.error("script-templates.json file not found!");
      return;
    }
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const scriptConfig: ScriptConfig = JSON.parse(configContent);
    
    console.log(`Found ${Object.keys(scriptConfig.scripts).length} script templates to migrate`);
    console.log("Script templates from file:");
    Object.entries(scriptConfig.scripts).forEach(([id, template]) => {
      console.log(`  - ${id}: ${template.name} (${template.type}, external: ${template.external || false})`);
    });
    
    // Show current DynamoDB state
    console.log("\nCurrent DynamoDB state:");
    const currentScripts = await ScriptTemplateManager.getAllScriptTemplates();
    if (Object.keys(currentScripts).length > 0) {
      Object.entries(currentScripts).forEach(([id, template]) => {
        console.log(`  - ${id}: ${template.name} (${template.type}, external: ${template.external || false})`);
      });
    } else {
      console.log("  No script templates found in DynamoDB");
    }
    
    // Perform migration
    console.log("\nStarting migration...");
    const result = await ScriptTemplateManager.migrateFromConfig(scriptConfig);
    
    console.log(`\nMigration completed!`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Script templates migrated: ${result.migrated}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log("\nErrors encountered:");
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    // Show final DynamoDB state
    console.log("\nFinal DynamoDB state:");
    const finalScripts = await ScriptTemplateManager.getAllScriptTemplates();
    Object.entries(finalScripts).forEach(([id, template]) => {
      console.log(`  - ${id}: ${template.name} (${template.type}, external: ${template.external || false})`);
    });
    
    // Show script template names for UI dropdown
    console.log("\nAvailable script templates for UI:");
    const scriptNames = await ScriptTemplateManager.getScriptTemplateNames();
    scriptNames.forEach(script => {
      console.log(`  - ${script.id}: ${script.name} - ${script.description}`);
    });
    
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

if (require.main === module) {
  migrateScriptTemplates();
}
