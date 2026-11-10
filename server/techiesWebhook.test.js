import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTechiesQuickReply} from './techiesWebhook.js';

test('Techies quick-reply webhook resolves the targeted outbound message', () => {
  const result = parseTechiesQuickReply({
    message_id: 'wamid.inbound',
    message_text: JSON.stringify({
      context: {from: '918200973656', id: 'wamid.outbound'},
      from: '917000809184',
      id: 'wamid.inbound',
      type: 'button',
      button: {payload: 'I have seen this alert', text: 'I have seen this alert'},
    }),
    targeted_message_id: 'wamid.outbound',
    message_type: 'button',
    message_from: '91 70008 09184',
    message_sub_type: 'button',
    direction: 'inbound',
    status: 'success',
  });
  assert.deepEqual(result, {
    targetedMessageId: 'wamid.outbound',
    inboundMessageId: 'wamid.inbound',
    senderPhone: '917000809184',
    buttonText: 'I have seen this alert',
  });
});

test('Techies webhook ignores unrelated buttons and outbound events', () => {
  assert.equal(parseTechiesQuickReply({
    message_id: 'wamid.inbound',
    targeted_message_id: 'wamid.outbound',
    message_type: 'button',
    message_from: '917000809184',
    direction: 'inbound',
    message_text: JSON.stringify({button: {text: 'Schedule a Call'}}),
  }), null);
  assert.equal(parseTechiesQuickReply({
    message_id: 'wamid.inbound',
    targeted_message_id: 'wamid.outbound',
    message_type: 'button',
    message_from: '917000809184',
    direction: 'outbound',
    message_text: JSON.stringify({button: {text: 'I have seen this alert'}}),
  }), null);
});
