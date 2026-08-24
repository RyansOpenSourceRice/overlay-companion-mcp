import { test } from 'node:test';
import assert from 'node:assert';
import { bareHostname } from '../src/origin';

test('bareHostname strips a port', () => {
  assert.strictEqual(bareHostname('localhost:8080'), 'localhost');
  assert.strictEqual(bareHostname('example.com:443'), 'example.com');
});

test('bareHostname leaves a bare hostname alone', () => {
  assert.strictEqual(bareHostname('localhost'), 'localhost');
  assert.strictEqual(bareHostname('overlay.example.com'), 'overlay.example.com');
});

test('bareHostname strips a scheme prefix', () => {
  assert.strictEqual(bareHostname('https://example.com:8080'), 'example.com');
});

test('bareHostname normalizes a trailing FQDN dot', () => {
  assert.strictEqual(bareHostname('example.com.'), 'example.com');
  assert.strictEqual(bareHostname('example.com.:8080'), 'example.com');
});

test('bareHostname handles bracketed IPv6 with and without a port', () => {
  assert.strictEqual(bareHostname('[::1]:8080'), '::1');
  assert.strictEqual(bareHostname('[::1]'), '::1');
});

test('bareHostname handles empty/undefined input', () => {
  assert.strictEqual(bareHostname(''), '');
  assert.strictEqual(bareHostname('  '), '');
});