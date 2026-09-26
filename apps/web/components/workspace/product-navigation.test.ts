import { describe, expect, it } from 'vitest';
import { homeTabs, productNavigation, productNavigationActive, workspaceModules } from './workspace-navigation';

describe('product navigation route ownership', () => {
  const sections = productNavigation(workspaceModules);
  it.each([
    ['/workspace', '', 'home'],
    ['/workspace/crm/leads', '', 'sales'],
    ['/workspace/crm/conversations/thread-1', '', 'inbox'],
    ['/workspace/crm/customers/person-1', '', 'clients'],
    ['/workspace/crm/follow-ups', 'view=activity', 'home'],
    ['/workspace/crm/follow-ups', 'view=schedule', 'daily-follow-ups'],
    ['/workspace/crm/calendar', 'view=activity', 'daily-follow-ups'],
    ['/workspace/crm/follow-ups', '', 'sales'],
    ['/workspace/catalogs', 'view=materials', 'resources'],
    ['/workspace/pre-projects/catalogs', '', 'resources'],
    ['/workspace/pre-projects/cases/case-1/quotations', '', 'planning'],
    ['/workspace/projects/project-1', '', 'projects'],
    ['/workspace/projects/project-1/scope', '', 'projects'],
    ['/workspace/settings/client-portal', '', 'settings'],
    ['/workspace/integrations', '', 'integrations'],
    ['/workspace/gallery', '', 'gallery'],
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
    // Operations lists the rebuilt modules only: Purchasing so far.
    expect(sections.find(section => section.id === 'operations')?.items.map(item => [item.label, item.href])).toEqual([['Purchasing', '/workspace/purchasing']]);
    expect(sections.find(section => section.id === 'main')?.items.map(item => item.label)).toEqual(['Home', 'Calendar', 'Inbox']);
  });
  it('uses an authorized settings destination when company access is absent', () => {
    const settings = workspaceModules[0];
    const limited = [{ ...settings, navigation: [{ id: 'account', items: [{ id: 'security', label: 'Security', href: '/workspace/security', icon: 'security' as const }] }] }];
    expect(productNavigation(limited).flatMap(section => section.items).find(item => item.id === 'settings')?.href).toBe('/workspace/security');
  });
});

it('keeps Tasks and Approvals as Home tabs, and CRM-only Tasks on the follow-up list', () => {
  expect(homeTabs(workspaceModules).map(tab => [tab.label, tab.href])).toEqual([['Overview', '/workspace'], ['Tasks', '/workspace/tasks'], ['Approvals', '/workspace/approvals']]);
  const all = productNavigation(workspaceModules);
  for (const path of ['/workspace/tasks', '/workspace/approvals']) expect(productNavigationActive(path, new URLSearchParams(), all)).toBe('home');
  expect(homeTabs(workspaceModules.filter(module => module.id === 'crm')).find(tab => tab.id === 'tasks')?.href).toBe('/workspace/crm/follow-ups?view=activity');
  expect(productNavigationActive('/workspace/crm/follow-ups', new URLSearchParams('view=activity'), all)).toBe('home');
});
