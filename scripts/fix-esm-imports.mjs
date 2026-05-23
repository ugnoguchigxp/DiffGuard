import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const targetRoot = process.argv[2] ?? "dist";
const jsExtensionPattern = /\.[cm]?js$/;

const normalizeSpecifier = (filePath, specifier) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }

  if (/\.(?:cjs|js|json|mjs|node)$/.test(specifier)) {
    return specifier;
  }

  const resolved = path.resolve(path.dirname(filePath), specifier);
  if (existsSync(`${resolved}.js`)) {
    return `${specifier}.js`;
  }

  if (existsSync(path.join(resolved, "index.js"))) {
    return `${specifier}/index.js`;
  }

  return `${specifier}.js`;
};

const rewriteSource = (filePath, source) => {
  return source
    .replaceAll(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${normalizeSpecifier(filePath, specifier)}${suffix}`;
    })
    .replaceAll(
      /(import\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
      (_match, prefix, specifier, suffix) => {
        return `${prefix}${normalizeSpecifier(filePath, specifier)}${suffix}`;
      },
    )
    .replaceAll(/(import\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${normalizeSpecifier(filePath, specifier)}${suffix}`;
    });
};

const rewriteFile = async (filePath) => {
  const source = await readFile(filePath, "utf8");
  const rewritten = rewriteSource(filePath, source);
  if (rewritten !== source) {
    await writeFile(filePath, rewritten);
  }
};

const walk = async (directory) => {
  const entries = await readdir(directory);
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry);
      const entryStat = await stat(entryPath);
      if (entryStat.isDirectory()) {
        await walk(entryPath);
        return;
      }

      if (jsExtensionPattern.test(entryPath)) {
        await rewriteFile(entryPath);
      }
    }),
  );
};

await walk(targetRoot);
