import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {AssetFiles,AssetUpload} from './case-controls';
import {caseRequest} from '@/lib/pre-project/content';
vi.mock('@/lib/pre-project/content',async importOriginal=>({...await importOriginal<typeof import('@/lib/pre-project/content')>(),caseRequest:vi.fn()}));
describe('multiple record attachments',()=>{
 it('uploads each selected file and preserves earlier attachments',async()=>{
  const saved=vi.fn();const error=vi.fn();vi.mocked(caseRequest).mockResolvedValueOnce({id:'one',name:'one.png'}).mockResolvedValueOnce({id:'two',name:'two.png'});
  render(<AssetUpload workspaceId="w" caseId="c" currentCount={3} onUploaded={saved} onError={error}/>);
  expect(screen.getByText(/3 of 20 attached/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach reference files'),{target:{files:[new File(['one'],'one.png',{type:'image/png'}),new File(['two'],'two.png',{type:'image/png'})]}});
  await waitFor(()=>expect(saved).toHaveBeenCalledTimes(2));expect(saved.mock.calls.map(([asset])=>asset.id)).toEqual(['one','two']);
 });
 it('rejects the whole selection when it exceeds remaining capacity',async()=>{
  const saved=vi.fn();const error=vi.fn();render(<AssetUpload workspaceId="w" caseId="c" currentCount={19} onUploaded={saved} onError={error}/>);
  fireEvent.change(screen.getByLabelText('Attach reference files'),{target:{files:[new File(['one'],'one.png'),new File(['two'],'two.png')]}});
  expect(error).toHaveBeenCalledWith('You can add 1 more files to this record.');expect(saved).not.toHaveBeenCalled();
 });
 it('keeps successfully uploaded files if a later upload fails',async()=>{
  const saved=vi.fn();const error=vi.fn();vi.mocked(caseRequest).mockResolvedValueOnce({id:'one'}).mockRejectedValueOnce(new Error('Connection interrupted'));
  render(<AssetUpload workspaceId="w" caseId="c" onUploaded={saved} onError={error}/>);
  fireEvent.change(screen.getByLabelText('Attach reference files'),{target:{files:[new File(['one'],'one.png'),new File(['two'],'two.png')]}});
  await waitFor(()=>expect(error).toHaveBeenCalledWith('Connection interrupted'));expect(saved).toHaveBeenCalledTimes(1);
 });
});
describe('web photo drawing',()=>{
 it('offers the same draw action for editable image attachments, not PDFs or read-only files',()=>{
  const images=[{id:'image',name:'Living room.jpg',mimeType:'image/jpeg',byteSize:2048,hasPreview:true},{id:'pdf',name:'Plan.pdf',mimeType:'application/pdf',byteSize:2048,hasPreview:false}];
  const {rerender}=render(<AssetFiles workspaceId="w" caseId="c" assets={images} onMarked={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Draw on Living room.jpg'})).toHaveTextContent('Draw');
  expect(screen.queryByRole('button',{name:'Draw on Plan.pdf'})).not.toBeInTheDocument();
  rerender(<AssetFiles workspaceId="w" caseId="c" assets={images}/>);
  expect(screen.queryByRole('button',{name:'Draw on Living room.jpg'})).not.toBeInTheDocument();
 });
});
