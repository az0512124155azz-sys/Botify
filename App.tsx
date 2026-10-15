import React,{useEffect,useState,useRef} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,Alert,AppState,Linking} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
type Bot={id:string;name:string;username:string;type:'chat'|'alerts';noise:'loud'|'quiet'|'off';token:string};
type Msg={id:number;chat:number;text:string;who:string;callbackId?:string;buttons?:{text:string;callback_data?:string;url?:string}[][]};
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
const API='https://api.telegram.org/bot';
async function call<T>(token:string,method:string,body:object={}):Promise<T>{
 const r=await fetch(API+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const x=await r.json();if(!x.ok)throw Error(x.description||'Telegram API failed');return x.result as T;
}
const bg='#F5F8FA',ink='#21333D',accent='#087E89';
function Main(){
 const pollLock=useRef(false),offsetRef=useRef<Record<string,number>>({});const [webhookInfo,setWebhookInfo]=useState<Record<string,string>>({}),[mode,setMode]=useState<'all'|'chat'|'alerts'>('all'),[errors,setErrors]=useState<Record<string,string>>({}),[commands,setCommands]=useState<string[]>([]),[bots,setBots]=useState<Bot[]>([]),[ready,setReady]=useState(false),[token,setToken]=useState(''),[type,setType]=useState<'chat'|'alerts'>('chat'),[page,setPage]=useState<'home'|'add'|'detail'>('home'),[id,setId]=useState(''),[msgs,setMsgs]=useState<Record<string,Msg[]>>({}),[offset,setOffset]=useState<Record<string,number>>({}),[running,setRunning]=useState(false),[chat,setChat]=useState(''),[draft,setDraft]=useState(''),[active,setActive]=useState(true);
 const current=bots.find(b=>b.id===id);
 useEffect(()=>{void Notifications.requestPermissionsAsync();void Notifications.setNotificationChannelAsync('incidents',{name:'Incidents',importance:Notifications.AndroidImportance.MAX,sound:'default',vibrationPattern:[0,500,250,500]});void Notifications.setNotificationChannelAsync('quiet',{name:'Quiet bot updates',importance:Notifications.AndroidImportance.LOW,sound:null});const s=AppState.addEventListener('change',v=>setActive(v==='active'));return()=>s.remove()},[]);
 useEffect(()=>{(async()=>{try{const a=JSON.parse(await SecureStore.getItemAsync('bothub-list')||'[]');setBots((await Promise.all(a.map(async(b:Omit<Bot,'token'>)=>({...b,token:await SecureStore.getItemAsync('bothub-'+b.id)||''})))).filter((b:Bot)=>b.token));const saved=await SecureStore.getItemAsync('bothub-offsets');if(saved)offsetRef.current=JSON.parse(saved)}catch(e){Alert.alert('Storage error',String(e))}finally{setReady(true)}})()},[]);
 async function persist(next:Bot[]){for(const b of next)await SecureStore.setItemAsync('bothub-'+b.id,b.token);await SecureStore.setItemAsync('bothub-list',JSON.stringify(next.map(({token,...rest})=>rest)));setBots(next)}
 async function add(){try{if(!token.trim())return;const me=await call<{id:number;first_name:string;username?:string}>(token.trim(),'getMe');if(bots.some(b=>b.id===String(me.id)))return Alert.alert('Already added');await persist([...bots,{id:String(me.id),name:me.first_name,username:me.username||'',token:token.trim(),type,noise:'quiet'}]);setToken('');setPage('home')}catch(e){Alert.alert('Connection error',String(e))}}
 async function poll(){if(!active||pollLock.current)return;pollLock.current=true;setRunning(true);try{for(const b of bots){try{const u=await call<any[]>(b.token,'getUpdates',{offset:offsetRef.current[b.id],timeout:0,limit:50,allowed_updates:['message','callback_query','channel_post']});if(!u.length)continue;const nextOffset=Math.max(...u.map(x=>x.update_id))+1;offsetRef.current[b.id]=nextOffset;void SecureStore.setItemAsync('bothub-offsets',JSON.stringify(offsetRef.current));setOffset(o=>({...o,[b.id]:nextOffset}));setErrors(old=>({...old,[b.id]:''}));if(b.noise!=='off')await Notifications.scheduleNotificationAsync({content:{title:b.name,body:u.length+' new updates',sound:b.noise==='loud'?'default':undefined},trigger:null});setMsgs(old=>{const known=new Set((old[b.id]||[]).map(m=>m.id));const incoming:Msg[]=u.filter(x=>!known.has(x.update_id)).map(x=>{const m=x.message||x.channel_post||x.callback_query?.message;return{id:x.update_id,chat:m?.chat?.id||0,text:x.callback_query?.data||m?.text||m?.caption||'[Media]',who:x.callback_query?.from?.first_name||m?.from?.first_name||'Telegram',callbackId:x.callback_query?.id,buttons:m?.reply_markup?.inline_keyboard}});return{...old,[b.id]:[...(old[b.id]||[]),...incoming].slice(-100)}})}catch(e){setErrors(old=>({...old,[b.id]:String(e)}))}}}finally{pollLock.current=false;setRunning(false)}}
 useEffect(()=>{if(!ready||!active||!bots.length)return;const timer=setInterval(()=>{void poll()},8000);void poll();return()=>clearInterval(timer)},[ready,active,bots]);
 async function send(){if(!current||!draft.trim())return;try{const target=Number(chat);if(!Number.isSafeInteger(target))throw Error('Invalid numeric chat ID');await call(current.token,'sendMessage',{chat_id:target,text:draft});setDraft('');Alert.alert('Sent')}catch(e){Alert.alert('Send failed',String(e))}}
 async function inspectWebhook(){if(!current)return;try{const info=await call<{url:string;pending_update_count:number}>(current.token,'getWebhookInfo');setWebhookInfo(old=>({...old,[current.id]:info.url?'Active webhook: '+info.url:'No webhook. Pending updates: '+info.pending_update_count}))}catch(e){Alert.alert('Webhook check failed',String(e))}}
 async function loadCommands(){if(!current)return;try{const list=await call<{command:string;description:string}[]>(current.token,'getMyCommands');setCommands(list.map(x=>'/'+x.command))}catch(e){Alert.alert('Commands',String(e))}}
 async function remove(){if(!current)return;const newOffsets={...offsetRef.current};delete newOffsets[current.id];offsetRef.current=newOffsets;await SecureStore.setItemAsync('bothub-offsets',JSON.stringify(newOffsets));const next=bots.filter(b=>b.id!==current.id);await persist(next);await SecureStore.deleteItemAsync('bothub-'+current.id);setPage('home')}
 const button=(title:string,action:()=>void)=> <Pressable onPress={action} style={{padding:13,backgroundColor:accent,borderRadius:13,marginVertical:6}}><Text style={{color:'white',fontWeight:'700',textAlign:'center'}}>{title}</Text></Pressable>;
 const input=(value:string,change:(v:string)=>void,placeholder:string,secret=false)=><TextInput value={value} onChangeText={change} placeholder={placeholder} secureTextEntry={secret} autoCapitalize="none" style={{backgroundColor:'white',padding:14,borderRadius:12,marginVertical:8,color:ink}}/>;
 return <SafeAreaView style={{flex:1,backgroundColor:bg}}><ScrollView contentContainerStyle={{padding:22,paddingBottom:60}}>
 <Text style={{fontSize:28,fontWeight:'900',color:ink,marginBottom:12}} onPress={()=>setPage('home')}>‹ BotHub</Text>
 {!ready?<Text>Loading secure storage...</Text>:page==='home'?<>
 <Text style={{color:ink,marginBottom:16}}>Only bots. No groups, no noise.</Text>
 {button('Show: '+mode,()=>setMode(mode==='all'?'chat':mode==='chat'?'alerts':'all'))}
 {bots.filter(b=>mode==='all'||b.type===mode).map(b=><Pressable key={b.id} onPress={()=>{setId(b.id);setChat('');setPage('detail')}} style={{padding:18,backgroundColor:'white',borderRadius:15,marginVertical:6}}><Text style={{fontSize:18,fontWeight:'800',color:ink}}>{b.name}</Text><Text style={{color:'#667'}}>@{b.username} · {b.type} · {b.noise}</Text></Pressable>)}
 {button('+ Add bot',()=>setPage('add'))}</>:page==='add'?<>
 <Text style={{fontSize:21,fontWeight:'700'}}>Connect an owned bot</Text>
 {input(token,setToken,'BotFather token',true)}
 {button('Interactive bot',()=>setType('chat'))}{button('Alert-only bot',()=>setType('alerts'))}
 <Text>Selected: {type}. Tokens are stored in device secure storage.</Text>
 {button('Verify with Telegram and add',()=>{void add()})}</>:current?<>
 <Text style={{fontSize:23,fontWeight:'800'}}>{current.name}</Text><Text>@{current.username} · {current.type}</Text>
 {button('Refresh inbox',()=>{void poll()})}
 {button('Inspect webhook status',()=>{void inspectWebhook()})}
 {!!webhookInfo[id]&&<Text selectable style={{color:'#49636B',padding:6}}>{webhookInfo[id]}</Text>}
 {button('Open bot in Telegram',()=>{if(current.username)void Linking.openURL('https://t.me/'+encodeURIComponent(current.username))})}
 {button('Load slash commands',()=>{void loadCommands()})}
 {commands.map(cmd=><Pressable key={cmd} onPress={()=>setDraft(cmd+' ')} style={{padding:8}}><Text style={{color:accent}}>{cmd}</Text></Pressable>)}
 {!!errors[id]&&<Text style={{color:'#B53432'}}>Update error: {errors[id]}</Text>}
 {button('Notification preference: '+current.noise,()=>{const noise=current.noise==='loud'?'quiet':current.noise==='quiet'?'off':'loud';void persist(bots.map(b=>b.id===id?{...b,noise}:b))})}
 {(msgs[id]||[]).map(m=><Pressable key={m.id} onPress={()=>setChat(String(m.chat))} style={{backgroundColor:'white',padding:14,borderRadius:12,marginVertical:5}}><Text style={{fontWeight:'800'}}>{m.who} · chat {m.chat}</Text><Text>{m.text}</Text>{m.buttons?.map((row,index)=><View key={index} style={{flexDirection:'row',flexWrap:'wrap'}}>{row.map((b,j)=><Pressable key={j} style={{padding:9,backgroundColor:'#D5F3F1',borderRadius:9,margin:3}} onPress={()=>{if(b.url)void Linking.openURL(b.url);else Alert.alert('Inline button','Shown for inspection. To press as a Telegram user, open the bot in Telegram. Bot API does not let bot owners impersonate users.')}}><Text>{b.text}</Text></Pressable>)}</View>)}</Pressable>)}
 {current.type==='chat'?<>{input(chat,setChat,'Numeric chat ID')}{input(draft,setDraft,'Reply as bot')}{button('Send reply',()=>{void send()})}</>:<Text>Read-only alert feed</Text>}
 {button('Remove from device',()=>{Alert.alert('Remove bot?','The local token will be deleted',[{text:'Cancel'},{text:'Remove',onPress:()=>{void remove()}}])})}</>:null}
 <Text style={{color:'#76848B',fontSize:12,marginTop:24}}>Owner dashboard. A Telegram user-client requires TDLib login. Background push notifications are not supported in this build. Bot API polling conflicts with an existing webhook.</Text>
 </ScrollView></SafeAreaView>
}
export default function App(){return <SafeAreaProvider><Main/></SafeAreaProvider>}
