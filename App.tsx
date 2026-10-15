import React, {useEffect, useRef, useState} from 'react';
import {Alert, AppState, Image, Linking, Platform, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {nativeTdlib, NativeTdlib} from './modules/bothub-tdlib';
import {authRequest, BotStore, botLink, BotChat, mediaFile, messageText, Preference, Td, TdRequests, TelegramError, localFilePath, documentContent} from './src/telegram/tdlib';

Notifications.setNotificationHandler({handleNotification: async notification => ({
  shouldShowBanner: true, shouldShowList: true, shouldSetBadge: false,
  shouldPlaySound: notification.request.content.data.noise === 'loud',
})});
const colors = {background:'#F5F8FA', ink:'#20343E', accent:'#087E89', muted:'#647B85'};
const defaults: Preference = {category:'chat', noise:'quiet'};
const labels: Record<string, string> = {
  authorizationStateWaitPhoneNumber: 'Phone number with country code',
  authorizationStateWaitCode: 'Code sent by Telegram',
  authorizationStateWaitPassword: 'Two-step verification password',
  authorizationStateWaitEmailAddress: 'Email address requested by Telegram',
  authorizationStateWaitEmailCode: 'Email verification code',
};
function base64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let out='';
  for(let i=0;i<bytes.length;i+=3) {const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);out+=alphabet[n>>>18]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');} return out;
}
function Main() {
  const [apiId,setApiId]=useState(''),[apiHash,setApiHash]=useState(''),[credential,setCredential]=useState('');
  const [auth,setAuth]=useState(''),[status,setStatus]=useState('Sign in with your Telegram account'),[busy,setBusy]=useState(false),[started,setStarted]=useState(false);
  const [bots,setBots]=useState<BotChat[]>([]),[selected,setSelected]=useState<BotChat>(),[messages,setMessages]=useState<Td[]>([]),[draft,setDraft]=useState(''),[link,setLink]=useState('');
  const [filter,setFilter]=useState<'all'|'chat'|'alerts'>('all'),[preferences,setPreferences]=useState<Record<string,Preference>>({}),[commands,setCommands]=useState<Td[]>([]),[files,setFiles]=useState<Record<number,Td>>({});
  const store=useRef(new BotStore()),requests=useRef<TdRequests|null>(null),native=useRef<NativeTdlib|null>(null),current=useRef<BotChat|undefined>(undefined),prefs=useRef(preferences),ready=useRef(false),mounted=useRef(true),notified=useRef(new Set<string>()),commandGeneration=useRef(0),moreBusy=useRef(false),scroller=useRef<ScrollView>(null);
  const autoScroll=useRef(true);
  const notificationSub=useRef<{remove():void}|undefined>(undefined);
  const error=(e: unknown)=>{ if(mounted.current) {setStatus(e instanceof Error?e.message:String(e)); Alert.alert('BotHub',e instanceof Error?e.message:String(e));} };
  function refresh() {setBots(store.current.getBots());setMessages(current.current?store.current.getMessages(current.current.id):[]);}
  const diagnosticBusy=useRef(false);
  async function diagnostic() {
    if(started||requests.current||diagnosticBusy.current)return;
    diagnosticBusy.current=true;
    let transport:TdRequests|undefined,module:NativeTdlib|undefined;
    try {
      module=nativeTdlib();
      transport=new TdRequests({send:json=>module!.send(json),subscribe:listener=>{const sub=module!.addListener('onUpdate',event=>listener(event.json));return()=>sub.remove();}});
      await module.start();
      const auth=await transport.request('getAuthorizationState');
      const version=await transport.request('getOption',{name:'version'});
      if(auth['@type']!=='authorizationStateWaitTdlibParameters'||version['@type']!=='optionValueString')throw Error('Unexpected TDLib smoke response');
      const closed=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('TDLib close timed out')),10000);transport!.onUpdate(u=>{if(u.authorization_state?.['@type']==='authorizationStateClosed'){clearTimeout(timeout);resolve();}});});
      await Promise.all([transport.request('close'),closed]);
      setStatus('TDLib native smoke passed: '+version.value);
    } catch(e){error(e)}finally{transport?.dispose();try{await module?.close()}catch(e){error(e)}diagnosticBusy.current=false;}
  }
  useEffect(()=>{
    const listener=Linking.addEventListener('url',({url})=>{if(url==='bothub://diagnostics')void diagnostic();});
    void Linking.getInitialURL().then(url=>{if(url==='bothub://diagnostics')void diagnostic();}).catch(error);
    return()=>listener.remove();
  },[]);
  useEffect(()=>{
    mounted.current=true;
    notificationSub.current=Notifications.addNotificationResponseReceivedListener(response=>{const chatId=Number(response.notification.request.content.data.chatId);const chat=store.current.getBots().find(c=>c.id===chatId);if(chat)void select(chat);});
    void (async()=>{try {const saved=await SecureStore.getItemAsync('bothub-telegram-app');if(saved){const value=JSON.parse(saved);setApiId(String(value.id));setApiHash(value.hash);}const p=JSON.parse(await SecureStore.getItemAsync('bothub-preferences')||'{}');prefs.current=p;setPreferences(p);}catch(e){error(e)}})();
    return ()=>{mounted.current=false;requests.current?.dispose();void native.current?.close().catch(()=>{});notificationSub.current?.remove();};
  },[]);
  async function request(type: string,args:Record<string,unknown>={}) {if(!requests.current)throw Error('Connect Telegram first');return requests.current.request(type,args);}
  async function configureNotifications() {
    await Notifications.requestPermissionsAsync();
    if(Platform.OS==='android') {
      await Notifications.setNotificationChannelAsync('bothub-loud',{name:'Bot alarms',importance:Notifications.AndroidImportance.HIGH,sound:'default',vibrationPattern:[0,500,250,500]});
      await Notifications.setNotificationChannelAsync('bothub-quiet',{name:'Silent bot updates',importance:Notifications.AndroidImportance.LOW,sound:null});
    }
  }
  async function loadChats() {
    for(const kind of ['chatListMain','chatListArchive']) {
      while(ready.current) {
        try {await request('loadChats',{chat_list:{'@type':kind},limit:100});}
        catch(e) {if(e instanceof TelegramError&&e.code===404)break;throw e;}
      }
    }
  }
  async function connect() {
    if(started||busy||diagnosticBusy.current)return;
    const id=Number(apiId);if(!Number.isInteger(id)||id<=0||!/^[a-fA-F0-9]{32}$/.test(apiHash.trim()))return error(Error('Enter a valid Telegram API ID and 32-character API hash'));
    setBusy(true);setStatus('Starting native TDLib…');
    try {
      const module=nativeTdlib();native.current=module;
      const transport=new TdRequests({send:json=>module.send(json),subscribe:callback=>{const sub=module.addListener('onUpdate',event=>callback(event.json));return()=>sub.remove();}});
      requests.current=transport;
      let paths:{database:string;files:string}; let initialized=false;
      let key=await SecureStore.getItemAsync('bothub-database-key');
      if(!key){key=base64(await Crypto.getRandomBytesAsync(32));await SecureStore.setItemAsync('bothub-database-key',key,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});}
      const databaseKey=key;
      async function authorization(state: Td) {
        if(!mounted.current)return;
        const kind=state['@type'];setAuth(kind);setStatus(labels[kind]||kind.replace('authorizationState',''));setCredential('');
        if(kind==='authorizationStateWaitTdlibParameters'&&!initialized) {
          initialized=true;
          await transport.request('setTdlibParameters',{database_directory:paths.database,files_directory:paths.files,database_encryption_key:databaseKey,use_file_database:true,use_chat_info_database:true,use_message_database:true,use_secret_chats:false,api_id:id,api_hash:apiHash.trim(),system_language_code:'en',device_model:Platform.OS,system_version:String(Platform.Version),application_version:'0.4.0'});
        } else if(kind==='authorizationStateReady'&&!ready.current) {
          ready.current=true;setStatus('Connected to Telegram');
          await SecureStore.setItemAsync('bothub-telegram-app',JSON.stringify({id,hash:apiHash.trim()}));
          void configureNotifications().catch(error);void loadChats().catch(error);
        } else if(kind==='authorizationStateWaitOtherDeviceConfirmation') {
          setStatus('Confirm sign-in on your other Telegram device');
          Alert.alert('Confirm Telegram sign-in',state.link,[{text:'Close'},{text:'Open link',onPress:()=>{void safeURL(state.link);}}]);
        } else if(kind==='authorizationStateWaitRegistration')setStatus('This phone number needs a Telegram account. Create it in Telegram, then reconnect.');
        else if(kind==='authorizationStateWaitPremiumPurchase')setStatus('Telegram requires a Premium purchase for this sign-in. Complete it in the official Telegram app.');
        else if(kind==='authorizationStateClosed') {
          ready.current=false;transport.dispose();await module.close();requests.current=null;setStarted(false);store.current.clear();refresh();current.current=undefined;setSelected(undefined);
        }
      }
      transport.onUpdate(update=>{
        if(!mounted.current)return;
        if(update['@type']==='updateAuthorizationState') {void authorization(update.authorization_state).catch(error);return;}
        store.current.ingest(update);
        if(update['@type']==='updateNewChat') {
          const chat=update.chat;if(chat.type['@type']==='chatTypePrivate'&&!store.current.getUser(chat.type.user_id)) void request('getUser',{user_id:chat.type.user_id}).then(user=>{store.current.ingest(user);refresh();}).catch(error);
        }
        if(update['@type']==='updateFile')setFiles(old=>({...old,[update.file.id]:update.file}));
        if(update['@type']==='updateConnectionState')setStatus(update.state['@type']==='connectionStateReady'?'Connected to Telegram':'Telegram: '+update.state['@type'].replace('connectionState',''));
        if(update['@type']==='updateNewMessage'&&ready.current) {
          const message=update.message,chatId=message.chat_id,notificationId=`${chatId}:${message.id}`;
          const pref=prefs.current[chatId]||defaults;
          if(!message.is_outgoing&&store.current.isBot(chatId)&&pref.noise!=='off'&&!notified.current.has(notificationId)) {
            notified.current.add(notificationId);if(notified.current.size>1000)notified.current.delete(notified.current.values().next().value!);
            if(current.current?.id!==chatId||AppState.currentState!=='active')void Notifications.scheduleNotificationAsync({content:{title:store.current.getBots().find(c=>c.id===chatId)?.title||'BotHub',body:messageText(message),sound:pref.noise==='loud'?'default':undefined,data:{chatId,noise:pref.noise}},trigger:Platform.OS==='android'?{channelId:`bothub-${pref.noise}`} :null}).catch(error);
          }
          if(current.current?.id===chatId&&!message.is_outgoing) void request('viewMessages',{chat_id:chatId,message_ids:[message.id],force_read:true}).catch(error);
        }
        refresh();
      });
      paths=await module.start();setStarted(true);
      const state=await transport.request('getAuthorizationState');await authorization(state);
    } catch(e) {requests.current?.dispose();requests.current=null;try{await native.current?.close()}catch(closeError){error(closeError)}setStarted(false);error(e);} finally {setBusy(false);}
  }
  async function login() {setBusy(true);try {const [method,args]=authRequest(auth,credential);await request(method,args);setCredential('');}catch(e){error(e)}finally{setBusy(false)}}
  async function select(chat:BotChat) {
    const previous=current.current;if(previous&&previous.id!==chat.id)void request('closeChat',{chat_id:previous.id}).catch(error);
    autoScroll.current=true;current.current=chat;setSelected(chat);setDraft('');setCommands([]);setMessages(store.current.getMessages(chat.id));
    const generation=++commandGeneration.current;
    try {await request('openChat',{chat_id:chat.id});await history(chat);const full=await request('getUserFullInfo',{user_id:chat.userId});if(commandGeneration.current===generation)setCommands(full.bot_info?.commands||[]);}catch(e){error(e)}
  }
  async function history(chat:BotChat,older=false) {
    if(moreBusy.current)return;if(older)autoScroll.current=false;moreBusy.current=true;
    try {const oldest=older?store.current.getMessages(chat.id)[0]?.id||0:0,revision=store.current.revision(chat.id);
      const result=await request('getChatHistory',{chat_id:chat.id,from_message_id:oldest,offset:0,limit:50,only_local:false});
      if(!store.current.mergeHistory(chat.id,result.messages,revision)) {setStatus('Conversation updated. Refresh to load history.');return;}
      refresh();const ids=result.messages.filter(Boolean).map((m:Td)=>m.id);if(ids.length&&current.current?.id===chat.id)await request('viewMessages',{chat_id:chat.id,message_ids:ids,force_read:true});
    }finally{moreBusy.current=false;}
  }
  async function send(text=draft) {
    const chat=current.current;if(!chat||!text.trim()||(prefs.current[chat.id]||defaults).category==='alerts')return;
    setBusy(true);try {const message=await request('sendMessage',{chat_id:chat.id,input_message_content:{'@type':'inputMessageText',text:{'@type':'formattedText',text}}});store.current.ingest(message);if(current.current?.id===chat.id)setDraft(value=>value===text?'':value);refresh();}catch(e){error(e)}finally{setBusy(false)}
  }
  async function attach() {
    const chat=current.current;if(!chat||busy||(prefs.current[chat.id]||defaults).category==='alerts')return;
    setBusy(true);
    try {
      const picked=await DocumentPicker.getDocumentAsync({copyToCacheDirectory:true,multiple:false});
      if(picked.canceled||!picked.assets?.[0])return;
      const caption=draft,path=localFilePath(picked.assets[0].uri);
      const message=await request('sendMessage',{chat_id:chat.id,input_message_content:documentContent(path,caption)});
      store.current.ingest(message);if(current.current?.id===chat.id)setDraft(value=>value===caption?'':value);refresh();
    }catch(e){error(e)}finally{setBusy(false)}
  }
  async function safeURL(url:string) {try{const scheme=new URL(url).protocol;if(!['https:','http:','tg:'].includes(scheme))throw Error('Unsupported link');await Linking.openURL(url);}catch(e){error(e)}}
  async function inline(message:Td,button:Td) {
    try {const type=button.type;
      if(type['@type']==='inlineKeyboardButtonTypeUrl')return void safeURL(type.url);
      if(type['@type']==='inlineKeyboardButtonTypeCallback'||type['@type']==='inlineKeyboardButtonTypeCallbackWithPassword') {
        if(type['@type'].endsWith('WithPassword'))return error(Error('This action requires password confirmation and is not supported yet'));
        const answer=await request('getCallbackQueryAnswer',{chat_id:message.chat_id,message_id:message.id,payload:{'@type':'callbackQueryPayloadData',data:type.data}});if(answer.text)Alert.alert('Bot',answer.text);if(answer.url)void safeURL(answer.url);
      } else if(type['@type']==='inlineKeyboardButtonTypeSwitchInline')error(Error('Inline query mode is not supported yet'));
      else error(Error('This button type is not supported yet: '+type['@type']));
    }catch(e){error(e)}
  }
  async function openMedia(message:Td) {
    try {let file=mediaFile(message);if(!file)return;file=files[file.id]||file;if(!file?.local?.is_downloading_completed)file=await request('downloadFile',{file_id:file!.id,priority:16,offset:0,limit:0,synchronous:false});setFiles(old=>({...old,[file!.id]:file!}));if(file!.local?.is_downloading_completed&&file!.local.path)await Sharing.shareAsync('file://'+file!.local.path);else setStatus('Downloading file. Tap again when the download finishes.');}catch(e){error(e)}
  }
  async function preference(change:Partial<Preference>) {
    if(!selected)return;const next={...prefs.current,[selected.id]:{...(prefs.current[selected.id]||defaults),...change}};
    try {await SecureStore.setItemAsync('bothub-preferences',JSON.stringify(next));prefs.current=next;setPreferences(next);}catch(e){error(e)}
  }
  async function addBot() {
    try {const parsed=botLink(link),chat=await request('searchPublicChat',{username:parsed.username});if(chat.type['@type']!=='chatTypePrivate')throw Error('This link is not a bot');
      const user=await request('getUser',{user_id:chat.type.user_id});if(user.type['@type']!=='userTypeBot')throw Error('This Telegram account is not a bot');store.current.ingest(user);store.current.ingest(chat);refresh();setLink('');await select(store.current.getBots().find(b=>b.id===chat.id)!);
      if(parsed.parameter)await request('sendBotStartMessage',{bot_user_id:user.id,chat_id:chat.id,parameter:parsed.parameter});
    }catch(e){error(e)}
  }
  const button=(title:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{backgroundColor:disabled?'#9DB1B7':colors.accent,padding:12,borderRadius:12,marginVertical:5}}><Text style={{color:'white',fontWeight:'700',textAlign:'center'}}>{title}</Text></Pressable>;
  const input=(value:string,onChangeText:(v:string)=>void,placeholder:string,secure=false)=><TextInput accessibilityLabel={placeholder} value={value} onChangeText={onChangeText} placeholder={placeholder} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} style={{backgroundColor:'white',padding:14,borderRadius:12,marginVertical:6,color:colors.ink}}/>;
  const pref=selected?(preferences[selected.id]||defaults):defaults;
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}><ScrollView contentContainerStyle={{padding:22,paddingBottom:40}} keyboardShouldPersistTaps="handled">
    <Text style={{fontSize:30,fontWeight:'800',color:colors.ink}}>BotHub</Text><Text style={{color:colors.muted,marginVertical:8}}>{status}</Text>
    {!started?<>{input(apiId,setApiId,'Telegram API ID')}{input(apiHash,setApiHash,'Telegram API hash',true)}{button('Connect Telegram',()=>{void connect()},busy)}<Text style={{color:colors.muted}}>Use your application credentials from my.telegram.org. Your account connects directly to Telegram.</Text></>:auth!=='authorizationStateReady'?<>
      {labels[auth]&&<>{input(credential,setCredential,labels[auth],auth==='authorizationStateWaitPassword')}{button('Continue',()=>{void login()},busy)}</>}
      {['authorizationStateWaitCode','authorizationStateWaitEmailCode'].includes(auth)&&button('Resend code',()=>{void request('resendAuthenticationCode').catch(error)},busy)}
      {button('Close connection',()=>{void request('close').catch(error)},busy)}
    </>:<>
      {selected?<>
        {button('‹ All bots',()=>{void request('closeChat',{chat_id:selected.id}).catch(error);current.current=undefined;setSelected(undefined);commandGeneration.current++;})}
        <Text style={{fontSize:23,fontWeight:'700',color:colors.ink}}>{selected.title}</Text>
        <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{button(pref.category==='chat'?'Interactive':'Alerts only',()=>{void preference({category:pref.category==='chat'?'alerts':'chat'})})}{button('Notifications: '+pref.noise,()=>{void preference({noise:pref.noise==='quiet'?'loud':pref.noise==='loud'?'off':'quiet'})})}</View>
        {button('Load older messages',()=>{void history(selected,true).catch(error)})}
        <ScrollView ref={scroller} style={{height:360}} maintainVisibleContentPosition={{minIndexForVisible:0}} scrollEventThrottle={100} onScroll={event=>{const v=event.nativeEvent;autoScroll.current=v.contentSize.height-v.layoutMeasurement.height-v.contentOffset.y<60;}} onContentSizeChange={()=>{if(autoScroll.current)scroller.current?.scrollToEnd({animated:true});}}>
          {messages.map(message=>{const file=mediaFile(message),local=file&&(files[file.id]||file);return <View key={message.id} style={{backgroundColor:message.is_outgoing?'#DBF2F0':'white',padding:14,marginVertical:4,borderRadius:12}}>
            <Text selectable style={{color:colors.ink}}>{messageText(message)}</Text>
            {message.sending_state?.['@type']==='messageSendingStateFailed'&&<Text style={{color:'#B53432'}}>Failed: {message.sending_state.error?.message}</Text>}
            {file&&<>{message.content?.['@type']==='messagePhoto'&&local?.local?.is_downloading_completed&&<Image source={{uri:'file://'+local.local.path}} style={{height:180,width:'100%'}} resizeMode="contain"/>}{button(local?.local?.is_downloading_completed?'Open / share file':'Download file',()=>{void openMedia(message)})}</>}
            {message.reply_markup?.['@type']==='replyMarkupInlineKeyboard'&&message.reply_markup.rows.map((row:Td[],i:number)=><View key={i} style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}>{row.map((b,j)=><View key={j}>{button(b.text,()=>{void inline(message,b)})}</View>)}</View>)}
            {message.reply_markup?.['@type']==='replyMarkupShowKeyboard'&&pref.category==='chat'&&message.reply_markup.rows.map((row:Td[],i:number)=><View key={i}>{row.map((b,j)=>b.type['@type']==='keyboardButtonTypeText'?<View key={j}>{button(b.text,()=>{void send(b.text)},busy)}</View>:<Text key={j}>{b.text}: permission action is not supported yet</Text>)}</View>)}
          </View>})}
        </ScrollView>
        {pref.category==='chat'&&<>{input(draft,setDraft,'Message')}{draft.startsWith('/')&&commands.filter(c=>('/'+c.command).startsWith(draft.split(' ')[0])).map(c=><Pressable key={c.command} onPress={()=>setDraft('/'+c.command+' ')} style={{padding:8}}><Text style={{color:colors.accent}}>/{c.command} — {c.description}</Text></Pressable>)}{button('Send',()=>{void send()},busy||!draft.trim())}{button('Attach file',()=>{void attach()},busy)}{!messages.length&&button('Start bot',()=>{void send('/start')},busy)}</>}
      </>:<>
        <Text style={{fontSize:20,color:colors.ink,marginVertical:10}}>Only bots. No groups, no noise.</Text>
        <View style={{flexDirection:'row',gap:8}}>{(['all','chat','alerts'] as const).map(value=><View key={value}>{button(value===filter?'✓ '+value:value,()=>setFilter(value))}</View>)}</View>
        {bots.filter(b=>filter==='all'||(preferences[b.id]||defaults).category===filter).map(bot=><Pressable key={bot.id} onPress={()=>{void select(bot)}} style={{padding:18,borderRadius:14,backgroundColor:'white',marginVertical:5}}><Text style={{fontSize:18,fontWeight:'700',color:colors.ink}}>{bot.title}{bot.unread?' · '+bot.unread:''}</Text><Text style={{color:colors.muted}}>{(preferences[bot.id]||defaults).category} · {(preferences[bot.id]||defaults).noise}</Text></Pressable>)}
        {!bots.length&&<Text style={{marginVertical:14,color:colors.muted}}>Your bot conversations will appear here after Telegram loads them.</Text>}
        {input(link,setLink,'@bot_username or https://t.me/bot?start=…')}{button('Open bot',()=>{void addBot()},!link.trim())}
        {button('Refresh bot list',()=>{void loadChats().catch(error)})}
        {button('Log out of Telegram',()=>Alert.alert('Log out?','This closes your Telegram session on this device.',[{text:'Cancel',style:'cancel'},{text:'Log out',style:'destructive',onPress:()=>{void request('logOut').catch(error)}}]))}
      </>}
      <Text style={{fontSize:12,color:colors.muted,marginTop:16}}>Notifications work while the app can run. Closed-app push delivery has not been implemented.</Text>
    </>}
  </ScrollView></SafeAreaView>;
}
export default function App(){return <SafeAreaProvider><Main/></SafeAreaProvider>}
