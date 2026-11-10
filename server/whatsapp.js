import {randomUUID} from 'node:crypto';

const DEFAULT_ENDPOINT =
  'https://login.techiessolutions.in/whatsappbusiness/send-templated-message';
const DEFAULT_SERVICE_ENDPOINT =
  'https://login.techiessolutions.in/sendservicemessages/sendmessages';

export const WHATSAPP_TEMPLATES = Object.freeze({
  userRequestedHelp: 'dindin_user_requested_help',
  safetyLocation: 'dindin_safety_location_secure',
  safetyAlertReminder: 'dindin_safety_alert_reminder',
  callFollowup: 'dindin_call_followup',
  callPermission: 'dindin_safety_call_permission',
  missedCheckIn: 'safety_alert_no_response',
});

function configuration() {
  return {
    endpoint: process.env.TECHIES_WHATSAPP_ENDPOINT || DEFAULT_ENDPOINT,
    serviceEndpoint: process.env.TECHIES_WHATSAPP_SERVICE_ENDPOINT || DEFAULT_SERVICE_ENDPOINT,
    apiKey: process.env.TECHIES_WHATSAPP_API_KEY || '',
    sender: process.env.TECHIES_WHATSAPP_SENDER || '',
    campaignId: process.env.TECHIES_WHATSAPP_CAMPAIGN_ID || '',
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
  };
}

export function whatsappConfigured() {
  const value = configuration();
  return Boolean(
    value.apiKey && value.sender && value.campaignId && process.env.ALERT_LINK_SECRET,
  );
}

function textParameter(text) {
  return {type: 'text', text: String(text)};
}

function bodyComponent(values) {
  return {type: 'BODY', parameters: values.map(textParameter)};
}

function urlButtonComponent(token) {
  return {
    type: 'button',
    sub_type: 'URL',
    index: 0,
    parameters: [textParameter(token)],
  };
}

export function buildTemplatePayload({
  templateName,
  to,
  receiverName,
  bodyValues,
  buttonToken,
}) {
  const value = configuration();
  return {
    api_key: value.apiKey,
    sender: value.sender,
    campaign_id: value.campaignId,
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to).replace(/\D/g, ''),
    receiver_name: receiverName,
    type: 'template',
    template: {
      name: templateName,
      language: {code: value.language},
      components: [
        bodyComponent(bodyValues),
        ...(buttonToken ? [urlButtonComponent(buttonToken)] : []),
      ],
    },
  };
}

async function sendTemplate(input) {
  if (!whatsappConfigured()) {
    return {mode: 'simulation', messageId: `sim-whatsapp-${randomUUID()}`};
  }
  const value = configuration();
  let response;
  try {
    response = await fetch(value.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(buildTemplatePayload(input)),
      signal: globalThis.AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('WhatsApp provider could not be reached');
  }

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = null;
  }
  // Techies historically wrapped success as {status: true, message_id}, but
  // their current endpoint can pass through Meta's native
  // {messaging_product, contacts, messages: [{id}]} response. Require a real
  // provider message ID in either documented shape before recording delivery.
  const messageId = result?.message_id ||
    result?.messageId ||
    result?.data?.message_id ||
    result?.data?.messageId ||
    result?.messages?.[0]?.id;
  if (!response.ok || result?.status === false || !messageId) {
    const providerMessage = typeof result?.message === 'string'
      ? result.message.replace(/[\r\n]+/g, ' ').slice(0, 240)
      : typeof result?.error?.message === 'string'
        ? result.error.message.replace(/[\r\n]+/g, ' ').slice(0, 240)
      : `HTTP ${response.status}`;
    throw new Error(`WhatsApp provider rejected the template: ${providerMessage}`);
  }
  return {mode: 'live', messageId};
}

export function sendUserRequestedHelpTemplate({contact, user, contactSummary}) {
  return sendTemplate({
    templateName: WHATSAPP_TEMPLATES.userRequestedHelp,
    to: contact.phone,
    receiverName: contact.name,
    bodyValues: [user.name, user.phone, contactSummary],
  });
}

export function sendSafetyLocationTemplate({contact, user, location, buttonToken}) {
  const capturedAt = new Date(location.capturedAt).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
  return sendTemplate({
    templateName: WHATSAPP_TEMPLATES.safetyLocation,
    to: contact.phone,
    receiverName: contact.name,
    bodyValues: [user.name, `${capturedAt} IST`],
    buttonToken,
  });
}

export function sendSafetyAlertReminderTemplate({
  contact,
  user,
  reminderNumber,
}) {
  const reminderInput = {
    templateName: WHATSAPP_TEMPLATES.safetyAlertReminder,
    to: contact.phone,
    receiverName: contact.name,
    bodyValues: [String(reminderNumber), user.name, user.phone],
  };
  return sendTemplate(reminderInput)
    .then(result => ({...result, templateName: WHATSAPP_TEMPLATES.safetyAlertReminder}))
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      const templateIsUnavailable = message.includes('(#132001)') ||
        message.toLowerCase().includes('template name does not exist');
      if (!templateIsUnavailable) throw error;

      // Meta can remove or temporarily lose a template translation even after
      // approval. Keep safety escalation working with the approved no-response
      // template instead of silently exhausting all three delivery attempts.
      return sendTemplate({
        templateName: WHATSAPP_TEMPLATES.missedCheckIn,
        to: contact.phone,
        receiverName: contact.name,
        bodyValues: [user.name, user.phone],
      }).then(result => ({...result, templateName: WHATSAPP_TEMPLATES.missedCheckIn}));
    });
}

export function sendCallFollowupTemplate({contact, user}) {
  return sendTemplate({
    templateName: WHATSAPP_TEMPLATES.callFollowup,
    to: contact.phone,
    receiverName: contact.name,
    bodyValues: [user.name, user.phone],
  });
}

export function sendCallPermissionTemplate({contact, user}) {
  if (!whatsappConfigured()) {
    return Promise.resolve({mode: 'simulation', messageId: `sim-whatsapp-${randomUUID()}`});
  }
  const value = configuration();
  const payload = {
    api_key: value.apiKey,
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(contact.phone).replace(/\D/g, ''),
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATES.callPermission,
      language: {code: value.language},
      components: [bodyComponent([user.name])],
    },
  };
  return fetch(value.serviceEndpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
    signal: globalThis.AbortSignal.timeout(15_000),
  }).then(async response => {
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = null;
    }
    const messageId = result?.messages?.[0]?.id || result?.message_id;
    if (!response.ok || !messageId) {
      const providerMessage = typeof result?.error?.message === 'string'
        ? result.error.message.replace(/[\r\n]+/g, ' ').slice(0, 240)
        : typeof result?.message === 'string'
          ? result.message.replace(/[\r\n]+/g, ' ').slice(0, 240)
          : `HTTP ${response.status}`;
      throw new Error(`WhatsApp provider rejected the calling permission request: ${providerMessage}`);
    }
    return {mode: 'live', messageId};
  }).catch(error => {
    if (error instanceof Error && error.message.startsWith('WhatsApp provider rejected')) {
      throw error;
    }
    throw new Error('WhatsApp provider could not be reached');
  });
}

export function sendMissedCheckInTemplate({contact, user}) {
  return sendTemplate({
    templateName: WHATSAPP_TEMPLATES.missedCheckIn,
    to: contact.phone,
    receiverName: contact.name,
    bodyValues: [user.name, user.phone],
  });
}
