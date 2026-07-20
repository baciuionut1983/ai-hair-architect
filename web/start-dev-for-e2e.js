#!/usr/bin/env node

const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Load environment variables into process.env
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.development'), override: true });

// Ensure NODE_ENV is development
process.env.NODE_ENV = 'development';

// Keep server DB aligned with test runner DB when available.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Fail-open avoidance: webhook crypto features require a master key.
if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
}

// Allow an explicit port from CLI args (used by Playwright webServer config)
const requestedPort = process.argv[2];
if (requestedPort) {
  process.env.PORT = requestedPort;
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Run npm run dev with inherited environment
const child = spawn(npmCommand, ['run', 'dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to start dev server:', err);
  process.exit(1);
});
