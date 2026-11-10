# Din Din

Din Din is a React Native CLI self check-in app for Android and iOS. The registered user sets a recurring reminder for themselves and selects trusted people in My Circle. At the scheduled time, the user's phone asks them to confirm they are okay. If the first response window is missed, a second reminder starts 10 minutes later. If that is also missed, Din Din alerts the user's selected primary contacts on WhatsApp with the user's contact summary and safety location.

Circle contacts do not need to install Din Din.

## Included flows

- Animated onboarding, registration, and real mobile OTP verification
- Monthly, six-month, and yearly native subscription products
- Google Play Billing and Apple StoreKit integration through `react-native-iap`
- My Check-in, My Circle, add-contact, reminder, and settings screens
- Daily, every-two-days, and weekly self check-ins at any minute the user chooses
- Actionable native notification with **Yes, I'm okay** and **No, alert my circle**
- First response window, automatic retry after 10 minutes, and WhatsApp escalation after the second window
- Explicit onboarding for Always location permission; a static fresh or last-known location is shared only during escalation
- Independent sound and vibration controls
- Android alarm notification with looping sound/vibration for up to one minute
- iOS time-sensitive notification and action; iOS controls notification sound/vibration duration and does not permit an ordinary app to force a one-minute alarm sound
- Neon PostgreSQL persistence for accounts, sessions, preferences, circle contacts, safety location, reminders, and event history

## Run locally

```powershell
npm install
cd server
npm install
$env:NODE_ENV = 'test'
$env:OTP_PROVIDER = 'test'
$env:OTP_HASH_SECRET = 'local-test-secret'
$env:OTP_TEST_CODE = '384291'
$env:USE_IN_MEMORY_DB = 'true'
npm start
```

In a second terminal from the project root:

```powershell
npm start
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
npm run android
```

The local service uses WhatsApp simulation mode until Meta credentials are configured. The test OTP provider is accepted only when `NODE_ENV=test`; there is no development OTP in the app or production server mode.

The no-login landing page and its separate Privacy and Terms pages are in `../sites/dindin-site-checkout/dist`.

## Quality checks

```powershell
npm run lint
npm run typecheck
npm test -- --runInBand
cd server
npm test
```

## Store products

Create these subscription product IDs in both Google Play Console and App Store Connect:

- `info.dindin.app.subscription.monthly`
- `info.dindin.app.subscription.halfyearly`
- `info.dindin.app.subscription.yearly`

Purchase verification is fail-closed. Configure store server credentials before enabling production subscriptions; the mobile client never grants release access from an unverified receipt.

## Platform notes

- Android can be built on Windows with the included Gradle project.
- iOS requires macOS, Xcode, CocoaPods, signing, and matching App Store Connect products.
- Both the current debug and release clients use `https://api.dindin.info`.
- Exact Android timing requires the **Alarms & reminders** permission on Android versions that restrict exact alarms.
- The backend timer model is restored at startup. Before running multiple API instances, move timing to a durable queue with one scheduler leader or distributed job locking.

See `THIRD_PARTY_SETUP.md` for Neon, Meta, Google Play Billing, and Apple subscription setup.
