"use client";
import {useId,useRef,useState} from 'react';
import {Button} from '@/design-system';
import s from './project-comment-composer.module.css';
type Member={id:string;name:string};
export function ProjectCommentComposer({value,mentions,members,busy,onChange,onSubmit}:{value:string;mentions:string[];members:Member[];busy:boolean;onChange:(text:string,ids:string[])=>void;onSubmit:()=>void}) {
 const input=useRef<HTMLTextAreaElement>(null), id=useId();
 const [query,setQuery]=useState<{start:number;end:number;text:string}|null>(null);
 const [active,setActive]=useState(0);
 const matches=query?members.filter(member=>member.name.toLowerCase().includes(query.text.toLowerCase())).slice(0,8):[];
 const scan=(text:string,caret:number)=>{const match=text.slice(0,caret).match(/(?:^|\s)@([^@\n]*)$/);const completed=match && members.some(member=>match[1].startsWith(`${member.name} `));setQuery(match && !completed?{start:caret-match[1].length-1,end:caret,text:match[1]}:null);setActive(0);};
 const retained=(text:string)=>mentions.filter(memberId=>{const member=members.find(item=>item.id===memberId);return member && text.includes(`@${member.name}`);});
 const choose=(member:Member)=>{if(!query)return;const text=value.slice(0,query.start)+`@${member.name} `+value.slice(query.end);const caret=query.start+member.name.length+2;onChange(text,[...new Set([...retained(text),member.id])]);setQuery(null);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(caret,caret);});};
 return <div className={s.composer}>
  <label htmlFor={id}>Comment</label>
  <div className={s.inputWrap}>
   <textarea ref={input} id={id} value={value} disabled={busy} rows={3} placeholder="Write a comment… type @ to mention someone" aria-autocomplete="list" aria-controls={query?`${id}-people`:undefined} aria-activedescendant={query&&matches[active]?`${id}-${active}`:undefined}
    onChange={event=>{const text=event.target.value;onChange(text,retained(text));scan(text,event.target.selectionStart);}}
    onClick={event=>scan(value,event.currentTarget.selectionStart)}
    onBlur={()=>setQuery(null)}
    onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(query){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setQuery(null);}else if(matches.length && ['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setActive(index=>(index+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length);}else if(event.key==='Enter' && matches[active]){event.preventDefault();choose(matches[active]);}}else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&value.trim()&&!busy){event.preventDefault();onSubmit();}}}/>
   {query && <div className={s.picker} id={`${id}-people`} role="listbox" aria-label="Mention a project member">{matches.length?matches.map((member,index)=><button type="button" role="option" aria-selected={active===index} id={`${id}-${index}`} key={member.id} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(member)}><span className={s.avatar}>{member.name.split(' ').map(word=>word[0]).slice(0,2).join('')}</span>{member.name}</button>):<span className={s.noResults}>No matching members</span>}</div>}
  </div>
  <div className={s.footer}><span>{mentions.length?`Mentioning ${mentions.map(memberId=>members.find(member=>member.id===memberId)?.name).filter(Boolean).join(', ')}`:'@ mention · Ctrl / ⌘ + Enter to post'}</span><Button size="compact" variant="primary" isDisabled={busy||!value.trim()} onPress={onSubmit}>{busy?'Posting…':'Add comment'}</Button></div>
 </div>;
}
