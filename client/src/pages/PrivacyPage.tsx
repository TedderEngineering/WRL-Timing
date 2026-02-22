export function PrivacyPage() {
  return (
    <div className="container-page py-16 lg:py-24">
      <div className="max-w-3xl mx-auto prose dark:prose-invert prose-gray">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-10">
          Last updated: February 2026
        </p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            1. Information We Collect
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We collect the following categories of information: account information you
            provide (email, display name, password); usage data (pages visited, races
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
            Resend for transactional email delivery, and cloud infrastructure providers
            (AWS, Vercel/Railway) for hosting. These providers are bound by their own
            privacy policies and data processing agreements.
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
            7. Your Rights
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            You have the right to: access your personal data; correct inaccurate data;
            request deletion of your account and associated data; export your data in a
            portable format; and opt out of non-essential communications. To exercise
            these rights, contact us at the email below.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            8. Changes to This Policy
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            We may update this Privacy Policy from time to time. We will notify you of
            material changes by posting the updated policy on this page and updating the
            "Last updated" date. Continued use of the Service after changes constitutes
            acceptance of the updated policy.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            9. Contact
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
