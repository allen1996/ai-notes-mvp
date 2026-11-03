import type { ReactNode } from "react";

export function Empty(
  { icon, title, children }: {
    icon: ReactNode;
    title: string;
    children: ReactNode;
  },
) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
