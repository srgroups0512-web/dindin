import assert from 'node:assert/strict';
import test from 'node:test';
import {reminderRuntimeAccess} from './reminderAccess.js';

test('an authorized development-preview schedule keeps running in production', () => {
  assert.equal(reminderRuntimeAccess({
    nodeEnv: 'production',
    allowDevelopmentPreview: true,
    scheduleDevelopmentPreview: true,
    entitlementActive: false,
  }), true);
});

test('production still pauses unpaid schedules that were not created through preview', () => {
  assert.equal(reminderRuntimeAccess({
    nodeEnv: 'production',
    allowDevelopmentPreview: true,
    scheduleDevelopmentPreview: false,
    entitlementActive: false,
  }), false);
  assert.equal(reminderRuntimeAccess({
    nodeEnv: 'production',
    allowDevelopmentPreview: false,
    scheduleDevelopmentPreview: true,
    entitlementActive: false,
  }), false);
});
