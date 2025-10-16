/**
 * Widget Build Script
 * Minifies and obfuscates the embed widget and widget loader for production
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const WIDGET_SOURCE_PATH = path.join(__dirname, '../public/embed-widget.js');
const WIDGET_OUTPUT_PATH = path.join(__dirname, '../public/embed-widget.min.js');
const WIDGET_BACKUP_PATH = path.join(__dirname, '../public/embed-widget.dev.js');

const LOADER_SOURCE_PATH = path.join(__dirname, '../public/widget-loader.js');
const LOADER_OUTPUT_PATH = path.join(__dirname, '../public/widget-loader.min.js');

async function buildFile(sourcePath, outputPath, backupPath, name) {
  try {
    console.log(`🔨 Building ${name}...`);
    
    // Read the source file
    const sourceCode = fs.readFileSync(sourcePath, 'utf8');
    
    // Create backup if specified
    if (backupPath) {
      fs.writeFileSync(backupPath, sourceCode);
      console.log(`💾 Backup saved to ${path.basename(backupPath)}`);
    }
    
    // Minify and obfuscate
    const result = await minify(sourceCode, {
      compress: {
        dead_code: true,
        drop_console: false, // Keep console for important loader messages
        drop_debugger: true,
        keep_fargs: false,
        unsafe_comps: true,
        unsafe_math: true,
        passes: 2
      },
      mangle: {
        toplevel: true,
        properties: {
          regex: /^_/ // Mangle properties starting with underscore
        }
      },
      format: {
        comments: false, // Remove all comments
        beautify: false
      }
    });

    if (result.error) {
      throw result.error;
    }

    // Write minified version
    fs.writeFileSync(outputPath, result.code);
    console.log(`✅ Minified ${name} saved to ${path.basename(outputPath)}`);
    
    // Replace original with minified version
    fs.writeFileSync(sourcePath, result.code);
    console.log(`🔒 Production ${name} deployed`);
    
    // Show size comparison
    const originalSize = Buffer.byteLength(sourceCode, 'utf8');
    const minifiedSize = Buffer.byteLength(result.code, 'utf8');
    const savings = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
    
    console.log(`📊 ${name} size: ${originalSize} → ${minifiedSize} bytes (${savings}% smaller)`);
    
    return { originalSize, minifiedSize };
  } catch (error) {
    console.error(`❌ ${name} build failed:`, error);
    throw error;
  }
}

async function buildWidget() {
  try {
    console.log('🚀 Starting widget build process...\n');
    
    // Build widget loader
    await buildFile(LOADER_SOURCE_PATH, LOADER_OUTPUT_PATH, null, 'Widget Loader');
    console.log('');
    
    // Build main widget
    await buildFile(WIDGET_SOURCE_PATH, WIDGET_OUTPUT_PATH, WIDGET_BACKUP_PATH, 'Main Widget');
    
    console.log('\n✅ All widgets built successfully!');
    console.log('\n📝 Usage:');
    console.log('  For clients: <script src="/widget-loader.js"></script>');
    console.log('  Direct embed: <script src="/embed-widget.js"></script>');
    
  } catch (error) {
    console.error('❌ Build process failed:', error);
    process.exit(1);
  }
}

buildWidget();
