import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTemplatePayload,
  sendCallFollowupTemplate,
  sendCallPermissionTemplate,
  sendMissedCheckInTemplate,
  sendSafetyAlertReminderTemplate,
  sendSafetyLocationTemplate,
  sendUserRequestedHelpTemplate,
  WHATSAPP_TEMPLATES,
} from './whatsapp.js';

test('Techies location payload preserves approved body and URL-button ordering', () => {
  process.env.TECHIES_WHATSAPP_API_KEY = 'test-api-key';
  process.env.TECHIES_WHATSAPP_SENDER = '918200973656';
  process.env.TECHIES_WHATSAPP_CAMPAIGN_ID = '32843';
  process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en_US';
  const payload = buildTemplatePayload({
    templateName: WHATSAPP_TEMPLATES.safetyLocation,
    to: '+91 70008 09184',
    receiverName: 'Primary Contact',
    bodyValues: ['Din Din User', '30 Oct 2026, 11:00 AM IST'],
    buttonToken: 'recipient.signature',
  });
  assert.equal(payload.to, '917000809184');
  assert.equal(payload.template.name, 'dindin_safety_location_secure');
  assert.deepEqual(payload.template.components[0].parameters.map(item => item.text), [
    'Din Din User', '30 Oct 2026, 11:00 AM IST',
  ]);
  assert.deepEqual(payload.template.components[1], {
    type: 'button',
    sub_type: 'URL',
    index: 0,
    parameters: [{type: 'text', text: 'recipient.signature'}],
  });
});

test('all six approved templates keep exact names, parameters, and button types', async () => {
  delete process.env.TECHIES_WHATSAPP_API_KEY;
  process.env.ALERT_LINK_SECRET = 'test-only-alert-link-secret';
  const contact = {name: 'Primary Contact', phone: '+91 70008 09184'};
  const user = {name: 'Din Din User', phone: '+91 90000 00000'};
  const originalFetch = globalThis.fetch;
  const payloads = [];
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify({status: true, message_id: `message-${payloads.length}`}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  };
  process.env.TECHIES_WHATSAPP_API_KEY = 'test-api-key';
  try {
    await sendUserRequestedHelpTemplate({contact, user, contactSummary: 'Family: +91 91111 11111'});
    await sendSafetyLocationTemplate({
      contact,
      user,
      location: {capturedAt: '2026-10-30T05:30:00.000Z'},
      buttonToken: 'token',
    });
    await sendSafetyAlertReminderTemplate({contact, user, reminderNumber: 2});
    await sendCallFollowupTemplate({contact, user});
    await sendCallPermissionTemplate({contact, user});
    await sendMissedCheckInTemplate({contact, user});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(payloads.map(payload => payload.template.name), [
    'dindin_user_requested_help',
    'dindin_safety_location_secure',
    'dindin_safety_alert_reminder',
    'dindin_call_followup',
    'dindin_safety_call_permission',
    'safety_alert_no_response',
  ]);
  assert.deepEqual(payloads.map(payload => payload.template.components[0].parameters.length), [3, 2, 3, 2, 1, 2]);
  assert.deepEqual(payloads.map(payload => payload.template.components.length), [1, 2, 1, 1, 1, 1]);
  assert.equal(payloads[1].template.components[1].sub_type, 'URL');
  assert.equal(urls[4], 'https://login.techiessolutions.in/sendservicemessages/sendmessages');
});

test('safety reminder falls back to approved no-response template when Meta loses its translation', async () => {
  process.env.TECHIES_WHATSAPP_API_KEY = 'test-api-key';
  process.env.TECHIES_WHATSAPP_SENDER = '918200973656';
  process.env.TECHIES_WHATSAPP_CAMPAIGN_ID = '32843';
  process.env.ALERT_LINK_SECRET = 'test-only-alert-link-secret';
  const originalFetch = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    if (payload.template.name === 'dindin_safety_alert_reminder') {
      return new Response(JSON.stringify({
        status: false,
        message: '(#132001) Template name does not exist in the translation',
      }), {status: 400, headers: {'Content-Type': 'application/json'}});
    }
    return new Response(JSON.stringify({status: true, message_id: 'fallback-message'}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  };
  try {
    const result = await sendSafetyAlertReminderTemplate({
      contact: {name: 'Primary Contact', phone: '+91 70008 09184'},
      user: {name: 'Din Din User', phone: '+91 90000 00000'},
      reminderNumber: 1,
    });
    assert.equal(result.messageId, 'fallback-message');
    assert.equal(result.templateName, 'safety_alert_no_response');
    assert.deepEqual(payloads.map(payload => payload.template.name), [
      'dindin_safety_alert_reminder',
      'safety_alert_no_response',
    ]);
    assert.deepEqual(payloads[1].template.components[0].parameters.map(item => item.text), [
      'Din Din User', '+91 90000 00000',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Techies Meta-native success response is accepted only when it has a message ID', async () => {
  process.env.TECHIES_WHATSAPP_API_KEY = 'test-api-key';
  process.env.TECHIES_WHATSAPP_SENDER = '918200973656';
  process.env.TECHIES_WHATSAPP_CAMPAIGN_ID = '32843';
  process.env.ALERT_LINK_SECRET = 'test-only-alert-link-secret';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    messaging_product: 'whatsapp',
    contacts: [{wa_id: '917000809184'}],
    messages: [{id: 'wamid.native-success'}],
  }), {status: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}});
  try {
    const result = await sendMissedCheckInTemplate({
      contact: {name: 'Primary Contact', phone: '+91 70008 09184'},
      user: {name: 'Din Din User', phone: '+91 90000 00000'},
    });
    assert.equal(result.mode, 'live');
    assert.equal(result.messageId, 'wamid.native-success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
