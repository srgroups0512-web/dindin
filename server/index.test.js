import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';

const port = 18787;
const baseUrl = `http://127.0.0.1:${port}`;
let api;
let token;

test.before(async () => {
  api = spawn(process.execPath, ['index.js'], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_ACCESS_TOKEN: '',
      TECHIES_WHATSAPP_API_KEY: '',
      TECHIES_WHATSAPP_SENDER: '',
      TECHIES_WHATSAPP_CAMPAIGN_ID: '',
      TECHIES_WHATSAPP_WEBHOOK_SECRET: 'automated-techies-webhook-secret',
      ALERT_LINK_SECRET: 'automated-test-alert-link-secret',
      OTP_PROVIDER: 'test',
      OTP_HASH_SECRET: 'automated-test-only-secret',
      OTP_TEST_CODE: '384291',
      PLAY_REVIEW_PHONE: '+919999999998',
      PLAY_REVIEW_OTP: '472915',
      GOOGLE_PLAY_BILLING_MOCK: 'true',
      ALLOW_DEVELOPMENT_PREVIEW: 'true',
      BILLING_TOKEN_ENCRYPTION_KEY: 'automated-test-billing-encryption-key',
      DATABASE_URL: '',
      USE_IN_MEMORY_DB: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const ready = new Promise((resolve, reject) => {
    api.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('Din Din API listening')) resolve();
    });
    api.stderr.on('data', chunk => {
      output += chunk.toString();
    });
    api.once('exit', code => reject(new Error(`API exited before test startup (${code}): ${output}`)));
  });
  let startupTimer;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        startupTimer = setTimeout(() => reject(new Error('API startup timed out')), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(startupTimer);
  }

  const requestResponse = await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone: '9999999999'}),
  });
  assert.equal(requestResponse.status, 202);

  const removedDevelopmentCodeResponse = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Test User', phone: '9999999999', otp: '000000'}),
  });
  assert.equal(removedDevelopmentCodeResponse.status, 400);

  const response = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Test User', phone: '9999999999', otp: '384291'}),
  });
  assert.equal(response.status, 200);
  token = (await response.json()).token;
});

function authorized(extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'X-DinDin-Development-Preview': 'true',
    ...extra,
  };
}

test.after(async () => {
  if (api && api.exitCode === null) {
    api.kill();
    await once(api, 'exit');
  }
});

test('health reports the self check-in model', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.whatsapp, 'simulation');
  assert.equal(result.otp, 'configured');
  assert.equal(result.push, 'not-configured');
  assert.equal(result.billing, 'test');
  assert.equal(result.billingNotifications, 'not-configured');
  assert.equal(result.checkInModel, 'self');
  assert.equal(result.database, 'memory');
  assert.equal('locationConsent' in result, false);
});

test('Play reviewer login uses the configured fixed challenge without accepting another code', async () => {
  const requestResponse = await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone: '+919999999998'}),
  });
  assert.equal(requestResponse.status, 202);

  const wrongCodeResponse = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Google Play Reviewer', phone: '+919999999998', otp: '384291'}),
  });
  assert.equal(wrongCodeResponse.status, 400);

  const correctCodeResponse = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Google Play Reviewer', phone: '+919999999998', otp: '472915'}),
  });
  assert.equal(correctCodeResponse.status, 200);
});

test('Techies webhook requires its secret and safely ignores unrelated replies', async () => {
  const payload = {
    message_id: 'wamid.unrelated-inbound',
    targeted_message_id: 'wamid.unrelated-outbound',
    message_type: 'button',
    message_sub_type: 'button',
    message_from: '917000809184',
    direction: 'inbound',
    status: 'success',
    message_text: JSON.stringify({
      context: {id: 'wamid.unrelated-outbound'},
      button: {text: 'Schedule a Call', payload: 'Schedule a Call'},
    }),
  };
  const unauthorized = await fetch(`${baseUrl}/webhooks/techies/whatsapp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  assert.equal(unauthorized.status, 403);

  const ignored = await fetch(
    `${baseUrl}/webhooks/techies/whatsapp?token=automated-techies-webhook-secret`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    },
  );
  assert.equal(ignored.status, 200);
  assert.deepEqual(await ignored.json(), {received: true, ignored: true});
});

test('OTP requests are rate limited and a consumed code cannot be reused', async () => {
  const first = await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone: '9888888888'}),
  });
  assert.equal(first.status, 202);

  const immediateRetry = await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone: '9888888888'}),
  });
  assert.equal(immediateRetry.status, 429);

  const verified = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Another User', phone: '9888888888', otp: '384291'}),
  });
  assert.equal(verified.status, 200);

  const replay = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Another User', phone: '9888888888', otp: '384291'}),
  });
  assert.equal(replay.status, 400);
});

test('profile preferences store independent alert and safety controls', async () => {
  const profileResponse = await fetch(`${baseUrl}/v1/me`, {headers: authorized()});
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).user.name, 'Test User');

  const preferencesResponse = await fetch(`${baseUrl}/v1/me/preferences`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      notifications: false,
      sounds: true,
      vibration: false,
      safetyLocation: true,
    }),
  });
  assert.equal(preferencesResponse.status, 200);
  assert.deepEqual((await preferencesResponse.json()).preferences, {
    notifications: false,
    sounds: true,
    vibration: false,
    safetyLocation: true,
  });

  const locationResponse = await fetch(`${baseUrl}/v1/me/safety-location`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      latitude: 22.7196,
      longitude: 75.8577,
      accuracy: 12,
      capturedAt: '2026-10-24T09:30:00.000Z',
    }),
  });
  assert.equal(locationResponse.status, 200);
  assert.equal((await locationResponse.json()).location.latitude, 22.7196);
});

test('self check-in requires a primary contact and follows both reminder stages', async () => {
  const subscriptionRequiredResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reminders: [{id: 'evening', time: '18:37', weekdays: [0, 1, 2, 3, 4, 5, 6]}],
      timezone: 'Asia/Kolkata',
    }),
  });
  assert.equal(subscriptionRequiredResponse.status, 402);

  const noContactResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      reminders: [{id: 'evening', time: '18:37', weekdays: [0, 1, 2, 3, 4, 5, 6]}],
      timezone: 'Asia/Kolkata',
    }),
  });
  assert.equal(noContactResponse.status, 409);

  const contactResponse = await fetch(`${baseUrl}/v1/contacts`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      name: 'Asha', relationship: 'Family', phone: '+919111111111', primary: true,
    }),
  });
  assert.equal(contactResponse.status, 201);
  const contactPayload = await contactResponse.json();
  const contact = contactPayload.contact;
  assert.equal(contact.primary, true);
  assert.deepEqual(contactPayload.callPermissionRequest, {sent: true, mode: 'simulation'});

  const circleContactResponse = await fetch(`${baseUrl}/v1/contacts`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      name: 'Ravi', relationship: 'Friend', phone: '+919222222222', primary: false,
    }),
  });
  assert.equal(circleContactResponse.status, 201);

  const invalidPatternResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      reminders: [{id: 'invalid', time: '24:00', weekdays: [1, 2, 3, 4, 5]}],
    }),
  });
  assert.equal(invalidPatternResponse.status, 400);

  const scheduleResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      reminders: [
        {id: 'morning', time: '06:37', weekdays: [1, 3, 5]},
        {id: 'evening', time: '18:30', weekdays: [2, 4, 6]},
      ],
      timezone: 'Asia/Kolkata',
    }),
  });
  assert.equal(scheduleResponse.status, 200);
  const scheduled = (await scheduleResponse.json()).schedule;
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.stage, 0);
  assert.equal(scheduled.active, true);
  assert.deepEqual(scheduled.times, ['06:37', '18:30']);
  assert.deepEqual(scheduled.weekdays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(scheduled.reminders, [
    {id: 'morning', time: '06:37', weekdays: [1, 3, 5]},
    {id: 'evening', time: '18:30', weekdays: [2, 4, 6]},
  ]);

  const pauseResponse = await fetch(`${baseUrl}/v1/self-check-in/active`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({active: false}),
  });
  assert.equal(pauseResponse.status, 200);
  assert.equal((await pauseResponse.json()).schedule.active, false);

  const pausedSimulationResponse = await fetch(`${baseUrl}/v1/self-check-in/simulate-first`, {
    method: 'POST', headers: authorized(),
  });
  assert.equal(pausedSimulationResponse.status, 200);
  assert.equal((await pausedSimulationResponse.json()).schedule.status, 'scheduled');

  const resumeResponse = await fetch(`${baseUrl}/v1/self-check-in/active`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({active: true}),
  });
  assert.equal(resumeResponse.status, 200);
  assert.equal((await resumeResponse.json()).schedule.active, true);

  const firstResponse = await fetch(`${baseUrl}/v1/self-check-in/simulate-first`, {
    method: 'POST', headers: authorized(),
  });
  assert.equal(firstResponse.status, 200);
  const first = (await firstResponse.json()).schedule;
  assert.equal(first.status, 'waiting-first');
  assert.equal(first.stage, 1);

  const secondResponse = await fetch(`${baseUrl}/v1/self-check-in/simulate-second`, {
    method: 'POST', headers: authorized(),
  });
  assert.equal(secondResponse.status, 200);
  const second = (await secondResponse.json()).schedule;
  assert.equal(second.status, 'waiting-second');
  assert.equal(second.stage, 2);

  const staleAcknowledgeResponse = await fetch(`${baseUrl}/v1/self-check-in/acknowledge`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({scheduleId: scheduled.id, occurrence: Date.now() - 60_000}),
  });
  assert.equal(staleAcknowledgeResponse.status, 409);

  const acknowledgeResponse = await fetch(`${baseUrl}/v1/self-check-in/acknowledge`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      scheduleId: scheduled.id,
      occurrence: new Date(second.nextRunAt).getTime(),
    }),
  });
  assert.equal(acknowledgeResponse.status, 200);
  const safe = (await acknowledgeResponse.json()).schedule;
  assert.equal(safe.status, 'safe');
  assert.equal(safe.stage, 0);
  assert.ok(safe.lastResponseAt);

  const removeOnlyPrimaryResponse = await fetch(`${baseUrl}/v1/contacts/${contact.id}`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({primary: false}),
  });
  assert.equal(removeOnlyPrimaryResponse.status, 409);

  const missedResponse = await fetch(`${baseUrl}/v1/self-check-in/simulate-missed`, {
    method: 'POST', headers: authorized(),
  });
  assert.equal(missedResponse.status, 200);
  const missed = (await missedResponse.json()).schedule;
  assert.equal(missed.status, 'missed');
  assert.equal(missed.stage, 0);
  assert.ok(missed.events.some(event => event.type === 'primary-contacts-alerted'));

  const anotherFirstResponse = await fetch(`${baseUrl}/v1/self-check-in/simulate-first`, {
    method: 'POST', headers: authorized(),
  });
  assert.equal(anotherFirstResponse.status, 200);
  const anotherFirst = (await anotherFirstResponse.json()).schedule;
  const immediateAlertRequest = () => fetch(`${baseUrl}/v1/self-check-in/escalate`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      scheduleId: scheduled.id,
      occurrence: new Date(anotherFirst.nextRunAt).getTime(),
      location: {
        latitude: 22.7201,
        longitude: 75.8581,
        accuracy: 8,
        capturedAt: new Date().toISOString(),
      },
    }),
  });
  const immediateAlertResponses = await Promise.all([
    immediateAlertRequest(),
    immediateAlertRequest(),
  ]);
  const successfulImmediateAlert = immediateAlertResponses.find(item => item.status === 200);
  assert.ok(successfulImmediateAlert);
  assert.ok(immediateAlertResponses.every(item => [200, 409].includes(item.status)));
  const immediateAlert = (await successfulImmediateAlert.json()).schedule;
  const circleAlerts = immediateAlert.events.filter(event => event.type === 'circle-alerted-by-user');
  assert.equal(circleAlerts.length, 1);
  const circleAlert = circleAlerts[0];
  assert.equal(circleAlert.recipients, 2);
  assert.equal(circleAlert.locationSent, true);

  const staleLocationResponse = await fetch(`${baseUrl}/v1/me/safety-location`, {
    method: 'PUT',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      latitude: 22.7001,
      longitude: 75.8001,
      accuracy: 20,
      capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }),
  });
  assert.equal(staleLocationResponse.status, 200);
  await fetch(`${baseUrl}/v1/self-check-in/simulate-first`, {
    method: 'POST', headers: authorized(),
  });
  const staleMissedResponse = await fetch(`${baseUrl}/v1/self-check-in/simulate-missed`, {
    method: 'POST', headers: authorized(),
  });
  assert.equal(staleMissedResponse.status, 200);
  const staleMissed = (await staleMissedResponse.json()).schedule;
  const staleEvent = [...staleMissed.events]
    .reverse()
    .find(event => event.type === 'primary-contacts-alerted');
  assert.equal(staleEvent.locationSent, false);
  assert.equal(staleEvent.locationFresh, false);

  const deleteScheduleResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    method: 'DELETE', headers: authorized(),
  });
  assert.equal(deleteScheduleResponse.status, 200);
  assert.equal((await deleteScheduleResponse.json()).deleted, true);

  const deletedScheduleResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    headers: authorized(),
  });
  assert.equal(deletedScheduleResponse.status, 200);
  assert.equal((await deletedScheduleResponse.json()).schedule, null);

  const deleteAgainResponse = await fetch(`${baseUrl}/v1/self-check-in`, {
    method: 'DELETE', headers: authorized(),
  });
  assert.equal(deleteAgainResponse.status, 404);
});

test('push registrations can be added and removed for the signed-in device', async () => {
  const pushToken = 'test-firebase-device-token-1234567890';
  const registerResponse = await fetch(`${baseUrl}/v1/push-tokens`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({token: pushToken, platform: 'android'}),
  });
  assert.equal(registerResponse.status, 200);
  assert.equal((await registerResponse.json()).registered, true);

  const deleteResponse = await fetch(`${baseUrl}/v1/push-tokens`, {
    method: 'DELETE',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({token: pushToken}),
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).deleted, true);
});

test('Google Play purchases are verified and lifetime entitlement takes priority', async () => {
  const initialResponse = await fetch(`${baseUrl}/v1/billing/entitlement`, {
    headers: authorized(),
  });
  assert.equal(initialResponse.status, 200);
  assert.equal((await initialResponse.json()).entitlement.active, false);

  const invalidResponse = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      platform: 'android',
      purchase: {productId: 'dindin_premium', purchaseToken: 'invalid-test-token'},
    }),
  });
  assert.equal(invalidResponse.status, 200);
  assert.equal((await invalidResponse.json()).valid, false);

  const monthlyResponse = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      platform: 'android',
      purchase: {productId: 'dindin_premium', purchaseToken: 'test-monthly-token'},
    }),
  });
  assert.equal(monthlyResponse.status, 200);
  const monthly = await monthlyResponse.json();
  assert.equal(monthly.valid, true);
  assert.equal(monthly.entitlement.kind, 'subscription');
  assert.equal(monthly.entitlement.basePlanId, 'monthly');
  assert.equal(monthly.entitlement.willRenew, true);

  const otherPhone = '9666666666';
  await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone: otherPhone}),
  });
  const otherLogin = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Other Buyer', phone: otherPhone, otp: '384291'}),
  });
  const otherToken = (await otherLogin.json()).token;
  const replayResponse = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${otherToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      platform: 'android',
      purchase: {productId: 'dindin_premium', purchaseToken: 'test-monthly-token'},
    }),
  });
  assert.equal(replayResponse.status, 409);

  const lifetimeResponse = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: authorized({'Content-Type': 'application/json'}),
    body: JSON.stringify({
      platform: 'android',
      purchase: {productId: 'dindin_lifetime', purchaseToken: 'test-lifetime-token'},
    }),
  });
  assert.equal(lifetimeResponse.status, 200);
  const lifetime = await lifetimeResponse.json();
  assert.equal(lifetime.valid, true);
  assert.deepEqual(lifetime.entitlement, {
    active: true,
    kind: 'lifetime',
    productId: 'dindin_lifetime',
    basePlanId: null,
    status: 'active',
    expiresAt: null,
    willRenew: false,
    accessSource: 'direct',
    familyRole: null,
    familyCapacity: null,
  });
});

test('family plans enforce purchased capacity, inherit access, and support upgrades', async () => {
  async function register(phone, name) {
    await fetch(`${baseUrl}/v1/auth/request-otp`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({phone}),
    });
    const response = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, phone, otp: '384291'}),
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  }

  const ownerToken = await register('9555555555', 'Family Owner');
  const ownerHeaders = {
    Authorization: `Bearer ${ownerToken}`,
    'Content-Type': 'application/json',
  };
  const purchase = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      platform: 'android',
      purchase: {productId: 'dindin_family', purchaseToken: 'test-family-yearly-3-token'},
    }),
  });
  assert.equal(purchase.status, 200);
  const purchased = await purchase.json();
  assert.equal(purchased.entitlement.productId, 'dindin_family');
  assert.equal(purchased.entitlement.basePlanId, 'family-yearly-3');
  assert.equal(purchased.entitlement.familyRole, 'owner');
  assert.equal(purchased.entitlement.familyCapacity, 3);

  for (const memberPhone of ['9444444441', '9444444442']) {
    const response = await fetch(`${baseUrl}/v1/family/members`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({phone: memberPhone}),
    });
    assert.equal(response.status, 201);
  }
  const familyResponse = await fetch(`${baseUrl}/v1/family`, {
    headers: {Authorization: `Bearer ${ownerToken}`},
  });
  const family = (await familyResponse.json()).family;
  assert.equal(family.role, 'owner');
  assert.equal(family.active, true);
  assert.equal(family.capacity, 3);
  assert.equal(family.members.length, 2);

  const overCapacity = await fetch(`${baseUrl}/v1/family/members`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({phone: '9444444443'}),
  });
  assert.equal(overCapacity.status, 409);

  const upgrade = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      platform: 'android',
      purchase: {productId: 'dindin_family', purchaseToken: 'test-family-yearly-5-token'},
    }),
  });
  assert.equal(upgrade.status, 200);
  const upgraded = await upgrade.json();
  assert.equal(upgraded.entitlement.basePlanId, 'family-yearly-5');
  assert.equal(upgraded.entitlement.familyCapacity, 5);

  for (const memberPhone of ['9444444443', '9444444444']) {
    const response = await fetch(`${baseUrl}/v1/family/members`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({phone: memberPhone}),
    });
    assert.equal(response.status, 201);
  }
  const upgradedFamilyResponse = await fetch(`${baseUrl}/v1/family`, {
    headers: {Authorization: `Bearer ${ownerToken}`},
  });
  const upgradedFamily = (await upgradedFamilyResponse.json()).family;
  assert.equal(upgradedFamily.capacity, 5);
  assert.equal(upgradedFamily.members.length, 4);

  const memberToken = await register('9444444441', 'Family Member');
  const memberEntitlementResponse = await fetch(`${baseUrl}/v1/billing/entitlement`, {
    headers: {Authorization: `Bearer ${memberToken}`},
  });
  const memberEntitlement = (await memberEntitlementResponse.json()).entitlement;
  assert.equal(memberEntitlement.active, true);
  assert.equal(memberEntitlement.productId, 'dindin_family');
  assert.equal(memberEntitlement.accessSource, 'family-member');
  assert.equal(memberEntitlement.familyRole, 'member');
  assert.equal(memberEntitlement.familyCapacity, 5);

  const memberAddAttempt = await fetch(`${baseUrl}/v1/family/members`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${memberToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({phone: '9333333333'}),
  });
  assert.equal(memberAddAttempt.status, 402);
});

test('family lifetime purchase grants the selected permanent capacity', async () => {
  const phone = '9566666666';
  await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone}),
  });
  const registration = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Lifetime Family', phone, otp: '384291'}),
  });
  const registrationToken = (await registration.json()).token;
  const response = await fetch(`${baseUrl}/v1/billing/verify`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${registrationToken}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      platform: 'android',
      purchase: {
        productId: 'dindin_family_lifetime_6',
        purchaseToken: 'test-family-lifetime-6-token',
      },
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.entitlement.kind, 'lifetime');
  assert.equal(result.entitlement.productId, 'dindin_family_lifetime_6');
  assert.equal(result.entitlement.familyRole, 'owner');
  assert.equal(result.entitlement.familyCapacity, 6);
});

test('account deletion removes the account and revokes its session', async () => {
  const phone = '9777777777';
  const requestResponse = await fetch(`${baseUrl}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone}),
  });
  assert.equal(requestResponse.status, 202);

  const verifyResponse = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'Delete Test', phone, otp: '384291'}),
  });
  assert.equal(verifyResponse.status, 200);
  const deleteToken = (await verifyResponse.json()).token;

  const deleteResponse = await fetch(`${baseUrl}/v1/me`, {
    method: 'DELETE',
    headers: {Authorization: `Bearer ${deleteToken}`},
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).deleted, true);

  const profileResponse = await fetch(`${baseUrl}/v1/me`, {
    headers: {Authorization: `Bearer ${deleteToken}`},
  });
  assert.equal(profileResponse.status, 401);
});

test('logout revokes the current session', async () => {
  const logoutResponse = await fetch(`${baseUrl}/v1/auth/logout`, {
    method: 'POST',
    headers: authorized(),
  });
  assert.equal(logoutResponse.status, 200);
  assert.equal((await logoutResponse.json()).loggedOut, true);

  const profileResponse = await fetch(`${baseUrl}/v1/me`, {headers: authorized()});
  assert.equal(profileResponse.status, 401);
});
