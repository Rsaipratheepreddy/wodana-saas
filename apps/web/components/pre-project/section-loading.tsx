import styles from './section-loading.module.css';

export function PreProjectSectionLoading() {
  return <section className={styles.loading} aria-label="Loading section" aria-busy="true">
    <p role="status">Opening section…</p>
    <div className={styles.toolbar} aria-hidden="true" />
    <div className={styles.rows} aria-hidden="true">{[0, 1, 2, 3, 4].map(row => <div key={row} />)}</div>
  </section>;
}
