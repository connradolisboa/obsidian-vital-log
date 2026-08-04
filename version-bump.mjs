// Referenced by `npm version`: keeps manifest.json and versions.json in step
// with package.json, then stages them for the version commit.
import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error('version-bump: npm_package_version is not set — run this via `npm version`.');
  process.exit(1);
}

// manifest.json carries the version Obsidian installs.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// versions.json maps each plugin version to the minimum Obsidian it supports,
// so older clients can still resolve a compatible release.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

console.log(`version-bump: manifest.json and versions.json set to ${targetVersion}`);
