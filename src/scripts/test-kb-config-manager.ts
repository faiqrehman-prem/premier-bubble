import { KBConfigManager } from '../services/kb-config-manager';

async function testKBConfigManager() {
  try {
    console.log('🧪 Testing KBConfigManager with existing DynamoDB data...\n');
    
    // Test loading KB configuration
    const config = await KBConfigManager.getKBConfig();
    console.log('✅ Successfully loaded KB config:');
    console.log(JSON.stringify(config, null, 2));
    console.log('');
    
    // Test individual getters
    console.log('📋 Testing individual property getters...');
    
    const kbId = await KBConfigManager.getKnowledgeBaseId();
    console.log('✅ Knowledge Base ID:', kbId);
    
    const kbName = await KBConfigManager.getKnowledgeBaseName();
    console.log('✅ Knowledge Base Name:', kbName);
    
    // Test legacy format
    const legacyFormat = await KBConfigManager.getLegacyFormat();
    console.log('✅ Legacy format:', legacyFormat);
    
    console.log('\n🎉 All KBConfigManager tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testKBConfigManager();
