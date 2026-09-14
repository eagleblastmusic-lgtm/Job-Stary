import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('Render external URL becomes app origin when APP_ORIGIN is not set', () => {
  const previousAppOrigin = process.env.APP_ORIGIN;
  const previousRenderUrl = process.env.RENDER_EXTERNAL_URL;
  try {
    delete process.env.APP_ORIGIN;
    process.env.RENDER_EXTERNAL_URL = 'https://job-mvp-staging.onrender.com';
    const config = loadConfig({ nodeEnv: 'test', port: 3000 });
    assert.equal(config.appOrigin, 'https://job-mvp-staging.onrender.com');
  } finally {
    restoreEnv('APP_ORIGIN', previousAppOrigin);
    restoreEnv('RENDER_EXTERNAL_URL', previousRenderUrl);
  }
});

test('explicit APP_ORIGIN takes precedence over platform URL', () => {
  const previousAppOrigin = process.env.APP_ORIGIN;
  const previousRenderUrl = process.env.RENDER_EXTERNAL_URL;
  try {
    process.env.APP_ORIGIN = 'https://jobs.example.pl';
    process.env.RENDER_EXTERNAL_URL = 'https://job-mvp-staging.onrender.com';
    const config = loadConfig({ nodeEnv: 'test', port: 3000 });
    assert.equal(config.appOrigin, 'https://jobs.example.pl');
  } finally {
    restoreEnv('APP_ORIGIN', previousAppOrigin);
    restoreEnv('RENDER_EXTERNAL_URL', previousRenderUrl);
  }
});

test('explicit nodeEnv override takes precedence over process environment', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    assert.equal(loadConfig({ nodeEnv: 'production', port: 3000 }).nodeEnv, 'production');
    process.env.NODE_ENV = 'production';
    assert.equal(loadConfig({ nodeEnv: 'test', port: 3000 }).nodeEnv, 'test');
  } finally {
    restoreEnv('NODE_ENV', previous);
  }
});

test('TRUST_PROXY is disabled by default and accepts explicit boolean values', () => {
  const previous = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(loadConfig({ nodeEnv: 'test', port: 3000 }).trustProxy, false);

    process.env.TRUST_PROXY = 'true';
    assert.equal(loadConfig({ nodeEnv: 'test', port: 3000 }).trustProxy, true);

    process.env.TRUST_PROXY = '0';
    assert.equal(loadConfig({ nodeEnv: 'test', port: 3000 }).trustProxy, false);

    process.env.TRUST_PROXY = 'definitely';
    assert.throws(() => loadConfig({ nodeEnv: 'test', port: 3000 }), /TRUST_PROXY/);
  } finally {
    restoreEnv('TRUST_PROXY', previous);
  }
});

test('explicit trustProxy override takes precedence over environment', () => {
  const previous = process.env.TRUST_PROXY;
  try {
    process.env.TRUST_PROXY = 'true';
    assert.equal(loadConfig({ nodeEnv: 'test', port: 3000, trustProxy: false }).trustProxy, false);
  } finally {
    restoreEnv('TRUST_PROXY', previous);
  }
});

test('public runtime ignores ADMIN_EMAILS and adminEmails overrides', () => {
  const previous = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = 'admin@example.pl';
    assert.deepEqual([...loadConfig({ nodeEnv: 'test', port: 3000 }).adminEmails], []);
    assert.deepEqual([...loadConfig({ nodeEnv: 'test', port: 3000, adminEmails: new Set(['override@example.pl']) }).adminEmails], []);
  } finally {
    restoreEnv('ADMIN_EMAILS', previous);
  }
});

test('malware scan environment is validated during application configuration', () => {
  const previousRequired = process.env.REQUIRE_MALWARE_SCAN;
  const previousTimeout = process.env.MALWARE_SCAN_TIMEOUT_MS;
  const previousBin = process.env.MALWARE_SCANNER_BIN;
  try {
    process.env.REQUIRE_MALWARE_SCAN = 'definitely';
    assert.throws(() => loadConfig({ nodeEnv: 'test', port: 3000 }), /REQUIRE_MALWARE_SCAN/);

    process.env.REQUIRE_MALWARE_SCAN = 'true';
    process.env.MALWARE_SCAN_TIMEOUT_MS = '0';
    assert.throws(() => loadConfig({ nodeEnv: 'test', port: 3000 }), /MALWARE_SCAN_TIMEOUT_MS/);

    process.env.MALWARE_SCAN_TIMEOUT_MS = '15000';
    delete process.env.MALWARE_SCANNER_BIN;
    assert.doesNotThrow(() => loadConfig({ nodeEnv: 'test', port: 3000 }), 'required mode may start without a scanner but uploads must fail closed');
  } finally {
    restoreEnv('REQUIRE_MALWARE_SCAN', previousRequired);
    restoreEnv('MALWARE_SCAN_TIMEOUT_MS', previousTimeout);
    restoreEnv('MALWARE_SCANNER_BIN', previousBin);
  }
});
