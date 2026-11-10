# Din Din third-party setup

## Production architecture

Use Neon PostgreSQL for related account, contact, schedule, response, entitlement, and event data. Keep every database, Meta, Google, Apple, and OTP credential on the backend or in the host secret manager. Never place provider secrets in the mobile bundle.

The active product flow is self check-in:

1. The app user receives an on-device reminder.
2. If it is unanswered, the app and backend advance to reminder two after 10 minutes.
3. After the second one-minute response window, the backend sends a WhatsApp contact summary and static safety location to each selected primary contact. Tapping **No** sends both immediately to every circle contact.

No paid location API is required. Android Location Services and iOS Core Location capture a single fresh or last-known coordinate after the user explicitly enables Always access. Din Din does not continuously track the user.

## 1. Neon PostgreSQL

1. Keep the pooled Neon URL as `DATABASE_URL` for API traffic.
2. Keep the direct Neon URL as `DIRECT_URL` for migrations.
3. Store both values only in the API host's secret manager and local ignored `server/.env`.
4. Apply [server/db/schema.sql](server/db/schema.sql):

   ```powershell
   cd server
   npm run db:migrate
   npm run db:check
   ```

5. Use a restricted runtime database role. Keep the owner role for migrations only.
6. Enable Neon backups and define retention for check-in event history.

The schema includes `emergency_contacts`, `self_check_in_schedules`, `self_check_in_events`, and `user_safety_locations`. Old relative/location-share tables remain only for backwards-compatible migration and are not used by the current app flow.

## 2. Meta WhatsApp Cloud API

1. Create and verify the client's Meta Business portfolio.
2. Create a Business app at Meta for Developers and add the WhatsApp product.
3. Register the production sender number. Save the **Phone Number ID** as `WHATSAPP_PHONE_NUMBER_ID`.
4. Create a system user with only the required WhatsApp permissions and generate a production access token. Store it as `WHATSAPP_ACCESS_TOKEN`.
5. Create and submit a Utility template named `dindin_missed_checkin` with three body variables.

Suggested body:

`{{1}} needs a Din Din safety check. Their number is {{2}}. Their circle contacts are: {{3}}.`

Variables:

- `{{1}}`: registered user's display name
- `{{2}}`: registered user's verified mobile number
- `{{3}}`: names and mobile numbers in the user's circle

6. Create and submit a second Utility template named `dindin_safety_location`. Set its header type to **Location** and use two body variables.

Suggested body:

`This is {{1}}'s Din Din safety location, captured at {{2}}. Please contact them now.`

7. Set these backend variables:

   ```text
   WHATSAPP_GRAPH_VERSION=v24.0
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_MISSED_TEMPLATE_NAME=dindin_missed_checkin
   WHATSAPP_LOCATION_TEMPLATE_NAME=dindin_safety_location
   WHATSAPP_TEMPLATE_LANGUAGE=en
   ```

8. Obtain the user's permission to alert each circle contact, and follow WhatsApp opt-in and template rules.
9. Test in Meta's test-number environment, then test both a real missed check-in and the **No** action before production.

The current self check-in flow sends outbound Utility templates and does not require the recipient to press a WhatsApp button or install Din Din.

## 3. Android notifications and exact alarms

The app uses Notifee with high-priority alarm notifications, independent sound/vibration controls, **Yes** and **No** actions, and a 60-second timeout.

1. Keep notification, exact-alarm, foreground location, and background location permissions in `AndroidManifest.xml`.
2. Ask for notification permission when the user activates a reminder.
3. On Android versions that restrict exact alarms, direct the user to **Alarms & reminders** settings.
4. Test with battery saver on, the app swiped away, the phone locked, and the device rebooted.
5. For production reliability, add a boot receiver/rescheduling strategy and test vendor-specific battery restrictions on Samsung, Xiaomi, Oppo/Realme, Vivo, and OnePlus devices.

## 4. iOS notifications

The app uses a time-sensitive notification category with **Yes, I'm okay** and **No, alert my circle** actions. Apple controls vibration and notification sound behaviour. Ordinary iOS notification sounds must be shorter than 30 seconds, so a standard App Store app cannot force continuous sound and vibration for one full minute in the background.

1. On macOS, run `cd ios; pod install`.
2. Enable Location Updates under Background Modes and include both location usage descriptions. Enable Push Notifications only if remote notification delivery is later added.
3. Request notification permission before scheduling reminders.
4. Test on a physical iPhone with Focus modes, Silent Mode, and notification summaries.
5. Do not request the Critical Alerts entitlement unless the app qualifies and Apple approves it.

## 5. Google Play subscriptions

Product IDs:

- `info.dindin.app.subscription.monthly`
- `info.dindin.app.subscription.halfyearly`
- `info.dindin.app.subscription.yearly`

1. Create the app in Play Console with package `info.dindin.app` and upload a signed bundle to Internal testing.
2. Under **Monetize > Products > Subscriptions**, create and activate the three products/base plans.
3. Enable the Google Play Developer API in Google Cloud.
4. Create a least-privilege service account and grant it the required Play Console order/subscription permissions.
5. Put its JSON in the backend secret manager and set `GOOGLE_PLAY_PACKAGE_NAME=info.dindin.app`.
6. Implement `/v1/billing/verify` using the Play Developer API. Bind each purchase token to one Din Din user and acknowledge valid purchases.
7. Configure Real-time Developer Notifications through Pub/Sub and handle lifecycle events idempotently.
8. Test purchase, renewal, cancellation, grace period, account hold, restore, and refund.

## 6. Apple subscriptions

1. Enrol in Apple Developer, create bundle ID `info.dindin.app`, and create the app in App Store Connect.
2. Complete paid-app agreements, tax, and banking.
3. Create one subscription group with the same three product IDs and 1-month, 6-month, and 1-year durations.
4. Add In-App Purchase capability and test with StoreKit configuration, Sandbox, and TestFlight.
5. Create an App Store Connect In-App Purchase API key. Store `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` only on the backend.
6. Verify signed JWS transactions in `/v1/billing/verify` and bind entitlements to the authenticated user.
7. Configure App Store Server Notifications V2 and process renewal, billing retry, grace period, expiry, and refund events idempotently.

## Inputs still needed before production

- Approved Meta Business account, sender number, Phone Number ID, access token, and `dindin_missed_checkin` template
- Restricted Neon runtime credentials and final backup/retention policy
- Google Play Console/Cloud access, service account, and final INR prices
- Apple Developer/App Store Connect access, agreements, API key, and final INR tiers
- Final operating legal entity, registered address, grievance contact, and counsel-approved privacy/terms copy
- Production monitoring, alerting, durable job runner, and incident-response process
