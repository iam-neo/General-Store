import { Icon, type IconName } from "@/components/ui/icon";

export function StatCard({
  label,
  amount,
  description,
  icon,
}: Readonly<{
  label: string;
  amount: string;
  description: string;
  icon: IconName;
}>) {
  return (
    <article className="stat-card">
      <div className="stat-card-heading">
        <span className="stat-card-label">{label}</span>
        <span aria-hidden="true" className="stat-card-icon"><Icon name={icon} size={18} /></span>
      </div>
      <p className="stat-card-amount">{amount}</p>
      <p className="stat-card-description">{description}</p>
    </article>
  );
}
