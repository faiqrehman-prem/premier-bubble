import { ConfigManager } from '../services/config-manager';

async function testConfigManager() {
  try {
    console.log('🧪 Testing ConfigManager with existing DynamoDB data...\n');
    
    // Test loading configuration
    const config = await ConfigManager.getConfig();
    console.log('✅ Successfully loaded config:');
    console.log(JSON.stringify(config, null, 2));
    console.log('');
    
    // Test individual getters
    console.log('📋 Testing individual property getters...');
    
    const tools = await ConfigManager.getEnabledTools();
    console.log('✅ Enabled tools:', tools);
    
    const voice = await ConfigManager.getVoice();
    console.log('✅ Voice setting:', voice);
    
    const prompt = await ConfigManager.getSystemPrompt();
    console.log('✅ System prompt length:', prompt.length, 'characters');
    console.log('✅ System prompt preview:', prompt.substring(0, 100) + '...');
    
    console.log('\n🎉 All tests passed! ConfigManager is working with existing DynamoDB data.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testConfigManager();
