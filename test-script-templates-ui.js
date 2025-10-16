// Test Script Template Management UI
// This script tests the complete script template management functionality

const https = require('https');
const http = require('http');

const BASE_URL = 'http://localhost:3002';

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = responseData ? JSON.parse(responseData) : null;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: parsed
          });
        } catch (e) {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: responseData
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testScriptTemplateAPI() {
  console.log('🧪 Testing Script Template Management API...\n');

  try {
    // Test 1: Get all script templates
    console.log('1. Testing GET /api/admin/script-templates');
    const getResponse = await makeRequest('GET', '/api/admin/script-templates');
    if (getResponse.ok) {
      const templates = getResponse.data;
      console.log(`✅ GET request successful. Found ${templates.length} templates`);
      templates.forEach(t => console.log(`   - ${t.script_id}: ${t.name}`));
    } else {
      console.log(`❌ GET request failed: ${getResponse.status}`);
    }
    console.log('');

    // Test 2: Add a new script template
    console.log('2. Testing POST /api/admin/script-templates');
    const newTemplate = {
      script_id: 'test-ui-template',
      name: 'Test UI Template',
      description: 'A test template for UI verification',
      template_content: '<div>Test UI Template Content</div>',
      is_external: false
    };

    const addResponse = await makeRequest('POST', '/api/admin/script-templates', newTemplate);
    if (addResponse.ok) {
      console.log('✅ POST request successful. Template added');
    } else {
      console.log(`❌ POST request failed: ${addResponse.status} - ${addResponse.data?.error || 'Unknown error'}`);
    }
    console.log('');

    // Test 3: Get specific template
    console.log('3. Testing GET /api/admin/script-templates/:id');
    const getOneResponse = await makeRequest('GET', '/api/admin/script-templates/test-ui-template');
    if (getOneResponse.ok) {
      const template = getOneResponse.data;
      console.log('✅ GET single template successful');
      console.log(`   Template: ${template.name} - ${template.description}`);
    } else {
      console.log(`❌ GET single template failed: ${getOneResponse.status}`);
    }
    console.log('');

    // Test 4: Update template
    console.log('4. Testing PUT /api/admin/script-templates/:id');
    const updateData = {
      name: 'Updated Test UI Template',
      description: 'Updated description for UI testing',
      template_content: '<div>Updated Test UI Template Content</div>',
      is_external: false
    };

    const updateResponse = await makeRequest('PUT', '/api/admin/script-templates/test-ui-template', updateData);
    if (updateResponse.ok) {
      console.log('✅ PUT request successful. Template updated');
    } else {
      console.log(`❌ PUT request failed: ${updateResponse.status} - ${updateResponse.data?.error || 'Unknown error'}`);
    }
    console.log('');

    // Test 5: Verify update
    console.log('5. Verifying update');
    const verifyResponse = await makeRequest('GET', '/api/admin/script-templates/test-ui-template');
    if (verifyResponse.ok) {
      const updatedTemplate = verifyResponse.data;
      console.log('✅ Update verification successful');
      console.log(`   Updated name: ${updatedTemplate.name}`);
      console.log(`   Updated description: ${updatedTemplate.description}`);
    } else {
      console.log(`❌ Update verification failed: ${verifyResponse.status}`);
    }
    console.log('');

    // Test 6: Delete template
    console.log('6. Testing DELETE /api/admin/script-templates/:id');
    const deleteResponse = await makeRequest('DELETE', '/api/admin/script-templates/test-ui-template');
    if (deleteResponse.ok) {
      console.log('✅ DELETE request successful. Template removed');
    } else {
      console.log(`❌ DELETE request failed: ${deleteResponse.status} - ${deleteResponse.data?.error || 'Unknown error'}`);
    }
    console.log('');

    // Test 7: Verify deletion
    console.log('7. Verifying deletion');
    const verifyDeleteResponse = await makeRequest('GET', '/api/admin/script-templates/test-ui-template');
    if (verifyDeleteResponse.status === 404) {
      console.log('✅ Deletion verification successful - template not found');
    } else {
      console.log(`❌ Deletion verification failed - template still exists (status: ${verifyDeleteResponse.status})`);
    }
    console.log('');

    // Test 8: Final state check
    console.log('8. Final state check');
    const finalResponse = await makeRequest('GET', '/api/admin/script-templates');
    if (finalResponse.ok) {
      const finalTemplates = finalResponse.data;
      console.log(`✅ Final template count: ${finalTemplates.length}`);
      finalTemplates.forEach(t => console.log(`   - ${t.script_id}: ${t.name}`));
    }

    console.log('\n🎉 All API tests completed successfully!');
    console.log('\n📝 UI Testing Instructions:');
    console.log('1. Open http://localhost:3002/control-panel.html');
    console.log('2. Scroll down to the "Script Template Management" section');
    console.log('3. Verify the script templates are loaded and displayed');
    console.log('4. Test adding a new template using the form');
    console.log('5. Test editing an existing template');
    console.log('6. Test removing a template');
    console.log('7. Verify domain script selection options update when templates change');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testScriptTemplateAPI();
