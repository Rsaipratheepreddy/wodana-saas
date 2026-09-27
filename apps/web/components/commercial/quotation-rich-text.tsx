'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {EditorContent,useEditor,type Editor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type {QuoteRichTextNode} from '@/lib/commercial/types';
import {useT} from '@/lib/i18n/i18n-provider';

export function QuoteRichText({node}:{node:QuoteRichTextNode}):ReactNode {
 const children=node.content?.map((child,index)=><QuoteRichText key={index} node={child}/>);
 if(node.type==='text'){let text:ReactNode=node.text;for(const mark of node.marks??[]){if(mark.type==='bold')text=<strong>{text}</strong>;else if(mark.type==='italic')text=<em>{text}</em>;else if(mark.type==='underline')text=<u>{text}</u>;else if(mark.type==='strike')text=<s>{text}</s>;else if(mark.type==='code')text=<code>{text}</code>;}return text;}
 switch(node.type){case 'paragraph':return <p>{children?.length?children:<br/>}</p>;case 'heading':return node.attrs?.level===1?<h1>{children}</h1>:node.attrs?.level===2?<h2>{children}</h2>:<h3>{children}</h3>;case 'bulletList':return <ul>{children}</ul>;case 'orderedList':return <ol start={node.attrs?.start??1}>{children}</ol>;case 'listItem':return <li>{children}</li>;case 'blockquote':return <blockquote>{children}</blockquote>;case 'hardBreak':return <br/>;case 'horizontalRule':return <hr/>;case 'codeBlock':return <pre><code>{children}</code></pre>;default:return <>{children}</>;}
}
export function plainTextDocument(text:string):QuoteRichTextNode{return {type:'doc',content:text.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))};}
export function QuotationRichTextEditor({value,text,onChange,onReady}:{value?:QuoteRichTextNode;text:string;onChange:(richText:QuoteRichTextNode,text:string)=>void;onReady:(editor:Editor|null)=>void}){
 const t=useT();
 const latest=useRef(onChange);latest.current=onChange;
 const editor=useEditor({extensions:[StarterKit.configure({link:false,heading:{levels:[1,2,3]}})],immediatelyRender:false,shouldRerenderOnTransaction:true,content:value??plainTextDocument(text),editorProps:{attributes:{role:'textbox','aria-label':t('Edit page text'),'aria-multiline':'true'}},onUpdate:({editor})=>latest.current(editor.getJSON() as QuoteRichTextNode,editor.getText())});
 useEffect(()=>{onReady(editor);return()=>onReady(null);},[editor,onReady]);
 useEffect(()=>{if(editor&&!editor.isDestroyed&&JSON.stringify(editor.getJSON())!==JSON.stringify(value??plainTextDocument(text)))editor.commands.setContent(value??plainTextDocument(text),{emitUpdate:false});},[editor,value,text]);
 useEffect(()=>{editor?.commands.focus('end');},[editor]);
 return <EditorContent editor={editor}/>;
}
