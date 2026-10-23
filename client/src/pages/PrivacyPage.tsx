export function PrivacyPage() {
  return (
    <div className="container-page py-16 lg:py-24">
      <div className="max-w-3xl mx-auto prose dark:prose-invert prose-gray">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-10">
          Last updated: October 2026
        </p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            1. Information We Collect
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We collect the following categories of information: account information you
            provide (email, display name, password); if you sign in with another account
            (Google, Apple, Microsoft, Facebook or GitHub), the email address, name, profile
            picture and account id that provider shares with us, and nothing else from that
            account; usage data (pages visited, races
            viewed, features used); and payment information processed securely through
            Stripe (we do not store your full credit card details).
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            2. How We Use Your Information
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We use your information to: provide and maintain the Service; process
            subscriptions and payments; send transactional emails (account verification,
            password resets, billing notifications); improve the Service based on usage
            patterns; and respond to support requests.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            3. Data Sharing
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We do not sell your personal information. We share data only with service
            providers necessary to operate the Service: Stripe for payment processing,
            Resend for transactional email delivery, PostHog (United States) for product
            analytics, and cloud infrastructure providers (AWS, Vercel/Railway) for
            hosting. These providers are bound by their own privacy policies and data
            processing agreements.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            4. Data Retention
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We retain your account data for as long as your account is active. If you
            delete your account, we will remove your personal data within 30 days, except
            where retention is required by law or for legitimate business purposes (such
            as fraud prevention). Aggregated, anonymized usage data may be retained
            indefinitely.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            5. Security
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We implement industry-standard security measures to protect your data,
            including encrypted connections (TLS), hashed passwords (bcrypt), and secure
            token management. No system is perfectly secure, and we cannot guarantee
            absolute security, but we take reasonable steps to protect your information.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            6. Cookies
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We use essential cookies for authentication (refresh tokens stored as httpOnly
            cookies). We do not use advertising cookies or third-party tracking cookies.
            No action is required from you to accept essential cookies, as they are
            necessary for the Service to function.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            7. Product Analytics
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We record a small number of events to learn which parts of RaceTrace and
            Finding Grip help people, for example when the coffee page is opened, when hot
            pressures are recorded, when a share image is made, or when someone shares a
            link to the site. Each event says which
            site and feature it came from and may include short facts, such as how many
            corners came in on target. Events never include your name, email address,
            notes or anything you type, and they are not linked to your account. We
            don&apos;t use cookies or advertising identifiers for this, and we don&apos;t
            record your screen or keystrokes. If your browser sends Global Privacy Control
            or Do Not Track, we record nothing. We use PostHog to count these events and
            keep them for 12 months. A shared link carries a tag saying it came from a share,
            so we can count visits from shares; the tag is the same for everyone and never
            says who shared it. We also count each visit and where it came from: the tag on
            the link that was opened (for example one from our Instagram post or an email), or
            otherwise the name of the site that linked here, such as a search engine or social
            network, and the kind of page opened (home, a race, live timing). We never record
            the address of the page you came from, what you searched for, or which race you
            opened.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            8. Race Emails
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            Race emails are off until you turn them on in Settings › Preferences. When they are
            on, we email you when a race with one of the cars you follow is published on
            RaceTrace, and once more only if its official results change that car&apos;s finish
            or pit cycles. You can switch them off for the account or for one car. To send them
            we use your email address and your list of cars, and we keep a record of each email
            we sent (the race, the car, and the finish and pit-cycle facts it stated) so we
            never send the same one twice; that record is deleted with your account. Emails are
            delivered by Resend. Every email has a one-click link that turns them off without
            signing in.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            9. Your Rights
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            You have the right to: access your personal data; correct inaccurate data;
            request deletion of your account and associated data; export your data in a
            portable format; and opt out of non-essential communications. To exercise
            these rights, contact us at the email below.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            10. Changes to This Policy
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We may update this Privacy Policy from time to time. We will notify you of
            material changes by posting the updated policy on this page and updating the
            "Last updated" date. Continued use of the Service after changes constitutes
            acceptance of the updated policy.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            11. Contact
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            For privacy inquiries, please contact us at{" "}
            <a
              href="mailto:privacy@tedderengineering.com"
              className="text-brand-600 dark:text-brand-400 hover:underline"
            >
              privacy@tedderengineering.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
