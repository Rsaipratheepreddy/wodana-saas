import { expect, it, vi } from 'vitest';
import Page from './page';
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/lib/projects/server', () => ({ getProject: async () => ({ data: { caseId: 'source-case' } }) }));
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
it('returns old project bookmarks to the original project screens', async () => {
  await expect(Page({params: Promise.resolve({projectId}), searchParams: Promise.resolve({})})).rejects.toThrow(`redirect:/workspace/projects/${projectId}/overview`);
  await expect(Page({params: Promise.resolve({projectId}), searchParams: Promise.resolve({tab: 'finance'})})).rejects.toThrow(`redirect:/workspace/projects/${projectId}/commercial`);
});
it('keeps the current quotation builder in the existing planning flow', async () => {
  await expect(Page({params: Promise.resolve({projectId}), searchParams: Promise.resolve({tab: 'planning', planningTab: 'quotations'})})).rejects.toThrow('redirect:/workspace/pre-projects/cases/source-case/quotations');
});
