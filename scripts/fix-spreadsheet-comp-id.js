#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");
const yazl = require("yazl");

/**
 * Parse ui5-deploy.yaml to extract metadata.name and archiveName
 */
function parseUI5DeployYaml() {
  const yamlPath = path.join(process.cwd(), "ui5-deploy.yaml");

  if (!fs.existsSync(yamlPath)) {
    throw new Error("ui5-deploy.yaml not found in current directory");
  }

  const content = fs.readFileSync(yamlPath, "utf8");
  const lines = content.split("\n");

  let archiveName = null;
  let inZipperConfig = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check if we're in ui5-task-zipper configuration
    if (trimmedLine === "- name: ui5-task-zipper") {
      inZipperConfig = true;
      continue;
    }

    // Extract archiveName from zipper config
    if (inZipperConfig && trimmedLine.startsWith("archiveName:")) {
      archiveName = trimmedLine.substring(12).trim().replace(/["']/g, "");
      inZipperConfig = false;
    }

    // Exit zipper config section if we hit another task
    if (inZipperConfig && trimmedLine.startsWith("- name:") && !trimmedLine.includes("ui5-task-zipper")) {
      inZipperConfig = false;
    }
  }

  if (!archiveName) {
    throw new Error("Could not find archiveName in ui5-task-zipper configuration");
  }

  return { archiveName };
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const quiet = args.includes("--quiet") || args.includes("-q");

  return { quiet };
}

/**
 * Read the calling app's manifest.json to get the service name
 */
function getAppInfoFromManifest() {
  const manifestPath = path.join(process.cwd(), "webapp", "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    console.warn("Warning: webapp/manifest.json not found, service name will not be updated");
    throw new Error("webapp/manifest.json not found");
  }

  try {
    const manifestContent = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    /** @type {string} */
    const serviceName = manifest?.["sap.cloud"]?.service;

    if (!serviceName) throw new Error("sap.cloud.service not defined in manifest.json");

    /** @type {string} */
    const appId = manifest?.["sap.app"]?.id;
    if (!appId) throw new Error("sap.app.id not defined in manifest.json");

    return { serviceName, appId };
  } catch (error) {
    throw new Error("Error reading webapp/manifest.json", { cause: error });
  }
}

/**
 * Generate configuration from ui5-deploy.yaml
 */
function generateConfig() {
  const { archiveName } = parseUI5DeployYaml();

  // Generate zip file path
  const zipFile = path.join("dist", `${archiveName}.zip`);

  // Get service name from app's manifest.json
  const { serviceName, appId } = getAppInfoFromManifest();

  // Remove dots from metadata.name to create app-id
  const condensedAppId = appId.replace(/\./g, "");

  // Generate replacement patterns
  const replacements = [
    {
      search: "cc\\.spreadsheetimporter",
      replace: `${condensedAppId}.cc.spreadsheetimporter`
    },
    {
      search: "cc/spreadsheetimporter",
      replace: `${condensedAppId}/cc/spreadsheetimporter`
    }
  ];

  return { zipFile, replacements, appId, serviceName };
}

/**
 * Apply all replacements to the content
 */
function applyReplacements(content, replacements) {
  let modifiedContent = content;
  let hasChanges = false;

  for (const { search, replace } of replacements) {
    // Create a global regex from the search string (escape special regex chars if needed)
    const regex = new RegExp(search, "g");
    const before = modifiedContent;
    modifiedContent = modifiedContent.replace(regex, replace);

    if (before !== modifiedContent) {
      hasChanges = true;
    }
  }

  return { modifiedContent, hasChanges };
}

/**
 * Update service name in manifest.json
 */
function updateManifestService(content, serviceName) {
  if (!serviceName) {
    return { modifiedContent: content, hasChanges: false };
  }

  try {
    const manifest = JSON.parse(content);

    if (manifest["sap.cloud"] && manifest["sap.cloud"].service) {
      manifest["sap.cloud"].service = serviceName;
      const modifiedContent = JSON.stringify(manifest, null, 2);
      return { modifiedContent, hasChanges: true };
    }

    return { modifiedContent: content, hasChanges: false };
  } catch (error) {
    console.warn(`Warning: Could not parse manifest.json: ${error.message}`);
    return { modifiedContent: content, hasChanges: false };
  }
}

/**
 * Update embedded manifest.json in Component-preload.js
 */
function updateComponentPreload(content, serviceName, replacements) {
  try {
    // Find the line with the embedded manifest.json
    const manifestKeyPattern = /^(\s*"[^"]*\/manifest\.json":)('([^']*)'|"([^"]*)")(,?)$/gm;

    let modifiedContent = content;
    let hasChanges = false;

    modifiedContent = content.replace(
      manifestKeyPattern,
      (match, key, quotedValue, singleQuoted, doubleQuoted, comma) => {
        try {
          // Extract the actual JSON string (remove outer quotes)
          const embeddedJson = singleQuoted || doubleQuoted;

          // Parse the embedded manifest
          const manifest = JSON.parse(embeddedJson);

          // Update the service name
          if (manifest["sap.cloud"] && manifest["sap.cloud"].service) {
            manifest["sap.cloud"].service = serviceName;
            hasChanges = true;
          }

          const manifestStr = JSON.stringify(manifest);

          // Re-stringify and return the modified line
          const escapedManifest = JSON.stringify(manifestStr);
          return `${key}${escapedManifest}${comma}`;
        } catch (error) {
          console.warn(`Warning: Could not parse embedded manifest in Component-preload.js: ${error.message}`);
          return match; // Return original if parsing fails
        }
      }
    );

    // perform regular replacements on the entire content (including the embedded manifest)
    ({ modifiedContent, hasChanges } = applyReplacements(modifiedContent, replacements));

    return {
      modifiedContent: modifiedContent,
      hasChanges: hasChanges
    };
  } catch (error) {
    console.warn(`Warning: Could not update embedded manifest: ${error.message}`);
    return applyReplacements(content, replacements);
  }
}

/**
 * Check if a file should be processed based on its extension
 */
function shouldProcessFile(fileName) {
  const allowedExtensions = [".js", ".json", ".ts", ".xml"];
  const ext = path.extname(fileName).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Process a single entry from the ZIP file
 */
async function processZipEntry(entry, zipFile, replacements, serviceName, quiet) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, readStream) => {
      if (err) {
        reject(err);
        return;
      }

      const chunks = [];
      readStream.on("data", (chunk) => chunks.push(chunk));
      readStream.on("end", () => {
        try {
          const content = Buffer.concat(chunks).toString("utf8");
          let modifiedContent = content;
          let hasChanges = false;

          const fileName = path.basename(entry.fileName);

          // Only process files with allowed extensions
          if (!shouldProcessFile(fileName)) {
            resolve({
              fileName: entry.fileName,
              content: content,
              hasChanges: false,
              originalContent: content
            });
            return;
          }

          // Special handling for manifest.json files
          if (fileName === "manifest.json") {
            // First, update the service name
            const serviceResult = updateManifestService(content, serviceName);
            modifiedContent = serviceResult.modifiedContent;
            hasChanges = serviceResult.hasChanges;

            // Then apply regular replacements
            const replacementResult = applyReplacements(modifiedContent, replacements);
            modifiedContent = replacementResult.modifiedContent;
            hasChanges = hasChanges || replacementResult.hasChanges;
          } else if (fileName === "Component-preload.js") {
            // Special handling for Component-preload.js with embedded manifest
            const result = updateComponentPreload(content, serviceName, replacements);
            modifiedContent = result.modifiedContent;
            hasChanges = result.hasChanges;
          } else {
            // For other files, just apply replacements
            const result = applyReplacements(content, replacements);
            modifiedContent = result.modifiedContent;
            hasChanges = result.hasChanges;
          }

          resolve({
            fileName: entry.fileName,
            content: modifiedContent,
            hasChanges,
            originalContent: content
          });
        } catch (error) {
          reject(error);
        }
      });
      readStream.on("error", reject);
    });
  });
}

/**
 * Modify files in the ZIP archive
 */
async function modifyZipFiles(zipFilePath, replacements, serviceName, quiet = false) {
  // Check if ZIP file exists
  if (!fs.existsSync(zipFilePath)) {
    throw new Error(`ZIP file not found: ${zipFilePath}`);
  }

  console.log(`Loading ZIP file: ${zipFilePath}`);

  if (!quiet) {
    console.log(`\nSearching for files in path: /`);
    console.log(`Replacement patterns: ${replacements.length}`);
    replacements.forEach(({ search, replace }, index) => {
      console.log(`  ${index + 1}. "${search}" -> "${replace}"`);
    });
    console.log();
  }

  return new Promise((resolve, reject) => {
    const tempZipPath = `${zipFilePath}.tmp`;
    let filesProcessed = 0;
    let filesModified = 0;

    // Open the source ZIP for reading
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipFile) => {
      if (err) {
        reject(err);
        return;
      }

      // Create a new ZIP for writing
      const newZip = new yazl.ZipFile();

      zipFile.readEntry();

      zipFile.on("entry", (entry) => {
        // Skip directories
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }

        // Process the file
        processZipEntry(entry, zipFile, replacements, serviceName, quiet)
          .then((result) => {
            filesProcessed++;

            if (result.hasChanges) {
              // Add modified content
              newZip.addBuffer(Buffer.from(result.content, "utf8"), result.fileName);
              if (!quiet) {
                console.log(`✓ Modified: ${result.fileName}`);
              }
              filesModified++;
            } else {
              // Add original content
              newZip.addBuffer(Buffer.from(result.originalContent, "utf8"), result.fileName);
              if (!quiet) {
                const fileName = path.basename(result.fileName);
                if (shouldProcessFile(fileName)) {
                  console.log(`  Skipped (no matches): ${result.fileName}`);
                } else {
                  console.log(`  Skipped (unsupported file type): ${result.fileName}`);
                }
              }
            }

            zipFile.readEntry();
          })
          .catch((error) => {
            console.error(`✗ Error processing ${entry.fileName}: ${error.message}`);
            zipFile.readEntry();
          });
      });

      zipFile.on("end", () => {
        console.log(`\nProcessed ${filesProcessed} file(s), modified ${filesModified} file(s)`);

        if (filesModified > 0) {
          console.log(`\nWriting modified ZIP file...`);

          // Finalize the new ZIP
          newZip.end();

          // Write to temporary file
          const writeStream = fs.createWriteStream(tempZipPath);
          newZip.outputStream.pipe(writeStream);

          writeStream.on("finish", () => {
            // Replace original file with the new one
            fs.renameSync(tempZipPath, zipFilePath);
            console.log(`✓ Successfully updated: ${zipFilePath}`);
            resolve();
          });

          writeStream.on("error", (error) => {
            reject(error);
          });
        } else {
          console.log("\nNo files were modified. ZIP file unchanged.");
          resolve();
        }
      });

      zipFile.on("error", (error) => {
        reject(error);
      });
    });
  });
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    const { quiet } = parseArguments();

    console.log("=".repeat(60));
    console.log("Spreadsheet Importer Component ID Modifier");
    console.log("=".repeat(60));

    // Generate configuration from ui5-deploy.yaml
    const { zipFile, replacements, appId, serviceName } = generateConfig();

    console.log(`\nConfiguration from manifest.json:`);
    console.log(`  App ID: ${appId}`);
    console.log(`  Service name: ${serviceName}`);

    console.log(`\nConfiguration from ui5-deploy.yaml:`);
    console.log(`  ZIP file: ${zipFile}`);
    console.log();

    await modifyZipFiles(zipFile, replacements, serviceName, quiet);

    console.log("\n" + "=".repeat(60));
    console.log("Done!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    process.exit(1);
  }
}

// Run the script
main();
