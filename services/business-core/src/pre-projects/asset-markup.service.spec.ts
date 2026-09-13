import {describe,it,expect} from 'vitest';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {markupSvg,SaveMarkupDto} from './asset-markup.service';
const valid={id:'00000000-0000-4000-8000-000000000001',strokes:[{color:'#694f7a',width:.004,points:[{x:.1,y:.2},{x:.8,y:.7}]}]};
describe('photo markup boundary',()=>{
 it('scales normalized marks to the original aspect ratio',()=>{const svg=markupSvg(valid.strokes,1000,500).toString();expect(svg).toContain('100,100 800,350');expect(svg).toContain('stroke-width="4"');});
 it('preserves taps as visible dots',()=>{expect(markupSvg([{...valid.strokes[0],points:[{x:.3,y:.4}]}],1000,500).toString()).toContain('<circle cx="300" cy="200" r="2"');});
 it.each([{color:'url(https://example.com)'},{width:100},{points:[{x:1.2,y:0}]},{points:[]}])('rejects unsafe/out-of-bounds stroke fields: %o',async patch=>{expect((await validate(plainToInstance(SaveMarkupDto,{...valid,strokes:[{...valid.strokes[0],...patch}]}))).length).toBeGreaterThan(0);});
 it('rejects an excessive aggregate even if each stroke fits its limit',()=>{expect(()=>markupSvg(Array.from({length:5},()=>({...valid.strokes[0],points:Array.from({length:1000},()=>({x:.5,y:.5}))})),1000,500)).toThrow('too many points');});
 it('accepts the contract used by both editors',async()=>{expect(await validate(plainToInstance(SaveMarkupDto,valid))).toHaveLength(0);});
});
