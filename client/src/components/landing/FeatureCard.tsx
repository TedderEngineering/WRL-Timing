interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="group rounded-xl border border-gray-200 dark:border-gray-800 p-6 hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition-all duration-200">
      <div className="inline-flex items-center justify-center h-11 w-11 rounded-lg bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400 mb-4 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50 mb-2">
        {title}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
