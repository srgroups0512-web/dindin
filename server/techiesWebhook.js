export const SAFETY_ALERT_ACKNOWLEDGEMENT = 'I have seen this alert';

function decodeMessageText(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const decoded = JSON.parse(value);
    return decoded && typeof decoded === 'object' ? decoded : null;
  } catch {
    return null;
  }
}

function normalizedText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseTechiesQuickReply(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const message = decodeMessageText(payload.message_text);
  const messageType = String(payload.message_type || message?.type || '').toLowerCase();
  const messageSubType = String(payload.message_sub_type || '').toLowerCase();
  const direction = String(payload.direction || 'inbound').toLowerCase();
  if (
    direction !== 'inbound' ||
    (messageType !== 'button' && messageSubType !== 'button')
  ) return null;

  const buttonText = message?.button?.text || message?.button?.payload ||
    payload.button_text || payload.button_payload;
  const acknowledgement = normalizedText(buttonText) ===
    normalizedText(SAFETY_ALERT_ACKNOWLEDGEMENT);
  const targetedMessageId = String(
    payload.targeted_message_id || message?.context?.id || '',
  ).trim();
  const inboundMessageId = String(payload.message_id || message?.id || '').trim();
  const senderPhone = String(payload.message_from || message?.from || '').replace(/\D/g, '');
  if (!acknowledgement || !targetedMessageId || !inboundMessageId || !senderPhone) return null;
  return {targetedMessageId, inboundMessageId, senderPhone, buttonText};
}
