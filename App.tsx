import React,{useEffect,useState} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,Alert,AppState} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
type Bot={id:string;name:string;username:string;type:'chat'|'alerts';noise:'loud'|'quiet'|'off';token:string};
type Msg={id:number;chat:number;text:string;who:string};
const API='https://api.telegram.org/bot';
async function call<T>(token:string,method:string,body:object={}):Promise<T>{
 const r=await fetch(API+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const x=await r.json();if(!x.ok)throw Error(x.description||'Telegram API failed');return x.result as T;
}
const bg='#F5F8FA',ink='#21333D',accent='#087E89';
function Main(){
 const [bots,setBots]=useState<Bot[]>([]),[ready,setReady]=useState(false),[token,setToken]=useState(''),[type,setType]=useState<'chat'|'alerts'>('chat'),[page,setPage]=useState<'home'|'add'|'detail'>('home'),[id,setId]=useState(''),[msgs,setMsgs]=useState<Record<string,Msg[]>>({}),[offset,setOffset]=useState<Record<string,number>>({}),[running,setRunning]=useState(false),[chat,setChat]=useState(''),[draft,setDraft]=useState(''),[active,setActive]=useState(true);
 const current=bots.find(b=>b.id===id);
 useEffect(()=>{const s=AppState.addEventListener('change',v=>setActive(v==='active'));return()=>s.remove()},[]);
 useEffect(()=>{(async()=>{try{const a=JSON.parse(await SecureStore.getItemAsync('bothub-list')||'[]');setBots((await Promise.all(a.map(async(b:Omit<Bot,'token'>)=>({...b,token:await SecureStore.getItemAsync('bothub-'+b.id)||''})))).filter((b:Bot)=>b.token))}catch(e){Alert.alert('Storage error',String(e))}finally{setReady(true)}})()},[]);
 async function persist(next:Bot[]){for(const b of next)await SecureStore.setItemAsync('bothub-'+b.id,b.token);await SecureStore.setItemAsync('bothub-list',JSON.stringify(next.map(({token,...rest})=>rest)));setBots(next)}
 async function add(){try{if(!token.trim())return;const me=await call<{id:number;first_name:string;username?:string}>(token.trim(),'getMe');if(bots.some(b=>b.id===String(me.id)))return Alert.alert('Already added');await persist([...bots,{id:String(me.id),name:me.first_name,username:me.username||'',token:token.trim(),type,noise:'quiet'}]);setToken('');setPage('home')}catch(e){Alert.alert('Connection error',String(e))}}
 async function poll(){if(!active||running)return;setRunning(true);try{for(const b of bots){try{const u=await call<any[]>(b.token,'getUpdates',{offset:offset[b.id],timeout:0,limit:50,allowed_updates:['message','callback_query','channel_post']});if(!u.length)continue;setOffset(o=>({...o,[b.id]:Math.max(...u.map(x=>x.update_id))+1}));setMsgs(old=>{const known=new Set((old[b.id]||[]).map(m=>m.id));const incoming:Msg[]=u.filter(x=>!known.has(x.update_id)).map(x=>{const m=x.message||x.channel_post||x.callback_query?.message;return{id:x.update_id,chat:m?.chat?.id||0,text:x.callback_query?.data||m?.text||m?.caption||'[Media]',who:x.callback_query?.from?.first_name||m?.from?.first_name||'Telegram'}});return{...old,[b.id]:[...(old[b.id]||[]),...incoming].slice(-100)}})}catch(e){/* Existing bot webhooks/pollers may conflict. */}}}finally{setRunning(false)}}
 useEffect(()=>{if(!ready||!active||!bots.length)return;const timer=setInterval(()=>{void poll()},8000);return()=>clearInterval(timer)},[ready,active,bots,offset,running]);
 async function send(){if(!current||!draft.trim())return;try{const target=Number(chat);if(!Number.isSafeInteger(target))throw Error('Invalid numeric chat ID');await call(current.token,'sendMessage',{chat_id:target,text:draft});setDraft('');Alert.alert('Sent')}catch(e){Alert.alert('Send failed',String(e))}}
 async function remove(){if(!current)return;const next=bots.filter(b=>b.id!==current.id);await persist(next);await SecureStore.deleteItemAsync('bothub-'+current.id);setPage('home')}
 const button=(title:string,action:()=>void)=> <Pressable onPress={action} style={{padding:13,backgroundColor:accent,borderRadius:13,marginVertical:6}}><Text style={{color:'white',fontWeight:'700',textAlign:'center'}}>{title}</Text></Pressable>;
 const input=(value:string,change:(v:string)=>void,placeholder:string,secret=false)=><TextInput value={value} onChangeText={change} placeholder={placeholder} secureTextEntry={secret} autoCapitalize="none" style={{backgroundColor:'white',padding:14,borderRadius:12,marginVertical:8,color:ink}}/>;
 return <SafeAreaView style={{flex:1,backgroundColor:bg}}><ScrollView contentContainerStyle={{padding:22,paddingBottom:60}}>
 <Text style={{fontSize:28,fontWeight:'900',color:ink,marginBottom:12}} onPress={()=>setPage('home')}>‹ BotHub</Text>
 {!ready?<Text>Loading secure storage...</Text>:page==='home'?<>
 <Text style={{color:ink,marginBottom:16}}>Only bots. No groups, no noise.</Text>
 {bots.map(b=><Pressable key={b.id} onPress={()=>{setId(b.id);setChat('');setPage('detail')}} style={{padding:18,backgroundColor:'white',borderRadius:15,marginVertical:6}}><Text style={{fontSize:18,fontWeight:'800',color:ink}}>{b.name}</Text><Text style={{color:'#667'}}>@{b.username} · {b.type} · {b.noise}</Text></Pressable>)}
 {button('+ Add bot',()=>setPage('add'))}</>:page==='add'?<>
 <Text style={{fontSize:21,fontWeight:'700'}}>Connect an owned bot</Text>
 {input(token,setToken,'BotFather token',true)}
 {button('Interactive bot',()=>setType('chat'))}{button('Alert-only bot',()=>setType('alerts'))}
 <Text>Selected: {type}. Tokens are stored in device secure storage.</Text>
 {button('Verify with Telegram and add',()=>{void add()})}</>:current?<>
 <Text style={{fontSize:23,fontWeight:'800'}}>{current.name}</Text><Text>@{current.username} · {current.type}</Text>
 {button('Refresh inbox',()=>{void poll()})}
 {button('Notification preference: '+current.noise,()=>{const noise=current.noise==='loud'?'quiet':current.noise==='quiet'?'off':'loud';void persist(bots.map(b=>b.id===id?{...b,noise}:b))})}
 {(msgs[id]||[]).map(m=><Pressable key={m.id} onPress={()=>setChat(String(m.chat))} style={{backgroundColor:'white',padding:14,borderRadius:12,marginVertical:5}}><Text style={{fontWeight:'800'}}>{m.who} · chat {m.chat}</Text><Text>{m.text}</Text></Pressable>)}
 {current.type==='chat'?<>{input(chat,setChat,'Numeric chat ID')}{input(draft,setDraft,'Reply as bot')}{button('Send reply',()=>{void send()})}</>:<Text>Read-only alert feed</Text>}
 {button('Remove from device',()=>{Alert.alert('Remove bot?','The local token will be deleted',[{text:'Cancel'},{text:'Remove',onPress:()=>{void remove()}}])})}</>:null}
 <Text style={{color:'#76848B',fontSize:12,marginTop:24}}>Owner dashboard. A Telegram user-client requires TDLib login. Background push notifications are not supported in this build. Bot API polling conflicts with an existing webhook.</Text>
 </ScrollView></SafeAreaView>
}
export default function App(){return <SafeAreaProvider><Main/></SafeAreaProvider>}
