const fs = require('fs');
const path = require('path');

const REGISTRY_API_VERSION = 'sce.errorbook.registry/v0.1';
const INDEX_API_VERSION = 'sce.errorbook.registry-index/v0.1';
const MIN_TOKEN_LENGTH = 2;

const SEED_TOKEN_TO_BUCKET = Object.freeze({
  order: 'order',
  approve: 'order',
  payment: 'payment',
  auth: 'auth'
});

const DOMAIN_BUCKET_HINTS = Object.freeze({
  order: ['order', 'approve', 'fulfillment', 'shipment', 'inventory'],
  payment: ['payment', 'billing', 'invoice', 'refund', 'settlement'],
  auth: ['auth', 'login', 'token', 'permission', 'access']
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= MIN_TOKEN_LENGTH);
}

function collectEntryTokens(entry) {
  const chunks = [];
  chunks.push(entry.title, entry.symptom, entry.root_cause, entry.notes);
  for (const field of ['tags', 'ontology_tags', 'fix_actions', 'verification_evidence']) {
    if (Array.isArray(entry[field])) {
      chunks.push(...entry[field]);
    }
  }
  const tokens = new Set();
  for (const chunk of chunks) {
    for (const token of tokenize(chunk)) {
      tokens.add(token);
    }
  }
  return Array.from(tokens.values());
}

function guessBucketForToken(token) {
  for (const [bucket, keywords] of Object.entries(DOMAIN_BUCKET_HINTS)) {
    if (keywords.includes(token)) {
      return bucket;
    }
  }
  const first = token.charAt(0);
  if (/^[a-z0-9]$/.test(first)) {
    return first;
  }
  return 'misc';
}

function resolveRawBase(rootDir) {
  const envBase = normalizeText(process.env.ERRORBOOK_REGISTRY_RAW_BASE);
  if (envBase) {
    return envBase.replace(/\/+$/, '');
  }
  const repo = normalizeText(process.env.GITHUB_REPOSITORY);
  if (repo) {
    const branch = normalizeText(process.env.ERRORBOOK_REGISTRY_BRANCH) || 'main';
    return `https://raw.githubusercontent.com/${repo}/${branch}`;
  }
  try {
    const gitConfigPath = path.join(rootDir, '.git', 'config');
    if (fs.existsSync(gitConfigPath)) {
      const raw = fs.readFileSync(gitConfigPath, 'utf8');
      const match = raw.match(/url\s*=\s*(.+)/);
      if (match) {
        const url = normalizeText(match[1]);
        const ghHttps = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
        if (ghHttps) {
          return `https://raw.githubusercontent.com/${ghHttps[1]}/${ghHttps[2]}/main`;
        }
        const ghSsh = url.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
        if (ghSsh) {
          return `https://raw.githubusercontent.com/${ghSsh[1]}/${ghSsh[2]}/main`;
        }
      }
    }
  } catch {
    // noop, fallback below
  }
  return 'https://raw.githubusercontent.com/heguangyong/sce-errorbook-registry/main';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseArgs(argv) {
  return {
    write: argv.includes('--write'),
    check: argv.includes('--check')
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const registryPath = path.join(root, 'registry', 'errorbook-registry.json');
  const indexPath = path.join(root, 'registry', 'errorbook-registry.index.json');
  const shardsDir = path.join(root, 'registry', 'shards');
  const generatedAt = new Date().toISOString();
  const rawBase = resolveRawBase(root);

  const registry = readJson(registryPath);
  const entries = Array.isArray(registry.entries) ? registry.entries : [];

  const tokenToBucket = { ...SEED_TOKEN_TO_BUCKET };
  const bucketToEntries = new Map();

  for (const seedBucket of new Set(Object.values(SEED_TOKEN_TO_BUCKET))) {
    bucketToEntries.set(seedBucket, []);
  }

  for (const entry of entries) {
    const entryTokens = collectEntryTokens(entry);
    const entryBuckets = new Set();
    for (const token of entryTokens) {
      const bucket = guessBucketForToken(token);
      tokenToBucket[token] = bucket;
      entryBuckets.add(bucket);
    }
    for (const bucket of entryBuckets) {
      if (!bucketToEntries.has(bucket)) {
        bucketToEntries.set(bucket, []);
      }
      bucketToEntries.get(bucket).push(entry);
    }
  }

  const buckets = {};
  for (const bucket of bucketToEntries.keys()) {
    buckets[bucket] = `${rawBase}/registry/shards/${bucket}.json`;
  }

  const nextRegistry = {
    ...registry,
    api_version: REGISTRY_API_VERSION,
    generated_at: generatedAt,
    total_entries: entries.length,
    entries
  };

  const nextIndex = {
    api_version: INDEX_API_VERSION,
    generated_at: generatedAt,
    min_token_length: MIN_TOKEN_LENGTH,
    token_to_bucket: tokenToBucket,
    buckets
  };

  if (args.check) {
    console.log(JSON.stringify({
      mode: 'rebuild-index',
      write: false,
      total_entries: entries.length,
      bucket_count: Object.keys(buckets).length,
      token_count: Object.keys(tokenToBucket).length
    }, null, 2));
    return;
  }

  if (!args.write) {
    throw new Error('missing --write (or use --check)');
  }

  ensureDir(shardsDir);
  const activeShardFiles = new Set();
  for (const [bucket, shardEntries] of bucketToEntries.entries()) {
    const shardPayload = {
      api_version: REGISTRY_API_VERSION,
      generated_at: generatedAt,
      bucket,
      source: {
        total_entries: shardEntries.length
      },
      entries: shardEntries
    };
    const shardName = `${bucket}.json`;
    activeShardFiles.add(shardName);
    writeJson(path.join(shardsDir, shardName), shardPayload);
  }

  if (fs.existsSync(shardsDir)) {
    for (const fileName of fs.readdirSync(shardsDir)) {
      if (!fileName.endsWith('.json')) {
        continue;
      }
      if (!activeShardFiles.has(fileName)) {
        fs.unlinkSync(path.join(shardsDir, fileName));
      }
    }
  }

  writeJson(registryPath, nextRegistry);
  writeJson(indexPath, nextIndex);

  console.log(JSON.stringify({
    mode: 'rebuild-index',
    write: true,
    total_entries: entries.length,
    bucket_count: Object.keys(buckets).length,
    token_count: Object.keys(tokenToBucket).length
  }, null, 2));
}

main();
