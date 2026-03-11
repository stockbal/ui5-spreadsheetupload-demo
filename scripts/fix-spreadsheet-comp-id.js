#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

// Hardcoded base path for file modifications
const BASE_PATH = 'thirdparty/customcontrol/spreadsheetimporter/v1_7_4/';

/**
 * Parse ui5-deploy.yaml to extract metadata.name and archiveName
 */
function parseUI5DeployYaml() {
  const yamlPath = path.join(process.cwd(), 'ui5-deploy.yaml');
  
  if (!fs.existsSync(yamlPath)) {
    throw new Error('ui5-deploy.yaml not found in current directory');
  }
  
  const content = fs.readFileSync(yamlPath, 'utf8');
  const lines = content.split('\n');
  
  let metadataName = null;
  let archiveName = null;
  let inMetadata = false;
  let inZipperConfig = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Check if we're entering metadata section
    if (trimmedLine === 'metadata:') {
      inMetadata = true;
      continue;
    }
    
    // Extract metadata.name
    if (inMetadata && trimmedLine.startsWith('name:')) {
      metadataName = trimmedLine.substring(5).trim().replace(/["']/g, '');
      inMetadata = false;
    }
    
    // Check if we're in ui5-task-zipper configuration
    if (trimmedLine === '- name: ui5-task-zipper') {
      inZipperConfig = true;
      continue;
    }
    
    // Extract archiveName from zipper config
    if (inZipperConfig && trimmedLine.startsWith('archiveName:')) {
      archiveName = trimmedLine.substring(12).trim().replace(/["']/g, '');
      inZipperConfig = false;
    }
    
    // Exit zipper config section if we hit another task
    if (inZipperConfig && trimmedLine.startsWith('- name:') && !trimmedLine.includes('ui5-task-zipper')) {
      inZipperConfig = false;
    }
  }
  
  if (!metadataName) {
    throw new Error('Could not find metadata.name in ui5-deploy.yaml');
  }
  
  if (!archiveName) {
    throw new Error('Could not find archiveName in ui5-task-zipper configuration');
  }
  
  return { metadataName, archiveName };
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet') || args.includes('-q');
  
  return { quiet };
}

/**
 * Generate configuration from ui5-deploy.yaml
 */
function generateConfig() {
  const { metadataName, archiveName } = parseUI5DeployYaml();
  
  // Remove dots from metadata.name to create app-id
  const appId = metadataName.replace(/\./g, '');
  
  // Generate zip file path
  const zipFile = path.join('dist', `${archiveName}.zip`);
  
  // Generate replacement patterns
  const replacements = [
    {
      search: 'cc\\.spreadsheetimporter',
      replace: `${appId}.cc.spreadsheetimporter`
    },
    {
      search: 'cc/spreadsheetimporter',
      replace: `${appId}/cc/spreadsheetimporter`
    }
  ];
  
  return { zipFile, replacements, appId, metadataName };
}

/**
 * Normalize path separators to forward slashes
 */
function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

/**
 * Apply all replacements to the content
 */
function applyReplacements(content, replacements) {
  let modifiedContent = content;
  let hasChanges = false;
  
  for (const { search, replace } of replacements) {
    // Create a global regex from the search string (escape special regex chars if needed)
    const regex = new RegExp(search, 'g');
    const before = modifiedContent;
    modifiedContent = modifiedContent.replace(regex, replace);
    
    if (before !== modifiedContent) {
      hasChanges = true;
    }
  }
  
  return { modifiedContent, hasChanges };
}

/**
 * Modify files in the ZIP archive
 */
async function modifyZipFiles(zipFilePath, replacements, quiet = false) {
  // Check if ZIP file exists
  if (!fs.existsSync(zipFilePath)) {
    throw new Error(`ZIP file not found: ${zipFilePath}`);
  }

  console.log(`Loading ZIP file: ${zipFilePath}`);
  const zipData = fs.readFileSync(zipFilePath);
  const zip = await JSZip.loadAsync(zipData);

  const normalizedBasePath = normalizePath(BASE_PATH);
  let filesProcessed = 0;
  let filesModified = 0;

  if (!quiet) {
    console.log(`\nSearching for files in path: ${normalizedBasePath}`);
    console.log(`Replacement patterns: ${replacements.length}`);
    replacements.forEach(({ search, replace }, index) => {
      console.log(`  ${index + 1}. "${search}" -> "${replace}"`);
    });
    console.log();
  }

  // Iterate through all files in the ZIP
  const filePromises = [];
  
  zip.forEach((relativePath, file) => {
    const normalizedPath = normalizePath(relativePath);
    
    // Check if this file is under our base path and is not a directory
    if (!file.dir && normalizedPath.startsWith(normalizedBasePath)) {
      filePromises.push(
        (async () => {
          try {
            // Read file content as text
            const content = await file.async('text');
            
            // Apply replacements
            const { modifiedContent, hasChanges } = applyReplacements(content, replacements);
            
            if (hasChanges) {
              // Update the file in the ZIP
              zip.file(relativePath, modifiedContent);
              if (!quiet) {
                console.log(`✓ Modified: ${relativePath}`);
              }
              filesModified++;
            } else {
              if (!quiet) {
                console.log(`  Skipped (no matches): ${relativePath}`);
              }
            }
            
            filesProcessed++;
          } catch (error) {
            console.error(`✗ Error processing ${relativePath}: ${error.message}`);
          }
        })()
      );
    }
  });

  // Wait for all file processing to complete
  await Promise.all(filePromises);

  console.log(`\nProcessed ${filesProcessed} file(s), modified ${filesModified} file(s)`);

  if (filesModified > 0) {
    // Generate the modified ZIP
    console.log(`\nWriting modified ZIP file...`);
    const modifiedZipData = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    });

    // Overwrite the original ZIP file
    fs.writeFileSync(zipFilePath, modifiedZipData);
    console.log(`✓ Successfully updated: ${zipFilePath}`);
  } else {
    console.log('\nNo files were modified. ZIP file unchanged.');
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    const { quiet } = parseArguments();
    
    console.log('='.repeat(60));
    console.log('Spreadsheet Importer Component ID Modifier');
    console.log('='.repeat(60));
    
    // Generate configuration from ui5-deploy.yaml
    const { zipFile, replacements, appId, metadataName } = generateConfig();
    
    console.log(`\nConfiguration from ui5-deploy.yaml:`);
    console.log(`  App name: ${metadataName}`);
    console.log(`  App ID: ${appId}`);
    console.log(`  ZIP file: ${zipFile}\n`);
    
    await modifyZipFiles(zipFile, replacements, quiet);
    
    console.log('\n' + '='.repeat(60));
    console.log('Done!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
