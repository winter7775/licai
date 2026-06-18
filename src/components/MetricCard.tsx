import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  children?: ReactNode;
}

export function MetricCard({ label, value, detail, tone = "neutral", children }: MetricCardProps) {
  return (
    <section className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
      {children}
    </section>
  );
}
