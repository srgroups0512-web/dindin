import {createHmac, timingSafeEqual} from 'node:crypto';

function signingSecret() {
  const secret = process.env.ALERT_LINK_SECRET;
  if (!secret) throw new Error('Safety alert link signing is not configured');
  return secret;
}

function signature(recipientId) {
  return createHmac('sha256', signingSecret())
    .update(`dindin-safety-alert:${recipientId}`)
    .digest('base64url');
}

export function createSafetyAlertToken(recipientId) {
  return `${recipientId}.${signature(recipientId)}`;
}

export function verifySafetyAlertToken(token) {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(String(token || ''));
  if (!match) return null;
  const actual = Buffer.from(match[2]);
  const expected = Buffer.from(signature(match[1]));
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? match[1]
    : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderSafetyAlertPage(record, {token, acknowledged = false} = {}) {
  const location = record.location;
  const capturedAt = location
    ? new Date(location.capturedAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      })
    : null;
  const mapsUrl = location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`
    : null;
  const accuracy = location?.accuracy == null
    ? ''
    : `<p class="meta">Approximate accuracy: ${escapeHtml(Math.round(location.accuracy))} metres</p>`;
  const action = `/safety-alert/${encodeURIComponent(token)}/acknowledge`;
  const state = acknowledged || record.acknowledgedAt
    ? `<div class="confirmed"><strong>Thank you.</strong><br>This alert has been acknowledged. Din Din will stop reminder messages to you for this alert.</div>`
    : `<form method="post" action="${action}"><button type="submit">I have seen this alert</button></form>`;
  const locationCard = location
    ? `<section class="location"><div class="pin">&#9679;</div><div><h2>Last available safety location</h2><p>Captured ${escapeHtml(capturedAt)} IST</p>${accuracy}<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open location in Maps</a></div></section>`
    : `<section class="location unavailable"><div><h2>Location unavailable</h2><p>Din Din could not attach a saved safety location to this alert.</p></div></section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Din Din safety alert</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f7f6;color:#102f3b;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:620px;margin:0 auto;padding:32px 18px 56px}.brand{display:flex;align-items:center;gap:11px;font-weight:900;font-size:20px;color:#075b6b}.brand-logo{display:block;width:46px;height:46px;object-fit:contain}.card{margin-top:22px;background:#fff;border:1px solid #d8e7e4;border-radius:26px;padding:26px;box-shadow:0 18px 50px rgba(7,60,70,.10)}.eyebrow{margin:0 0 8px;color:#e15454;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-size:30px;line-height:1.12}p{color:#557079;line-height:1.55}.location{display:flex;gap:14px;margin:24px 0;padding:18px;border-radius:18px;background:#edf9f6;border:1px solid #ccebe3}.location h2{margin:0 0 5px;font-size:17px}.location p{margin:2px 0}.location a{display:inline-block;margin-top:11px;color:#087c70;font-weight:800}.pin{display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:13px;background:#c7f0e5;color:#087c70}.meta{font-size:13px}.unavailable{background:#fff8eb;border-color:#f2dfb8}button{width:100%;border:0;border-radius:15px;background:#075b6b;color:#fff;font-size:16px;font-weight:900;padding:16px;cursor:pointer}.confirmed{border-radius:16px;background:#e3f7ee;border:1px solid #b8e7d5;color:#145c4b;padding:17px;line-height:1.5}.note{font-size:12px;color:#70868d;margin-top:18px}@media(max-width:480px){.wrap{padding-top:18px}.card{padding:21px;border-radius:22px}h1{font-size:25px}}
</style></head><body><main class="wrap"><div class="brand"><img class="brand-logo" src="https://dindin.info/assets/dindin-penguin.png" alt="Din Din logo">Din Din</div><article class="card"><p class="eyebrow">Safety alert</p><h1>Please check on ${escapeHtml(record.userName)}</h1><p>${escapeHtml(record.userName)} did not complete a Din Din safety check-in or requested help. Contact them directly as soon as possible.</p>${locationCard}${state}<p class="note">The location is the latest available point saved by Din Din and may not represent the person's current position. For an emergency, contact local emergency services.</p></article></main></body></html>`;
}

export function renderExpiredSafetyAlertPage() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Din Din alert expired</title></head><body style="margin:0;background:#f2f7f6;color:#102f3b;font-family:system-ui"><main style="max-width:560px;margin:60px auto;padding:24px"><div style="display:flex;align-items:center;gap:11px;color:#075b6b;font-size:20px;font-weight:900"><img src="https://dindin.info/assets/dindin-penguin.png" alt="Din Din logo" style="display:block;width:46px;height:46px;object-fit:contain">Din Din</div><section style="margin-top:22px;background:#fff;border:1px solid #d8e7e4;border-radius:24px;padding:26px"><h1 style="margin-top:0">This safety link is unavailable</h1><p style="color:#557079;line-height:1.55">The link is invalid or has expired. Please contact the person directly if you are concerned about their safety.</p></section></main></body></html>';
}
