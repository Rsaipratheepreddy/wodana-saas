import Link from 'next/link';
import { GlobalFactoryQueue } from '@/components/projects/global-factory-queue';
import { ProjectFactoryBatches } from '@/components/projects/project-factory-batches';
import { getAuthenticatedProfile } from '@/lib/auth/server';
import { projectRead } from '@/lib/projects/server';
import type { WorkQueuePage } from '../../../../../../services/business-core/src/projects/project-work-queue';
import styles from '@/components/projects/global-supply-page.module.css';

const empty: WorkQueuePage = {memberId:'',rows:[],nextCursor:null};

export default async function FactoryPage({searchParams}:{searchParams:Promise<{view?:string}>}) {
  const {view}=await searchParams;
  const current=view==='batches'?'batches':view==='dispatch'?'dispatch':'jobs';
  const profile=await getAuthenticatedProfile();
  const workspaceId=profile.memberships[0]?.workspaceId??'';
  let page=empty, error='';
  if(current!=='batches') {
    try { page=(await projectRead<WorkQueuePage>(current==='dispatch'?'work-queue?view=open&kind=dispatch':'work-queue?view=open&kind=task&location=factory')).data; }
    catch { error='Factory work could not be loaded. Check your access and retry.'; }
  }
  return <section className={styles.page} aria-label="Factory">
    <nav className={styles.views} aria-label="Factory views">
      <Link href="/workspace/projects/factory" aria-current={current==='jobs'?'page':undefined}>Jobs</Link>
      <Link href="/workspace/projects/factory?view=dispatch" aria-current={current==='dispatch'?'page':undefined}>Dispatch</Link>
      <Link href="/workspace/projects/factory?view=batches" aria-current={current==='batches'?'page':undefined}>Batches</Link>
    </nav>
    {current==='batches'?<ProjectFactoryBatches workspaceId={workspaceId}/>:<GlobalFactoryQueue workspaceId={workspaceId} initial={page} initialError={error} kind={current==='dispatch'?'dispatch':'task'}/>}
  </section>;
}
