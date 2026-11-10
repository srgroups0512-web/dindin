import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSafetyAlertToken,
  renderExpiredSafetyAlertPage,
  renderSafetyAlertPage,
  verifySafetyAlertToken,
} from './safetyAlerts.js';

test('safety alert tokens reject tampering', () => {
  process.env.ALERT_LINK_SECRET = 'test-only-alert-link-secret';
  const id = '9e986f0c-f88c-42db-8771-263dfbf4f118';
  const token = createSafetyAlertToken(id);
  assert.equal(verifySafetyAlertToken(token), id);
  assert.equal(verifySafetyAlertToken(`${token}x`), null);
});

test('safety alert page escapes contact data and requires a POST acknowledgement', () => {
  const html = renderSafetyAlertPage({
    userName: '<Test User>',
    location: {
      latitude: 22.7196,
      longitude: 75.8577,
      accuracy: 12,
      capturedAt: '2026-10-30T05:30:00.000Z',
    },
  }, {token: 'test.token'});
  assert.match(html, /&lt;Test User&gt;/);
  assert.doesNotMatch(html, /<Test User>/);
  assert.match(html, /method="post"/);
  assert.match(html, /google\.com\/maps\/search/);
  assert.match(html, /dindin-penguin\.png/);
  assert.match(html, /alt="Din Din logo"/);
});

test('expired safety alert page keeps Din Din branding', () => {
  const html = renderExpiredSafetyAlertPage();
  assert.match(html, /dindin-penguin\.png/);
  assert.match(html, /alt="Din Din logo"/);
});
