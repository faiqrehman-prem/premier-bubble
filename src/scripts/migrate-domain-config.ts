import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { DomainConfigManager, AuthorizedDomainsConfig } from '../services/domain-config-manager';

// Load environment variables
config();

async function migrateDomainConfig() {
  try {
    console.log("Starting domain configuration migration...");
    
    // Load the authorized-domains.json file
    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    const configPath = path.join(configDir, 'authorized-domains.json');
    
    console.log(`Loading configuration from: ${configPath}`);
    
    if (!fs.existsSync(configPath)) {
      console.error("authorized-domains.json file not found!");
      return;
    }
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const domainConfig: AuthorizedDomainsConfig = JSON.parse(configContent);
    
    console.log(`Found ${domainConfig.authorized_domains.length} domains to migrate`);
    console.log("Domains from file:");
    domainConfig.authorized_domains.forEach((domain, index) => {
      console.log(`  ${index + 1}. ${domain.domain} (enabled: ${domain.enabled}, script_type: ${domain.script_type || 'default'})`);
    });
    
    // Show current DynamoDB state
    console.log("\nCurrent DynamoDB state:");
    const currentDomains = await DomainConfigManager.getAllDomains();
    if (currentDomains.length > 0) {
      currentDomains.forEach((domain, index) => {
        console.log(`  ${index + 1}. ${domain.domain} (enabled: ${domain.enabled}, script_type: ${domain.script_type || 'missing!'})`);
      });
    } else {
      console.log("  No domains found in DynamoDB");
    }
    
    // Perform migration
    console.log("\nStarting migration...");
    const result = await DomainConfigManager.migrateFromConfig(domainConfig);
    
    console.log(`\nMigration completed!`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Domains migrated: ${result.migrated}`);
    console.log(`  Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log("\nErrors encountered:");
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    // Show final DynamoDB state
    console.log("\nFinal DynamoDB state:");
    const finalDomains = await DomainConfigManager.getAllDomains();
    finalDomains.forEach((domain, index) => {
      console.log(`  ${index + 1}. ${domain.domain} (enabled: ${domain.enabled}, script_type: ${domain.script_type})`);
    });
    
    const finalSettings = await DomainConfigManager.getDomainSettings();
    console.log("\nDomain settings:");
    console.log(`  strict_mode: ${finalSettings.strict_mode}`);
    console.log(`  allow_subdomains: ${finalSettings.allow_subdomains}`);
    console.log(`  require_https: ${finalSettings.require_https}`);
    console.log(`  max_requests_per_minute: ${finalSettings.max_requests_per_minute}`);
    
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

if (require.main === module) {
  migrateDomainConfig();
}
