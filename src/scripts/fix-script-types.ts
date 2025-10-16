import { config } from 'dotenv';
import { DomainConfigManager } from '../services/domain-config-manager';

// Load environment variables
config();

async function fixMissingScriptTypes() {
  try {
    console.log("Fixing missing script_type fields in existing domains...");
    
    const allDomains = await DomainConfigManager.getAllDomains();
    console.log(`Found ${allDomains.length} domains in DynamoDB`);
    
    let fixed = 0;
    let errors = 0;
    
    for (const domain of allDomains) {
      if (!domain.script_type) {
        console.log(`Fixing domain: ${domain.domain} (missing script_type)`);
        const result = await DomainConfigManager.updateDomainScriptType(domain.domain, "default");
        if (result.success) {
          fixed++;
          console.log(`  ✓ Fixed ${domain.domain}`);
        } else {
          errors++;
          console.log(`  ✗ Failed to fix ${domain.domain}: ${result.error}`);
        }
      } else {
        console.log(`Domain ${domain.domain} already has script_type: ${domain.script_type}`);
      }
    }
    
    console.log(`\nCompleted! Fixed ${fixed} domains, ${errors} errors`);
    
    // Verify final state
    console.log("\nFinal verification:");
    const finalDomains = await DomainConfigManager.getAllDomains();
    finalDomains.forEach(domain => {
      console.log(`  ${domain.domain}: script_type = ${domain.script_type || 'MISSING!'}`);
    });
    
  } catch (error) {
    console.error("Failed to fix script types:", error);
  }
}

if (require.main === module) {
  fixMissingScriptTypes();
}
