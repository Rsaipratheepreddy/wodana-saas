import { describe, expect, it } from 'vitest';
import { productNavigation, productNavigationActive, workspaceModules } from './workspace-navigation';

describe('product navigation route ownership', () => {
  const sections = productNavigation(workspaceModules);
  it.each([
    ['/workspace', '', 'home'],
    ['/workspace/crm/leads', '', 'sales'],
    ['/workspace/crm/conversations/thread-1', '', 'inbox'],
    ['/workspace/crm/customers/person-1', '', 'clients'],
    ['/workspace/crm/follow-ups', 'view=activity', 'my-activity'],
    ['/workspace/crm/follow-ups', 'view=schedule', 'daily-follow-ups'],
    ['/workspace/crm/calendar', 'view=activity', 'daily-follow-ups'],
    ['/workspace/crm/follow-ups', '', 'sales'],
    ['/workspace/catalogs', 'view=materials', 'resources'],
    ['/workspace/pre-projects/catalogs', '', 'resources'],
    ['/workspace/pre-projects/cases/case-1/quotations', '', 'projects'],
    ['/workspace/projects/project-1', '', 'projects'],
    ['/workspace/projects/purchasing', '', 'purchasing'],
    ['/workspace/projects/inventory', '', 'inventory'],
    ['/workspace/projects/factory', '', 'factory'],
    ['/workspace/settings/client-portal', '', 'settings'],
    ['/workspace/integrations', '', 'integrations'],
  ])('assigns %s to one destination', (path, query, expected) => {
    expect(productNavigationActive(path, new URLSearchParams(query), sections)).toBe(expected);
  });
  it('does not expose destinations removed by server permission filtering', () => {
    const limited = workspaceModules.map(module => ({ ...module, navigation: module.navigation.map(group => ({ ...group, items: group.items.filter(item => ['company', 'leads'].includes(item.id)) })) }));
    expect(productNavigation(limited).flatMap(section => section.items).map(item => item.id)).toEqual(['home', 'sales', 'settings']);
    expect(productNavigation(limited).flatMap(section => section.items).find(item => item.id === 'sales')?.href).toBe('/workspace/crm/leads');
    expect(productNavigation(limited).flatMap(section => section.items).some(item => item.id === 'clients')).toBe(false);
  });
  it('shows one Clients entry and links directly to the shared Catalog', () => {
    const work = sections.find(section => section.id === 'work');
    const company = sections.find(section => section.id === 'utilities');
    expect(work?.items.filter(item => item.label === 'Clients')).toHaveLength(1);
    expect(work?.items.find(item => item.id === 'clients')?.href).toBe('/workspace/crm/customers');
    expect(company?.items.find(item => item.id === 'resources')).toMatchObject({label:'Catalog',href:'/workspace/catalogs'});
    expect(company?.items.find(item => item.id === 'resources')?.children).toBeUndefined();
    expect(sections.find(section => section.id === 'operations')?.items.map(item => item.label)).toEqual(['Purchasing','Inventory','Factory']);
    expect(sections.find(section => section.id === 'main')?.items.some(item => item.id === 'approvals')).toBe(true);
  });
  it('uses an authorized settings destination when company access is absent', () => {
    const settings = workspaceModules[0];
    const limited = [{ ...settings, navigation: [{ id: 'account', items: [{ id: 'security', label: 'Security', href: '/workspace/security', icon: 'security' as const }] }] }];
    expect(productNavigation(limited).flatMap(section => section.items).find(item => item.id === 'settings')?.href).toBe('/workspace/security');
  });
});

it('uses the shared Tasks entry when project work is authorized and preserves CRM-only routing',()=>{
 const all=productNavigation(workspaceModules);expect(all.flatMap(group=>group.items).find(item=>item.id==='my-activity')?.href).toBe('/workspace/tasks');expect(productNavigationActive('/workspace/tasks',new URLSearchParams(),all)).toBe('my-activity');
 const crmOnly=productNavigation(workspaceModules.filter(module=>module.id==='crm'));expect(crmOnly.flatMap(group=>group.items).find(item=>item.id==='my-activity')?.href).toBe('/workspace/crm/follow-ups?view=activity');
 const projectsOnly=productNavigation(workspaceModules.filter(module=>module.id==='projects'));expect(projectsOnly.flatMap(group=>group.items).filter(item=>item.id==='my-activity')).toHaveLength(1);
});
