import Link from "next/link";
import { ArrowRight, FolderKanban } from "lucide-react";
import { DEMO_PROJECT } from "@/lib/projects/demo";
import styles from "./project-demo-card.module.css";

export function ProjectDemoCard() {
  return <Link aria-label={`Open ${DEMO_PROJECT.title}`} className={styles.card} href={`${DEMO_PROJECT.root}/overview`}>
    <div className={styles.top}><span className={styles.icon}><FolderKanban aria-hidden="true" size={21} /></span><span className={styles.badge}>Demo project</span></div>
    <h2>{DEMO_PROJECT.title}</h2>
    <p className={styles.customer}>{DEMO_PROJECT.customer}</p>
    <dl className={styles.details}><div><dt>Project manager</dt><dd>Not assigned</dd></div><div><dt>Stage</dt><dd>Planning preview</dd></div></dl>
    <span className={styles.preview}>Open project <ArrowRight aria-hidden="true" data-directional="true" size={17} /></span>
  </Link>;
}
