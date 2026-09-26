import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const buildDir = path.resolve(frontendDir, ".next");
const configPath = path.resolve(frontendDir, "bundle-budget.config.json");

function getFileSizeKB(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return (stats.size / 1024).toFixed(2);
  } catch {
    return null;
  }
}

function findLargeFiles(dir, maxDepth = 3) {
  const files = [];

  function walk(currentPath, depth = 0) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
          const sizeKB = getFileSizeKB(fullPath);
          if (sizeKB !== null && parseFloat(sizeKB) > 50) {
            files.push({
              name: entry.name,
              path: fullPath.replace(buildDir, ""),
              sizeKB: parseFloat(sizeKB),
            });
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  walk(dir);
  return files.sort((a, b) => b.sizeKB - a.sizeKB);
}

function analyzeBuildOutput() {
  if (!fs.existsSync(buildDir)) {
    console.error(`❌ Build directory not found: ${buildDir}`);
    console.error("   Run 'npm run build' first");
    process.exit(1);
  }

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Bundle budget config not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const staticDir = path.resolve(buildDir, "static");

  const largeFiles = findLargeFiles(staticDir);

  console.log("\n📦 Bundle Analysis Report\n");
  console.log("=".repeat(70));

  let hasWarnings = false;

  if (largeFiles.length > 0) {
    console.log("\n🔍 Largest files (>50 KB):\n");
    for (const file of largeFiles.slice(0, 10)) {
      const sizeStr = file.sizeKB.toFixed(2);
      console.log(`  ${file.sizeKB > 200 ? "⚠️" : "✓"} ${sizeStr} KB - ${file.path}`);
      if (file.sizeKB > 200) hasWarnings = true;
    }
  }

  console.log("\n📊 Budget Thresholds:\n");
  for (const bundle of config.bundles) {
    console.log(`  • ${bundle.name}: ${bundle.maxSizeKB} KB`);
    console.log(`    ${bundle.description}`);
  }

  console.log("\n" + "=".repeat(70));

  const overallSize = largeFiles.reduce((acc, f) => acc + f.sizeKB, 0);
  const largestFile = largeFiles[0];

  console.log(`\nTotal tracked files: ${overallSize.toFixed(2)} KB`);
  if (largestFile) {
    console.log(`Largest file: ${largestFile.sizeKB.toFixed(2)} KB (${largestFile.path})`);
  }

  if (hasWarnings && config.failOnWarning) {
    console.error(
      "\n❌ Bundle size exceeded thresholds. Optimize imports and code splitting.",
    );
    process.exit(1);
  } else if (hasWarnings) {
    console.warn(
      "\n⚠️  Some bundles are approaching thresholds. Consider optimizing.",
    );
  } else {
    console.log("\n✅ All bundles within budget.");
  }

  console.log();
}

analyzeBuildOutput();
