import { config } from 'dotenv';
import { ScriptTemplateManager } from '../services/script-template-manager';

// Load environment variables
config();

async function testScriptTemplateOperations() {
  try {
    console.log("=== Testing Script Template Operations ===\n");
    
    // Test 1: Get all script templates
    console.log("1. Getting all script templates...");
    const allTemplates = await ScriptTemplateManager.getAllScriptTemplates();
    console.log(`Found ${Object.keys(allTemplates).length} script templates:`);
    Object.entries(allTemplates).forEach(([id, template]) => {
      console.log(`  - ${id}: ${template.name} (external: ${template.external || false})`);
    });
    
    // Test 2: Get script template names for UI
    console.log("\n2. Getting script template names for UI...");
    const templateNames = await ScriptTemplateManager.getScriptTemplateNames();
    console.log("Template names:");
    templateNames.forEach(template => {
      console.log(`  - ${template.id}: ${template.name} - ${template.description}`);
    });
    
    // Test 3: Add a new custom script template
    console.log("\n3. Adding a new custom script template...");
    const customTemplate = {
      name: "Custom Widget",
      description: "A custom test widget template",
      template: "<div>Custom Widget: {{serverUrl}}</div><script src=\"{{serverUrl}}/custom-widget.js\"></script>",
      type: "custom",
      external: false
    };
    
    const addResult = await ScriptTemplateManager.addScriptTemplate("custom_test", customTemplate);
    console.log(`Add result: ${addResult ? 'Success' : 'Failed'}`);
    
    // Test 4: Get the specific script template
    console.log("\n4. Getting the custom script template...");
    const retrievedTemplate = await ScriptTemplateManager.getScriptTemplate("custom_test");
    if (retrievedTemplate) {
      console.log(`Retrieved: ${retrievedTemplate.name} - ${retrievedTemplate.description}`);
      console.log(`Template: ${retrievedTemplate.template}`);
    } else {
      console.log("Failed to retrieve custom template");
    }
    
    // Test 5: Update the script template
    console.log("\n5. Updating the custom script template...");
    const updatedTemplate = {
      description: "An updated custom test widget template"
    };
    const updateResult = await ScriptTemplateManager.updateScriptTemplate("custom_test", updatedTemplate);
    console.log(`Update result: ${updateResult ? 'Success' : 'Failed'}`);
    
    // Test 6: Validate script template structure
    console.log("\n6. Testing script template validation...");
    const invalidTemplate = {
      name: "Invalid Template"
      // Missing required fields
    };
    const validation = ScriptTemplateManager.validateScriptTemplate(invalidTemplate);
    console.log(`Validation result: ${validation.valid ? 'Valid' : 'Invalid'}`);
    if (!validation.valid) {
      console.log("Validation errors:");
      validation.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    // Test 7: Get all templates again to see changes
    console.log("\n7. Getting all script templates after modifications...");
    const finalTemplates = await ScriptTemplateManager.getAllScriptTemplates();
    console.log(`Final count: ${Object.keys(finalTemplates).length} script templates:`);
    Object.entries(finalTemplates).forEach(([id, template]) => {
      console.log(`  - ${id}: ${template.name} (${template.description})`);
    });
    
    // Test 8: Clean up - remove the test template
    console.log("\n8. Cleaning up - removing test template...");
    const removeResult = await ScriptTemplateManager.removeScriptTemplate("custom_test");
    console.log(`Remove result: ${removeResult ? 'Success' : 'Failed'}`);
    
    // Test 9: Try to remove default template (should fail)
    console.log("\n9. Testing protection of default template...");
    const removeDefaultResult = await ScriptTemplateManager.removeScriptTemplate("default");
    console.log(`Remove default result: ${removeDefaultResult ? 'Success (unexpected!)' : 'Failed (expected)'}`);
    
    console.log("\n=== Script Template Operations Test Complete ===");
    
  } catch (error) {
    console.error("Test failed:", error);
  }
}

if (require.main === module) {
  testScriptTemplateOperations();
}
