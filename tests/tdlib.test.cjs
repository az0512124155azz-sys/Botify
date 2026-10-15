const {test} = require('node:test');
const assert = require('node:assert/strict');
const {TdRequests, BotStore, authRequest, botLink, mediaFile} = require('../.test-build/tdlib.js');
function harness(timeout=100) {
 let handler, sent=[];
 const requests=new TdRequests({send: value=>sent.push(JSON.parse(value)), subscribe: listener=>{handler=listener;return()=>{handler=()=>{}}}}, timeout);
 return {requests,sent,reply: value=>handler(JSON.stringify(value))};
}
test('correlates out-of-order replies; updates cannot satisfy requests',async()=>{
 const h=harness(), updates=[];h.requests.onUpdate(u=>updates.push(u));
 const a=h.requests.request('getChat',{chat_id:1}),b=h.requests.request('getChat',{chat_id:2});
 h.reply({'@type':'updateNewMessage',message:{id:3}});h.reply({'@type':'chat','@extra':h.sent[1]['@extra'],id:2});h.reply({'@type':'chat','@extra':h.sent[0]['@extra'],id:1});
 assert.equal((await a).id,1);assert.equal((await b).id,2);assert.equal(updates.length,1);h.requests.dispose();
});
test('propagates TDLib error codes, timeout and closed-session cancellation',async()=>{
 const h=harness(15),a=h.requests.request('bad');h.reply({'@type':'error','@extra':h.sent[0]['@extra'],code:429,message:'FLOOD_WAIT'});await assert.rejects(a,{code:429});
 await assert.rejects(h.requests.request('slow'),/timed out/);
 const b=h.requests.request('pending');h.requests.dispose();await assert.rejects(b,/closed/);await assert.rejects(h.requests.request('late'),/closed/);
});
test('send failure rejects immediately',async()=>{
 const c=new TdRequests({send(){throw Error('native missing')},subscribe(){return()=>{}}});await assert.rejects(c.request('getMe'),/native missing/);c.dispose();
});
for (const userFirst of [true,false]) test(`filters bots and supports either update order (${userFirst})`,()=>{
 const s=new BotStore();const user={'@type':'updateUser',user:{id:10,type:{'@type':'userTypeBot'}}},chat={'@type':'updateNewChat',chat:{id:1,title:'Bot',type:{'@type':'chatTypePrivate',user_id:10},positions:[]}};
 for(const u of userFirst?[user,chat]:[chat,user])s.ingest(u);
 s.ingest({'@type':'chat',id:2,type:{'@type':'chatTypeSupergroup',supergroup_id:10}});
 s.ingest({'@type':'chat',id:3,type:{'@type':'chatTypePrivate',user_id:11}});
 s.ingest({'@type':'user',id:11,type:{'@type':'userTypeRegular'}});
 assert.deepEqual(s.getBots().map(b=>b.id),[1]);
 s.ingest({'@type':'user',id:10,type:{'@type':'userTypeDeleted'}});assert.equal(s.getBots().length,0);
});
test('merges history without duplicates and isolates selected chats',()=>{
 const s=new BotStore();assert.equal(s.mergeHistory(1,[{'@type':'message',id:2,chat_id:1},{'@type':'message',id:1,chat_id:1},{'@type':'message',id:3,chat_id:2}],0),true);
 s.ingest({'@type':'updateNewMessage',message:{'@type':'message',id:2,chat_id:1}});
 assert.deepEqual(s.getMessages(1).map(m=>m.id),[1,2]);assert.equal(s.getMessages(2).length,0);
 const rev=s.revision(1);s.ingest({'@type':'updateDeleteMessages',chat_id:1,message_ids:[2]});assert.equal(s.mergeHistory(1,[{'@type':'message',id:2,chat_id:1}],rev),true);assert.deepEqual(s.getMessages(1).map(m=>m.id),[1]);
});
test('handles edit, send success and deletion',()=>{
 const s=new BotStore();s.upsert({'@type':'message',id:-1,chat_id:1,content:{text:{text:'draft'}}});
 s.ingest({'@type':'updateMessageSendSucceeded',old_message_id:-1,message:{'@type':'message',id:5,chat_id:1,content:{text:{text:'sent'}}}});
 s.ingest({'@type':'updateMessageContent',chat_id:1,message_id:5,new_content:{text:{text:'edited'}}});assert.equal(s.getMessages(1)[0].content.text.text,'edited');assert.equal(s.getMessages(1).length,1);
});
test('preserves 2FA password whitespace and routes email authorization',()=>{
 assert.deepEqual(authRequest('authorizationStateWaitPassword',' a '),['checkAuthenticationPassword',{password:' a '}]);
 assert.equal(authRequest('authorizationStateWaitEmailAddress',' a@b.com ')[0],'setAuthenticationEmailAddress');assert.equal(authRequest('authorizationStateWaitEmailCode','123')[1].code['@type'],'emailAddressAuthenticationCode');assert.throws(()=>authRequest('authorizationStateReady','x'));
});
test('validates bot deep links and start parameters',()=>{
 assert.deepEqual(botLink('https://t.me/TestBot?start=abc_1'),{username:'TestBot',parameter:'abc_1'});assert.equal(botLink('@TestBot').username,'TestBot');
 for(const link of ['https://t.me.evil.com/TestBot','javascript:alert(1)','https://t.me/+invite','https://t.me/TestBot?start=a%20b'])assert.throws(()=>botLink(link));
});
test('finds full-size photo/document file',()=>{
 assert.equal(mediaFile({'@type':'message',content:{photo:{sizes:[{photo:{id:1}},{photo:{id:2}}]}}}).id,2);
});

test('history arriving after a live edit preserves that edit and still loads older messages',()=>{
 const s=new BotStore();s.upsert({'@type':'message',id:3,chat_id:1,content:{text:{text:'before'}}});const rev=s.revision(1);
 s.ingest({'@type':'updateMessageContent',chat_id:1,message_id:3,new_content:{text:{text:'after'}}});
 s.mergeHistory(1,[{'@type':'message',id:3,chat_id:1,content:{text:{text:'stale'}}},{'@type':'message',id:2,chat_id:1}],rev);
 assert.deepEqual(s.getMessages(1).map(m=>m.id),[2,3]);assert.equal(s.getMessages(1)[1].content.text.text,'after');
});
test('ignores malformed JSON values without breaking later responses',async()=>{
 const h=harness();for(const invalid of [null,[],42,'hello'])h.reply(invalid);const p=h.requests.request('getMe');h.reply({'@type':'user','@extra':h.sent[0]['@extra'],id:7});assert.equal((await p).id,7);h.requests.dispose();
});
test('preserves full-precision TDLib string ordering',()=>{
 const s=new BotStore();for(const [id,order] of [[1,'9223372036854775806'],[2,'9223372036854775807']]){
 s.ingest({'@type':'user',id,type:{'@type':'userTypeBot'}});s.ingest({'@type':'chat',id,title:String(id),type:{'@type':'chatTypePrivate',user_id:id},positions:[{list:{'@type':'chatListMain'},order}]});}
 assert.deepEqual(s.getBots().map(b=>b.id),[2,1]);
});
