export function TermsPage() {
  return (
    <div className="container-page py-16 lg:py-24">
      <div className="max-w-3xl mx-auto prose dark:prose-invert prose-gray">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-10">
          Last updated: February 2026
        </p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            1. Acceptance of Terms
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            By accessing or using the WRL Lap Chart service ("Service"), you agree to be
            bound by these Terms of Service ("Terms"). If you do not agree to these Terms,
            you may not use the Service. We reserve the right to update these Terms at any
            time. Continued use of the Service after changes constitutes acceptance of the
            updated Terms.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            2. Description of Service
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            WRL Lap Chart provides interactive race analysis tools including lap charts,
            position traces, and timing data visualization for World Racing League events.
            The Service is available via web application and may include free and paid
            subscription tiers with varying levels of access and features.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            3. User Accounts
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            You are responsible for maintaining the confidentiality of your account
            credentials and for all activities that occur under your account. You must
            provide accurate and complete information when creating an account. You agree
            to notify us immediately of any unauthorized use of your account.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            4. Subscription and Billing
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            Paid subscriptions are billed on a recurring basis (monthly or annually) at
            the rates displayed at the time of purchase. You may cancel your subscription
            at any time; access to paid features will continue through the end of the
            current billing period. Refunds are available within 14 days of initial
            purchase if you are unsatisfied with the Service.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            5. Acceptable Use
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            You agree not to misuse the Service. This includes, but is not limited to:
            attempting to gain unauthorized access to the Service or its related systems;
            using the Service for any unlawful purpose; systematically scraping data from
            the Service; interfering with the Service's infrastructure; or reselling access
            to the Service without authorization.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            6. Intellectual Property
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            All content, design, and technology comprising the Service are the property of
            WRL Lap Chart or its licensors. Race timing data is provided for informational
            purposes and may be subject to third-party licenses. You retain ownership of
            any content you create or upload.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            7. Limitation of Liability
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            The Service is provided "as is" without warranty of any kind. We are not
            liable for any indirect, incidental, or consequential damages arising from
            your use of the Service. Our total liability shall not exceed the amount you
            have paid for the Service in the 12 months preceding the claim.
          </p>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50 mt-10">
            8. Contact
          </h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            If you have questions about these Terms, please contact us at{" "}
            <a
              href="mailto:legal@wrllapchart.com"
              className="text-brand-600 dark:text-brand-400 hover:underline"
            >
              legal@wrllapchart.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
