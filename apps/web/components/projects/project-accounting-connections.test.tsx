import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {ProjectAccountingConnections} from './project-accounting-connections';
import {integrationsPageFixture} from '@/lib/workspace/integrations';
import {jsonRequest} from '@/lib/commercial/client';

vi.mock('@/lib/commercial/client',()=>({jsonRequest:vi.fn()}));
vi.mock('../workspace/integrations-page',()=>({IntegrationDialog:({item}:{item:{provider:string}|null})=>item?<div role="dialog">Setup {item.provider}</div>:null}));
beforeEach(()=>vi.mocked(jsonRequest).mockReset());
describe('Project accounting connections',()=>{
 it('shows available accounting providers and opens setup without creating a connection',async()=>{
  vi.mocked(jsonRequest).mockResolvedValue({...integrationsPageFixture,connections:[]});
  render(<ProjectAccountingConnections workspaceId="workspace-one"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Connect QuickBooks'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('Setup quickbooks');
  expect(screen.queryByText('Google Workspace')).not.toBeInTheDocument();
  expect(jsonRequest).toHaveBeenCalledTimes(1);
  expect(jsonRequest).toHaveBeenCalledWith('/api/workspace/accounting-setup?workspaceId=workspace-one');
 });
 it('does not offer unavailable providers or management to ordinary members',async()=>{
  const data=structuredClone(integrationsPageFixture);
  data.canManage=false;
  data.connections=[];
  data.providerCapabilities.providers=data.providerCapabilities.providers.map(p=>p.id==='quickbooks'?{...p,configurationState:'unavailable'}:p);
  vi.mocked(jsonRequest).mockResolvedValue(data);
  render(<ProjectAccountingConnections workspaceId="workspace-one"/>);
  expect(await screen.findByText('Zoho Books')).toBeInTheDocument();
  expect(screen.queryByText('QuickBooks')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Connect/})).not.toBeInTheDocument();
 });
 it('shows a retry on failure instead of inventing a connection status',async()=>{
  vi.mocked(jsonRequest).mockRejectedValueOnce(new Error('Connection status unavailable')).mockResolvedValueOnce({...integrationsPageFixture,connections:[]});
  render(<ProjectAccountingConnections workspaceId="workspace-one"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection status unavailable');
  expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry connections'}));
  expect(await screen.findByRole('button',{name:'Connect QuickBooks'})).toBeInTheDocument();
 });
});
