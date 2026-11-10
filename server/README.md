# Din Din API

This service owns OTP verification, authenticated circle contacts, self check-in timing, WhatsApp escalation, preferences, and store receipt validation. Secrets must never be placed in the mobile app.

## Local run

```powershell
npm install
npm run db:migrate
npm start
adb reverse tcp:8787 tcp:8787
```

The API reads secrets from ignored `server/.env`. Neon PostgreSQL persists users, sessions, preferences, emergency contacts, self check-in schedules, and event history. Without Meta credentials, missed-check-in alerts run in simulation mode.

Registration starts with `POST /v1/auth/request-otp`, which creates a six-digit, ten-minute challenge. `POST /v1/auth/verify-otp` consumes it and returns a bearer session. Codes are keyed hashes, limited to five attempts, cannot be reused, and are rate-limited. The API fails closed when the production provider is unavailable.

## Active endpoints

- `GET|POST /v1/contacts`
- `PUT|DELETE /v1/contacts/:id`
- `GET|PUT|DELETE /v1/self-check-in`
- `POST /v1/self-check-in/acknowledge`
- `GET|PUT /v1/me/preferences`

Non-production simulation routes:

- `POST /v1/self-check-in/simulate-first`
- `POST /v1/self-check-in/simulate-second`
- `POST /v1/self-check-in/simulate-missed`

The state sequence is `scheduled -> waiting-first -> waiting-second -> safe|missed|send-failed`. The second stage begins after 10 minutes. WhatsApp escalation begins one minute later if there is still no response.

## WhatsApp safety escalation

The production integration uses the Techies Solutions template endpoint. Approved templates are:

- `dindin_user_requested_help`
- `dindin_safety_location_secure`
- `dindin_safety_alert_reminder`
- `dindin_call_followup`
- `dindin_safety_call_permission`
- `safety_alert_no_response`

Only the location template has a URL button. It receives a per-recipient, HMAC-signed token; the public page displays the last saved safety location and requires an explicit POST confirmation. Four safety-alert templates use the approved static `I have seen this alert` Quick Reply, while `dindin_safety_call_permission` uses WhatsApp's built-in calling-permission action. Configure Techies to send those events to `POST /webhooks/techies/whatsapp?token=...`. Din Din verifies the webhook secret, matches `targeted_message_id` to every recorded outbound delivery, verifies the sender's phone number, and then stops that recipient's remaining retries.

After an immediate help request, Din Din sends the help and location templates and then up to three two-minute reminders. After an ordinary missed check-in, `safety_alert_no_response` is sent first, followed by reminders 1 through 3 while the contact has not acknowledged the alert. The first reminder is the contact's second alert and records `automated-call-required`. An actual call and the call-followup template must not be triggered until a calling provider confirms the call attempt.

## Production requirements

- Configure `OTP_PROVIDER`, `OBLIGR_API_KEY`, and a long random `OTP_HASH_SECRET`.
- Configure the Techies WhatsApp variables, `TECHIES_WHATSAPP_WEBHOOK_SECRET`, and an independent random `ALERT_LINK_SECRET`.
- Run `npm run db:migrate` during deployment and use direct Neon connectivity for migrations when available.
- Move timers to a durable worker/queue with distributed locking before running multiple API instances.
- Complete Google Play Developer API and App Store Server API receipt verification.
- Host behind HTTPS and keep credentials in a secret manager.
- Add monitoring for overdue jobs and failed WhatsApp sends.

See `../THIRD_PARTY_SETUP.md` for the provider checklist.
