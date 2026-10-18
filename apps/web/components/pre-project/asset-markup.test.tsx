import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssetMarkup } from './asset-markup';
import { caseRequest } from '@/lib/pre-project/content';

vi.mock('@/lib/pre-project/content', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/pre-project/content')>(),
  caseRequest: vi.fn(),
}));

describe('web photo drawing', () => {
  it('loads the original and saves a separate marked copy with normalized strokes', async () => {
    const saved = { id: 'marked', name: 'Living room marked.jpg', mimeType: 'image/jpeg', byteSize: 2048, hasPreview: true };
    vi.mocked(caseRequest)
      .mockResolvedValueOnce({ sourceAssetId: 'original', strokes: [] })
      .mockResolvedValueOnce(saved);
    const onSaved = vi.fn();
    render(<AssetMarkup workspaceId="workspace" caseId="case" asset={{ id: 'image', name: 'Living room.jpg', mimeType: 'image/jpeg', byteSize: 2048, hasPreview: true }} onClose={vi.fn()} onSaved={onSaved} />);
    const canvas = await screen.findByRole('img', { name: 'Drawing canvas' });
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    });
    const photo = screen.getByRole('img', { name: 'Living room.jpg' });
    Object.defineProperties(photo, { naturalWidth: { value: 1000, configurable: true }, naturalHeight: { value: 750, configurable: true } });
    fireEvent.load(photo);
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 30 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 90 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Save marked copy' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(vi.mocked(caseRequest).mock.calls[1]).toMatchObject(['workspace', 'case', 'assets/original/markup', 'POST', { strokes: [{ color: '#46705a', width: 0.004, points: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.9 }] }] }]);
  });
});

it('saves a marked CRM attachment through its own upload endpoint',async()=>{
 vi.mocked(caseRequest).mockClear();
 const context={drawImage:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};
 const getContext=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as any);
 const toBlob=vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['marked'],{type:'image/png'})));
 const saved={id:'copy',name:'Photo marked.png',mimeType:'image/png',byteSize:6,hasPreview:true};const uploadFile=vi.fn().mockResolvedValue(saved),onSaved=vi.fn();
 render(<AssetMarkup workspaceId="workspace" caseId="case" asset={{...saved,id:'crm-photo',name:'Photo.png'}} assetUrl={()=>'/api/crm/photo'} uploadFile={uploadFile} onClose={vi.fn()} onSaved={onSaved}/>);
 const photo=screen.getByRole('img',{name:'Photo.png'});expect(photo).toHaveAttribute('src','/api/crm/photo');
 Object.defineProperties(photo,{naturalWidth:{value:100,configurable:true},naturalHeight:{value:100,configurable:true}});fireEvent.load(photo);
 const canvas=screen.getByRole('img',{name:'Drawing canvas'});Object.assign(canvas,{setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})});
 fireEvent.pointerDown(canvas,{pointerId:1,clientX:30,clientY:40});fireEvent.pointerUp(canvas,{pointerId:1});
 fireEvent.click(screen.getByRole('button',{name:'Save marked copy'}));
 await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(saved));
 expect(uploadFile.mock.calls[0][0]).toMatchObject({name:'Photo marked.png',type:'image/png'});expect(caseRequest).not.toHaveBeenCalled();
 getContext.mockRestore();toBlob.mockRestore();
});
