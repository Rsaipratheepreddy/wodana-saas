import styles from "./ui.module.css";
import { identityInitials, identityStyle, identityVariant } from "@/lib/brand/identity";

const sizes = {
  sm: styles.avatarSm,
  md: styles.avatarMd,
  lg: styles.avatarLg,
};

export function Avatar({ label, name, size = "md" }: { label?: string; name: string; size?: keyof typeof sizes }) {
  const initials = label ?? identityInitials(name);
  return <span aria-label={name} className={`${styles.avatar} ${sizes[size]}`} data-identity-variant={identityVariant(name)} role="img" style={identityStyle(name)} title={name}>{initials}</span>;
}

export function AvatarGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return <div aria-label={label} className={styles.avatarGroup}>{children}</div>;
}
