DIN DIN — iOS / APP STORE DEPLOYER HANDOFF
Prepared: 4 November 2026

Application
  Name: Din Din
  Bundle identifier: info.dindin.app
  React Native CLI project
  Production API: https://api.dindin.info

Firebase
  The configured file is included at:
    ios/DinDin/GoogleService-Info.plist
  It is already referenced by ios/DinDin.xcodeproj and included in Resources.
  The same plist is supplied separately beside this ZIP for convenience.

Mac setup
  1. Install a current supported Node.js, Ruby, Bundler, CocoaPods and Xcode.
  2. From the project root run: npm ci
  3. Run: bundle install
  4. Run: cd ios && bundle exec pod install
  5. Open ios/DinDin.xcworkspace in Xcode (not only the .xcodeproj).
  6. Select the DinDin target and choose the owner's Apple Developer Team.
  7. Keep the bundle identifier as info.dindin.app.
  8. Set the App Store marketing version and a new unique build number. The
     untouched Xcode project currently contains version 1.0 and build 1.
  9. Enable Push Notifications and Background Modes for Remote notifications
     and Location updates in Signing & Capabilities.
 10. Create the App Store Connect app record and provisioning profile, archive
     a Release build, validate it, then upload through Xcode Organizer.

Push notifications
  Create an APNs authentication key in the Apple Developer account and upload
  it to Firebase Cloud Messaging for the din-din-a5224 project. Apple signing
  certificates, APNs private keys and provisioning profiles are account-owned
  secrets and are not included in this handoff.

In-app purchases
  App Store products and server-side Apple purchase verification still require
  the owner's paid Apple Developer/App Store Connect account. Create Apple
  equivalents for the individual and family plans, then provide the final Apple
  product identifiers, Issuer ID, Key ID and App Store Server API private key to
  the backend administrator through a secure channel.

Legal URLs
  Privacy: https://dindin.info/privacy.html
  Terms: https://dindin.info/terms.html
  Account deletion: https://dindin.info/delete-account.html

Security exclusions
  This source package intentionally excludes node_modules, Pods, Gradle/Xcode
  build caches, server/.env, database credentials, Firebase Admin credentials,
  Google Play service-account files, Android signing keys, Apple private keys,
  certificates and provisioning profiles. Install dependencies from the lock
  files. Do not request production secrets merely to compile the iOS client.
