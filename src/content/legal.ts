export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: '1. Scope',
    paragraphs: [
      'This Privacy Policy applies to the Din Din mobile applications, website, self check-in reminders, WhatsApp alerts, customer support, and related services (together, the Service). It applies to registered Din Din users and to contacts who receive a missed check-in alert.',
    ],
  },
  {
    title: '2. Information we collect',
    paragraphs: ['Depending on how you use the Service, we may collect:'],
    bullets: [
      'Account information: name, mobile number, verification status, preferences, and account identifiers.',
      "Circle information: a contact's name, relationship, mobile number, and whether the user selected that person as a primary contact.",
      'Reminder and response information: the chosen weekdays and clock times, reminder stage, responses, missed responses, WhatsApp alert status, and related timestamps.',
      'Safety location: after you enable Always location access, Din Din stores the most recently captured latitude, longitude, accuracy, and capture time for safety escalation.',
      'Subscription information: plan and entitlement status, product and transaction identifiers, and store verification results. Payment card details are handled by Google Play or Apple, not by Din Din.',
      'Technical and support information: device and app details, service logs, diagnostic events, and information included in support requests.',
    ],
  },
  {
    title: '3. How we use information',
    paragraphs: [
      "We use information to create and secure accounts; operate self check-in schedules; deliver reminders; record a user's response; provide a static safety location during escalation; alert selected contacts after missed reminders or an immediate request for help; manage subscriptions; prevent fraud or misuse; troubleshoot the Service; respond to support; comply with law; and protect users and the Service.",
      'We do not sell personal information.',
    ],
  },
  {
    title: '4. WhatsApp alerts',
    paragraphs: [
      "A registered user supplies trusted contacts' mobile numbers and decides which are primary. After two missed reminders, Din Din sends primary contacts a contact summary followed by a static fresh or last-known safety location. If the user taps No, the same alert is sent immediately to primary and other circle contacts.",
      "Messages and shared location are processed using Meta's WhatsApp services and are also subject to Meta's terms and privacy practices. A registered user is responsible for adding only people they know and are permitted to contact, and for explaining the arrangement to them.",
    ],
  },
  {
    title: '5. When information is shared',
    paragraphs: [
      'We may share only the information needed with providers that support hosting, databases, mobile notifications, WhatsApp messaging, app-store billing, security, diagnostics, and customer support. We may also disclose information when required by law, to protect rights or safety, during a corporate transaction, or at a person\'s direction. Service providers are expected to handle information only for the services they provide to Din Din.',
    ],
  },
  {
    title: '6. Retention and security',
    paragraphs: [
      'The latest safety location is retained while the account remains active so it can be used if a fresh fix is unavailable, and is removed when the account is deleted, subject to limited backup, legal, security, and dispute-retention needs. Other information is kept only for as long as reasonably needed to provide the Service, meet legal and accounting duties, resolve disputes, and prevent abuse.',
      'We use reasonable administrative, technical, and organisational safeguards, including protected connections and restricted access. No system can guarantee absolute security.',
    ],
  },
  {
    title: '7. Your choices and rights',
    paragraphs: [
      'Registered users can update reminder, sound, and vibration preferences; change their primary contacts; manage location permission in device settings; and request correction, access, deletion, or account closure. Withdrawing Always location permission prevents new reminder activation and may stop safety escalation from including a current location.',
      'Depending on applicable law, a person may also have rights to obtain information, correct data, erase data, withdraw consent, object, restrict processing, or complain to a regulator. To make a privacy request, contact neocoin90@gmail.com. We may need to verify the request before acting on it.',
    ],
  },
  {
    title: '8. Children',
    paragraphs: [
      "Din Din is not intended for children to create their own accounts. A parent or lawful guardian should manage any use involving a minor and should consider the minor's age, understanding, best interests, and applicable consent requirements.",
    ],
  },
  {
    title: '9. International processing',
    paragraphs: [
      "Din Din and its providers may process information in countries other than the user's country. Where required, we use appropriate safeguards for such transfers.",
    ],
  },
  {
    title: '10. Changes to this policy',
    paragraphs: [
      'We may update this policy as the Service, providers, or legal requirements change. The revised policy will include a new effective date, and we will provide additional notice when appropriate.',
    ],
  },
  {
    title: '11. Contact',
    paragraphs: [
      'Questions, concerns, account-deletion requests, and privacy requests can be sent to neocoin90@gmail.com.',
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: '1. Agreement',
    paragraphs: [
      'By creating an account, buying a subscription, or using the Service, you agree to these Terms and the Privacy Policy. If you do not agree, do not use the Service. You must be legally able to enter this agreement and must provide accurate account information.',
    ],
  },
  {
    title: '2. The Service',
    paragraphs: [
      "Din Din lets a registered user add trusted contacts, choose a personal check-in schedule, and receive an on-device reminder asking whether they are okay. If the first one-minute alert is not answered, Din Din schedules a second alert 10 minutes later. If both are missed, Din Din may send the user's selected primary contacts a WhatsApp contact summary followed by a static fresh or last-known safety location. If the user taps No, Din Din attempts to send that alert immediately to the full circle.",
    ],
  },
  {
    title: '3. Your responsibilities',
    paragraphs: ['You agree to:'],
    bullets: [
      'add only contacts you know and are permitted to contact;',
      'tell primary contacts that Din Din may send them missed check-in alerts;',
      'keep your verified number, circle, reminder, Always location permission, and notification settings current;',
      'respond to alerts when you are able, while understanding delivery can be delayed or fail;',
      'use the Service lawfully and never for harassment, coercion, stalking, or deception; and',
      'use ordinary calls and emergency services when urgent help may be needed.',
    ],
  },
  {
    title: '4. Subscriptions and billing',
    paragraphs: [
      "Din Din may offer monthly and yearly auto-renewing subscriptions and a one-time lifetime purchase through Google Play, with App Store products added when available. Prices, taxes, renewal terms, cancellations, and refunds are shown by the applicable store and governed by its rules. Subscriptions renew automatically until cancelled through the store account. Lifetime access is non-consumable and does not renew. Deleting Din Din or a Din Din account does not automatically cancel a store subscription.",
    ],
  },
  {
    title: '5. Alerts, delivery, and safety limitations',
    paragraphs: [
      "Reminder and WhatsApp delivery depends on the device, battery and background restrictions, notification and exact-alarm permissions, network access, Meta's WhatsApp service, and correct contact information. Sound or vibration behaviour may differ by platform and user settings. Din Din cannot guarantee exact delivery time, continuous sound, successful escalation, or that a contact will see or act on a message.",
      'Never treat Din Din as a substitute for direct contact, welfare checks, professional care, or emergency services.',
    ],
  },
  {
    title: '6. Contact rights and acceptable use',
    paragraphs: [
      'You must not add a number obtained unlawfully, misrepresent an alert, use Din Din for marketing, or repeatedly contact a person who has objected. We may limit or suspend messaging to protect recipients, comply with provider rules, or prevent abuse.',
    ],
  },
  {
    title: '7. Third-party services',
    paragraphs: [
      "The Service relies on third parties including cloud hosting and database providers, Meta and WhatsApp, Google Play, Apple's App Store, notification services, and device operating systems. Their separate terms and privacy policies apply. We are not responsible for a third party's independent products, decisions, or outages.",
    ],
  },
  {
    title: '8. Availability and changes',
    paragraphs: [
      'We aim to provide a reliable Service but do not promise uninterrupted or error-free operation. We may maintain, modify, suspend, or discontinue features, and may impose reasonable limits to protect users or the Service. Where practical, we will give notice of material changes.',
    ],
  },
  {
    title: '9. Intellectual property',
    paragraphs: [
      "Din Din's software, design, brand, mascot, content, and related intellectual property belong to Din Din or its licensors. Subject to these Terms, we grant you a limited, personal, revocable, non-exclusive, non-transferable right to use the Service for its intended purpose.",
    ],
  },
  {
    title: '10. Disclaimers',
    paragraphs: [
      "To the extent permitted by law, the Service is provided 'as is' and 'as available.' We do not guarantee that a reminder or message will arrive, that a user's response reflects their actual safety, or that a contact will respond. Nothing in these Terms excludes rights or warranties that cannot lawfully be excluded.",
    ],
  },
  {
    title: '11. Limitation of liability',
    paragraphs: [
      'To the extent permitted by law, Din Din will not be liable for indirect, incidental, special, consequential, or punitive loss, or for loss caused by reliance on a check-in, missed check-in, alert, third-party service, device setting, or network failure. Any aggregate liability will be limited to the amount paid for the Service during the twelve months before the event giving rise to the claim. These limits do not apply where prohibited by law.',
    ],
  },
  {
    title: '12. Suspension and termination',
    paragraphs: [
      'You may stop using Din Din at any time and may request account deletion. We may restrict or end access when we reasonably believe there is misuse, risk, non-payment, a legal requirement, or a material breach of these Terms. Provisions that by their nature should continue after termination will survive.',
    ],
  },
  {
    title: '13. Governing terms and disputes',
    paragraphs: [
      'These Terms are subject to applicable law and do not limit mandatory consumer rights. Please contact neocoin90@gmail.com first so we can try to resolve any concern promptly.',
    ],
  },
  {
    title: '14. Changes and contact',
    paragraphs: [
      'We may update these Terms and will show a new effective date. Material changes may receive additional notice. Questions may be sent to neocoin90@gmail.com.',
    ],
  },
];
