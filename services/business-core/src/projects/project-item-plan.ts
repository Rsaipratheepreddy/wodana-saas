import type { ProjectWorkPackage, Task } from './execution.types';

type Plan = Pick<ProjectWorkPackage, 'supplyMethod' | 'siteWork' | 'workLocation' | 'deliveryRoute'>;

export function itemWorkLocations(supply: Plan['supplyMethod']): NonNullable<Plan['workLocation']>[] {
  return supply === 'make' ? ['factory', 'site', 'office'] : supply === 'subcontract' ? ['supplier', 'site', 'office'] : [];
}

/** Retain legacy route semantics until a planner explicitly reviews location. */
export function itemDeliveryRoute(plan: Plan): ProjectWorkPackage['deliveryRoute'] {
  if (!plan.supplyMethod || !plan.siteWork) return plan.deliveryRoute;
  if (plan.supplyMethod === 'buy' || plan.supplyMethod === 'client') return plan.siteWork === 'none' ? 'office' : 'site';
  const location = plan.workLocation ?? (plan.supplyMethod === 'make' ? 'factory' : 'supplier');
  if (location === 'site') return 'site';
  if (plan.siteWork !== 'none') return 'mixed';
  return location === 'supplier' ? 'vendor' : location;
}

export function itemTaskSuggestions(plan: Plan & { title: string }): { title: string; location: Task['location'] }[] {
  const steps: { title: string; location: Task['location'] }[] = [];
  if (plan.supplyMethod === 'make' || plan.supplyMethod === 'subcontract') {
    // A missing location needs review, not a guessed manufacturing operation.
    if (plan.workLocation === 'factory' || plan.workLocation === 'supplier') steps.push({title:`Fabricate ${plan.title}`,location:'factory'});
    if (plan.workLocation === 'site') steps.push({title:`Carry out ${plan.title}`,location:'site'});
    if (plan.workLocation === 'office') steps.push({title:`Prepare ${plan.title}`,location:'office'});
  } else if (plan.supplyMethod) {
    steps.push({title:`Receive and check ${plan.title}`,location:plan.siteWork === 'none' ? 'office' : 'site'});
  }
  const siteTitle = plan.siteWork === 'install' ? `Install ${plan.title}` : plan.siteWork === 'delivery' ? `Deliver ${plan.title}` : plan.siteWork === 'site_work' ? `Carry out ${plan.title}` : '';
  if (siteTitle && !steps.some(step => step.title === siteTitle)) steps.push({title:siteTitle,location:'site'});
  return steps;
}
