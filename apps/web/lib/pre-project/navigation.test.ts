import {describe,it,expect} from 'vitest';
import {workspaceModules} from '@/components/workspace/workspace-navigation';
import {preProjectNavigation} from './navigation';
import {caseRoute,requirementViews} from './types';
const navigation=workspaceModules.find(module=>module.id==='pre-project')!.navigation;
const caseId='e56299c6-3da3-402a-a9ac-3995bb37b9d4';
describe('catalog navigation location',()=>{
 it.each(requirementViews.filter(({section})=>['requirements','inspiration'].includes(section)))('links $label to its own case section and preserves list context',({section,label})=>{
  const path=`/workspace/pre-projects/cases/${caseId}/${section}`;
  expect(caseRoute(path)).toEqual({id:caseId,section});
  const groups=preProjectNavigation(navigation,path,'search=Villa&page=2');
  expect(groups[0].label).toBe('Requirement gathering');
  expect(groups.flatMap(group=>group.items).find(item=>item.label===label)?.href).toBe(`${path}?search=Villa&page=2`);
 });
 it('keeps measurements and site layouts inside requirements while exposing the complete commercial path',()=>{const items=preProjectNavigation(navigation,`/workspace/pre-projects/cases/${caseId}/requirements`).flatMap(g=>g.items);expect(items.map(i=>i.label)).toEqual(['Requirements','Client inspirations','Design','Quotations','Agreement & payments','Change requests','Approvals & release','Client portal']);});
 it('shows catalogs beside the pre-execution list',()=>expect(preProjectNavigation(navigation,'/workspace/pre-projects').flatMap(g=>g.items).map(i=>i.id)).toEqual(['pre-projects','pre-project-catalogs','quotation-templates']));
 it('removes catalogs from a selected case while keeping case-relative sections',()=>{const items=preProjectNavigation(navigation,`/workspace/pre-projects/cases/${caseId}/requirements`).flatMap(g=>g.items);expect(items.some(i=>i.id==='pre-project-catalogs')).toBe(false);expect(items.every(i=>i.href.startsWith(`/workspace/pre-projects/cases/${caseId}/`))).toBe(true);});
});
