"use client";
import { useState } from 'react';
import { ArrowLeft, Globe2, Send } from 'lucide-react';
import { Avatar, Button, SearchInput } from '@/design-system';
import { ProviderMark } from '@/components/brand/provider-mark';
import { MessagingMark } from '@/components/brand/messaging-mark';
import s from './crm-inbox.module.css';
const people = [
  {id:'amira', name:'Amira Hassan', channel:'whatsapp', project:'Palm residence', text:'The oak finish looks lovely. Could you share the lighter option too?'},
  {id:'daniel', name:'Daniel Brooks', channel:'portal', project:'Studio renovation', text:'I’ve added my comments to the kitchen drawings.'},
  {id:'maya', name:'Maya Patel', channel:'whatsapp', project:'Marina apartment', text:'Thursday at 10 works for the site visit. Thank you!'},
  {id:'omar', name:'Omar Rahman', channel:'portal', project:'Office fit-out', text:'The revised layout is approved. What happens next?'},
];
export function SampleInbox({onClose}:{onClose:()=>void}) {
  const [selected,setSelected]=useState<string|null>('amira'), [channel,setChannel]=useState('all'), [search,setSearch]=useState('');
  const [drafts,setDrafts]=useState<Record<string,string>>({}),[replies,setReplies]=useState<Record<string,string[]>>({});
  const person=people.find(p=>p.id===selected);
  return <div className={s.inbox} data-selected={Boolean(person)}>
    <section className={s.threadList} aria-label="Sample conversations">
      <header className={s.listHeading}><h1>Inbox</h1><Button size="compact" variant="quiet" onPress={onClose}>Exit sample</Button></header>
      <div className={s.searchArea}><SearchInput label="Search sample conversations" placeholder="Search conversations" value={search} onChange={setSearch}/></div>
      <div className={s.channels} aria-label="Sample channels">{['all','whatsapp','portal'].map(c=><button key={c} aria-pressed={c===channel} onClick={()=>setChannel(c)}>{c==='whatsapp'?<span className={s.channelMark}><ProviderMark provider="whatsapp"/></span>:c==='portal'?<Globe2 size={15}/>:null}{c==='all'?'All':c==='portal'?'Client portal':'WhatsApp'}</button>)}</div>
      <div className={s.threadItems}>{people.filter(p=>(channel==='all'||p.channel===channel)&&p.name.toLowerCase().includes(search.toLowerCase())).map(p=><button className={s.threadItem} aria-pressed={p.id===selected} key={p.id} onClick={()=>setSelected(p.id)}><Avatar name={p.name} size="md"/><span className={s.threadCopy}><span className={s.threadTop}><strong>{p.name}</strong><small>{p.channel==='portal'?<Globe2 size={14}/>:<span className={s.channelMark}><ProviderMark provider="whatsapp"/></span>}</small></span><span className={s.preview}>{replies[p.id]?.at(-1)??p.text}</span></span></button>)}</div>
      <p className={s.composerNotice} style={{padding:'12px 18px'}}>Fictional people · sample chats</p>
    </section>
    {person?<section className={s.thread} aria-label="Sample message thread">
      <header className={s.threadHeading}><Button className={s.mobileBack} aria-label="Back to sample inbox" size="compact" onPress={()=>setSelected(null)}><ArrowLeft size={16}/></Button><Avatar name={person.name} size="md"/><div className={s.headingIdentity}><h2>{person.name}</h2><span>{person.project} · {person.channel==='portal'?'Client portal':'WhatsApp'}</span></div><MessagingMark size={30}/></header>
      <div className={s.messages} role="log" aria-label="Sample messages"><div className={s.dateDivider}><span>Sample conversation</span></div><article className={s.message} data-direction="outbound"><span className={s.messageAvatar}><Avatar name="You" size="sm"/></span><strong className={s.messageSender}>You</strong><p>Hi {person.name.split(' ')[0]}, the latest update is ready for your review.</p><footer>10:24</footer></article><article className={s.message}><span className={s.messageAvatar}><Avatar name={person.name} size="sm"/></span><strong className={s.messageSender}>{person.name}</strong><p>{person.text}</p><footer>10:26</footer></article>{(replies[person.id]??[]).map((text,i)=><article key={i} className={s.message} data-direction="outbound"><span className={s.messageAvatar}><Avatar name="You" size="sm"/></span><strong className={s.messageSender}>You</strong><p>{text}</p><footer>Sample only</footer></article>)}</div>
      <form className={s.composer} onSubmit={e=>{e.preventDefault();const text=drafts[person.id]?.trim();if(!text)return;setReplies(r=>({...r,[person.id]:[...(r[person.id]??[]),text]}));setDrafts(d=>({...d,[person.id]:''}));}}><div className={s.composerInput}><textarea aria-label="Sample message" placeholder="Write a sample reply…" value={drafts[person.id]??''} onChange={e=>setDrafts(d=>({...d,[person.id]:e.target.value}))}/><Button className={s.sendButton} type="submit" aria-label="Add sample reply" isDisabled={!drafts[person.id]?.trim()}><Send size={18}/></Button></div><p className={s.composerNotice}>Preview only. Replies stay here and are not delivered.</p></form>
    </section>:<div className={s.empty}><MessagingMark size={56}/><h2>Select a conversation</h2></div>}
  </div>;
}
