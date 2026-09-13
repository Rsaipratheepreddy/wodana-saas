import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateQuotationPlan } from './planning-provider';
beforeEach(()=>vi.stubGlobal('fetch',vi.fn()));
describe('quotation provider resilience',()=>{
  it('retries a timed-out analysis once and returns the complete response',async()=>{
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Timed out','TimeoutError')).mockResolvedValueOnce(new Response(JSON.stringify({candidates:['complete']})));
    expect(await generateQuotationPlan('https://provider.example','test-key','{}',2000)).toEqual({candidates:['complete']});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('recovers from a temporary upstream failure',async()=>{
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unavailable',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({ok:true})));
    expect(await generateQuotationPlan('https://provider.example','test-key','{}',2000)).toEqual({ok:true});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not repeat invalid requests or loop after a repeated outage',async()=>{
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Invalid',{status:400}));await expect(generateQuotationPlan('https://provider.example','test-key','{}',2000)).rejects.toThrow('Provider HTTP 400');expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockReset().mockRejectedValue(new DOMException('Timed out','TimeoutError'));await expect(generateQuotationPlan('https://provider.example','test-key','{}',2000)).rejects.toThrow('Timed out');expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not start a request after its overall deadline',async()=>{
    await expect(generateQuotationPlan('https://provider.example','test-key','{}',0)).rejects.toThrow('time budget exhausted');expect(fetch).not.toHaveBeenCalled();
  });
});
