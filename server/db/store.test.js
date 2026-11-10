import assert from 'node:assert/strict';
import test from 'node:test';
import {DataStore} from './store.js';

test('an acknowledgement can resolve any recorded outbound safety message', async () => {
  process.env.USE_IN_MEMORY_DB = 'true';
  const store = new DataStore();
  const user = await store.createUserSession({
    phone: '+919000000000',
    name: 'Test User',
    tokenHash: 'test-session',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
  const contact = await store.createContact(user.id, {
    name: 'Primary Contact',
    relationship: 'Family',
    phone: '+917000809184',
    primary: true,
  });
  const schedule = await store.upsertSelfSchedule({
    userId: user.id,
    reminders: [{id: 'evening', time: '18:00', weekdays: [0, 1, 2, 3, 4, 5, 6]}],
    timezone: 'Asia/Kolkata',
    nextRunAt: '2099-01-01T12:30:00.000Z',
    developmentPreview: true,
  });
  const created = await store.createSafetyAlert({
    schedule,
    user,
    source: 'missed',
    location: null,
    recipients: [contact],
    expiresAt: '2099-01-02T00:00:00.000Z',
  });
  assert.equal(created.created, true);
  const duplicate = await store.createSafetyAlert({
    schedule,
    user,
    source: 'user-not-okay',
    location: null,
    recipients: [contact],
    expiresAt: '2099-01-02T00:00:00.000Z',
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.alert.id, created.alert.id);
  assert.equal(duplicate.recipients.length, 1);
  const recipient = created.recipients[0];
  await store.recordSafetyAlertDelivery(recipient.id, {
    templateName: 'safety_alert_no_response',
    messageId: 'wamid.initial',
    reminderCount: 0,
    nextReminderAt: '2099-01-01T00:02:00.000Z',
  });
  await store.recordSafetyAlertDelivery(recipient.id, {
    templateName: 'dindin_safety_alert_reminder',
    messageId: 'wamid.reminder',
    reminderCount: 1,
    nextReminderAt: '2099-01-01T00:04:00.000Z',
  });

  const fromInitial = await store.getSafetyAlertRecipientByProviderMessageId('wamid.initial');
  assert.equal(fromInitial.id, recipient.id);
  assert.equal(fromInitial.contactPhone, '+917000809184');
  const acknowledged = await store.acknowledgeSafetyAlertRecipient(fromInitial.id);
  assert.ok(acknowledged.acknowledgedAt);
  assert.equal(acknowledged.nextReminderAt, null);
  assert.deepEqual(await store.listPendingSafetyAlertRecipients(), []);
});
