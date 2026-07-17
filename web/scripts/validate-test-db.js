#!/usr/bin/env node
// Validate TEST_DATABASE_URL for E2E tests
// Purpose: Ensure test database is properly configured before running tests
// Safety: Refuses production databases, validates URL format, masks passwords

const url = process.env.TEST_DATABASE_URL;
const verbose = process.argv.includes('--verbose');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function success(message) {
  if (verbose) console.log(`✓ ${message}`);
}

// Check if TEST_DATABASE_URL is set
if (!url) {
  fail('TEST_DATABASE_URL is not set. Set it before running E2E tests: $env:TEST_DATABASE_URL = "postgresql://..."');
}

// Parse URL
let parsed;
try {
  parsed = new URL(url);
} catch (e) {
  fail(`TEST_DATABASE_URL is not a valid PostgreSQL URL: ${e.message}`);
}

// Validate protocol
if (parsed.protocol !== 'postgresql:') {
  fail(`TEST_DATABASE_URL must use postgresql:// protocol (got ${parsed.protocol})`);
}

// Extract database name
const dbName = parsed.pathname.replace(/^\//, '').split('?')[0];
if (!dbName) {
  fail('TEST_DATABASE_URL must include a database name (e.g., postgresql://user:pass@host/dbname)');
}

// Validate database name is a test database
if (!dbName.includes('test')) {
  fail(`Database name '${dbName}' does not contain 'test'. Test databases must be clearly marked. Refusing to continue.`);
}

// Refuse production-like names
if (dbName.match(/(prod|production|live)/i)) {
  fail(`Database name '${dbName}' appears to be production. Refusing to continue.`);
}

// Refuse if it matches development database
if (dbName === 'ai_hair_architect') {
  fail(`Database name is 'ai_hair_architect' (development database). Use 'ai_hair_architect_test' for E2E tests.`);
}

// Warn if TEST_DATABASE_URL equals DATABASE_URL
const devUrl = process.env.DATABASE_URL;
if (devUrl && url === devUrl) {
  fail('TEST_DATABASE_URL is identical to DATABASE_URL. Use a separate test database.');
}

// Validate host and port
const host = parsed.hostname || 'localhost';
const port = parsed.port || 5432;

if (host.match(/(prod|production|live)/i)) {
  fail(`Database host '${host}' appears to be production. Refusing to continue.`);
}

// All checks passed
if (verbose) {
  console.log('\n✓ TEST_DATABASE_URL validation passed:');
  console.log(`  Host:     ${host}`);
  console.log(`  Port:     ${port}`);
  console.log(`  Database: ${dbName}`);
  console.log(`  Username: ${parsed.username ? '***' : '(empty)'}`);
  console.log('');
}

success(`TEST_DATABASE_URL is valid`);
