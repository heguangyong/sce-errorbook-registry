const fs = require('fs');
const path = require('path');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseArgs(argv = []) {
  const output = {
    minCoverage: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--min-coverage') {
      output.minCoverage = Number(argv[index + 1]);
      index += 1;
    }
  }
  return output;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toTokenSet(entry = {}, minTokenLength = 2) {
  const tokens = new Set();
  const rawTexts = [
    entry.title,
    entry.symptom,
    entry.root_cause,
    entry.notes
  ];
  for (const field of ['tags', 'ontology_tags', 'fix_actions', 'verification_evidence']) {
    if (Array.isArray(entry[field])) {
      rawTexts.push(...entry[field]);
    }
  }

  for (const raw of rawTexts) {
    const normalized = normalizeText(raw).toLowerCase();
    if (!normalized) {
      continue;
    }
    for (const part of normalized.split(/[^a-z0-9_]+/i)) {
      const token = normalizeText(part);
      if (token.length >= minTokenLength) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const registryPath = path.join(root, 'registry', 'errorbook-registry.json');
  const indexPath = path.join(root, 'registry', 'errorbook-registry.index.json');
  const args = parseArgs(process.argv.slice(2));

  const registry = readJson(registryPath);
  const index = readJson(indexPath);
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const minTokenLength = Number.isFinite(Number(index.min_token_length))
    ? Number(index.min_token_length)
    : 2;
  const tokenToBucket = index.token_to_bucket && typeof index.token_to_bucket === 'object'
    ? index.token_to_bucket
    : {};
  const buckets = index.buckets && typeof index.buckets === 'object'
    ? index.buckets
    : {};
  const minCoverage = Number.isFinite(Number(args.minCoverage))
    ? Number(args.minCoverage)
    : (Number.isFinite(Number(process.env.ERRORBOOK_INDEX_MIN_COVERAGE))
      ? Number(process.env.ERRORBOOK_INDEX_MIN_COVERAGE)
      : 85);

  let coveredCount = 0;
  let uncoveredCount = 0;
  const uncoveredEntries = [];

  for (const entry of entries) {
    const tokens = toTokenSet(entry, minTokenLength);
    const entryId = normalizeText(entry.id) || normalizeText(entry.fingerprint) || '(unknown)';
    if (tokens.size === 0) {
      uncoveredCount += 1;
      uncoveredEntries.push({
        id: entryId,
        reason: 'no-indexable-tokens'
      });
      continue;
    }

    let covered = false;
    for (const token of tokens) {
      const bucket = normalizeText(tokenToBucket[token]);
      if (!bucket) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(buckets, bucket)) {
        covered = true;
        break;
      }
    }

    if (covered) {
      coveredCount += 1;
    } else {
      uncoveredCount += 1;
      uncoveredEntries.push({
        id: entryId,
        reason: 'token-not-mapped-to-existing-bucket'
      });
    }
  }

  const total = entries.length;
  const coveragePercent = total === 0
    ? 100
    : Number(((coveredCount / total) * 100).toFixed(2));
  const passed = coveragePercent >= minCoverage;

  const payload = {
    mode: 'index-coverage-gate',
    threshold_percent: minCoverage,
    total_entries: total,
    covered_entries: coveredCount,
    uncovered_entries: uncoveredCount,
    coverage_percent: coveragePercent,
    passed,
    uncovered_sample: uncoveredEntries.slice(0, 20)
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (!passed) {
    process.exit(2);
  }
}

main();
