const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const root = path.resolve(__dirname, '..');
  const registryPath = path.join(root, 'registry', 'errorbook-registry.json');
  const indexPath = path.join(root, 'registry', 'errorbook-registry.index.json');

  const registry = readJson(registryPath);
  assert(registry.api_version === 'sce.errorbook.registry/v0.1', 'registry api_version invalid');
  assert(Array.isArray(registry.entries), 'registry.entries must be array');
  assert(typeof registry.total_entries === 'number', 'registry.total_entries must be number');

  const index = readJson(indexPath);
  assert(index.api_version === 'sce.errorbook.registry-index/v0.1', 'index api_version invalid');
  assert(index && typeof index === 'object' && !Array.isArray(index), 'index must be object');
  assert(index.buckets && typeof index.buckets === 'object', 'index.buckets required');

  for (const [bucket, target] of Object.entries(index.buckets)) {
    assert(typeof target === 'string' && target.length > 0, `bucket ${bucket} target missing`);
  }

  for (const [token, bucket] of Object.entries(index.token_to_bucket || {})) {
    assert(Object.prototype.hasOwnProperty.call(index.buckets, bucket), `token_to_bucket maps token '${token}' to unknown bucket '${bucket}'`);
  }

  console.log('registry validation passed');
}

main();
