/** TDLib JSON protocol, deliberately independent of React and native bindings. */
export type Td = { '@type': string; [key: string]: any };
export interface Transport {
  send(json: string): void;
  subscribe(listener: (json: string) => void): () => void;
}
export class TelegramError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}
export class TdRequests {
  private sequence = 0;
  private pending = new Map<string, { resolve: (v: Td) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(update: Td) => void>();
  private unsubscribe: () => void;
  private disposed = false;
  constructor(private transport: Transport, private timeout = 30000) {
    this.unsubscribe = transport.subscribe(json => {
      let value: Td;
      try { value = JSON.parse(json); } catch { return; }
      if (!value || typeof value !== 'object' || typeof value['@type'] !== 'string') return;
      const pending = this.pending.get(value['@extra']);
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(value['@extra']);
        if (value['@type'] === 'error') pending.reject(new TelegramError(value.code, value.message));
        else pending.resolve(value);
      } else if (value['@type']?.startsWith('update')) {
        for (const listener of this.listeners) listener(value);
      }
    });
  }
  onUpdate(listener: (update: Td) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  request(type: string, args: Record<string, unknown> = {}): Promise<Td> {
    if (this.disposed) return Promise.reject(new Error('Connection closed'));
    const extra = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(extra); reject(new Error(`${type} timed out`)); }, this.timeout);
      this.pending.set(extra, { resolve, reject, timer });
      try { this.transport.send(JSON.stringify({ ...args, '@type': type, '@extra': extra })); }
      catch (error) { clearTimeout(timer); this.pending.delete(extra); reject(error); }
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.unsubscribe(); this.listeners.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connection closed')); }
    this.pending.clear();
  }
}
export type Preference = { category: 'chat' | 'alerts'; noise: 'loud' | 'quiet' | 'off' };
export type BotChat = { id: number; userId: number; title: string; unread: number; order: string };
export class BotStore {
  private chats = new Map<number, Td>();
  private users = new Map<number, Td>();
  private messages = new Map<number, Map<number, Td>>();
  private orders = new Map<number, string>();
  private sequence = new Map<number, number>();
  private mutations = new Map<number, Map<number, number>>();
  ingest(update: Td) {
    switch (update['@type']) {
      case 'updateUser': this.users.set(update.user.id, update.user); break;
      case 'user': this.users.set(update.id, update); break;
      case 'updateNewChat': this.chats.set(update.chat.id, update.chat); this.readPositions(update.chat.id, update.chat.positions); break;
      case 'chat': this.chats.set(update.id, update); this.readPositions(update.id, update.positions); break;
      case 'updateChatPosition': this.readPositions(update.chat_id, [update.position]); break;
      case 'updateChatTitle': { const c = this.chats.get(update.chat_id); if (c) c.title = update.title; break; }
      case 'updateChatReadInbox': { const c = this.chats.get(update.chat_id); if (c) c.unread_count = update.unread_count; break; }
      case 'updateNewMessage': this.upsert(update.message); break;
      case 'message': this.upsert(update); break;
      case 'updateMessageSendSucceeded': this.messages.get(update.message.chat_id)?.delete(update.old_message_id); this.mark(update.message.chat_id, update.old_message_id); this.upsert(update.message); break;
      case 'updateMessageSendFailed': this.messages.get(update.message.chat_id)?.delete(update.old_message_id); this.mark(update.message.chat_id, update.old_message_id); this.upsert(update.message); break;
      case 'updateMessageContent': { const m = this.messages.get(update.chat_id)?.get(update.message_id); if (m) m.content = update.new_content; this.mark(update.chat_id, update.message_id); break; }
      case 'updateMessageEdited': { const m = this.messages.get(update.chat_id)?.get(update.message_id); if (m) m.reply_markup = update.reply_markup; this.mark(update.chat_id, update.message_id); break; }
      case 'updateDeleteMessages': for (const id of update.message_ids) { this.messages.get(update.chat_id)?.delete(id); this.mark(update.chat_id, id); } break;
      case 'updateChatLastMessage': this.readPositions(update.chat_id, update.positions); break;
    }
  }
  private mark(chat: number, id: number) {
    this.sequence.set(chat, this.revision(chat) + 1);
    if (!this.mutations.has(chat)) this.mutations.set(chat, new Map());
    this.mutations.get(chat)!.set(id, this.revision(chat));
  }
  revision(chat: number) { return this.sequence.get(chat) || 0; }
  private readPositions(chat: number, positions?: Td[]) {
    for (const p of positions || []) if (['chatListMain', 'chatListArchive'].includes(p.list?.['@type'])) this.orders.set(chat, String(p.order));
  }
  upsert(message: Td) {
    if (!this.messages.has(message.chat_id)) this.messages.set(message.chat_id, new Map());
    this.messages.get(message.chat_id)!.set(message.id, message); this.mark(message.chat_id, message.id);
  }
  mergeHistory(chat: number, messages: Td[], revision: number) {
    // Preserve edits/deletions delivered after this request started; still load the rest of the page.
    if (!this.messages.has(chat)) this.messages.set(chat, new Map());
    for (const message of messages) {
      if (!message || message.chat_id !== chat) continue;
      if ((this.mutations.get(chat)?.get(message.id) || 0) > revision) continue;
      this.messages.get(chat)!.set(message.id, message);
    }
    return true;
  }
  getBots(): BotChat[] {
    const bots: BotChat[] = [];
    for (const c of this.chats.values()) {
      if (c.type?.['@type'] !== 'chatTypePrivate') continue;
      if (this.users.get(c.type.user_id)?.type?.['@type'] !== 'userTypeBot') continue;
      bots.push({ id: c.id, userId: c.type.user_id, title: c.title, unread: c.unread_count || 0, order: this.orders.get(c.id) || '0' });
    }
    return bots.sort((a, b) => a.order.length === b.order.length ? b.order.localeCompare(a.order) : b.order.length - a.order.length);
  }
  isBot(chat: number) { return this.getBots().some(c => c.id === chat); }
  getMessages(chat: number) { return [...(this.messages.get(chat)?.values() || [])].sort((a, b) => a.id - b.id); }
  getUser(id: number) { return this.users.get(id); }
  clear() { this.chats.clear(); this.users.clear(); this.messages.clear(); this.orders.clear(); this.sequence.clear(); this.mutations.clear(); }
}
export function authRequest(state: string, input: string): [string, Record<string, unknown>] {
  // Passwords may deliberately contain leading/trailing whitespace.
  const value = state === 'authorizationStateWaitPassword' ? input : input.trim();
  if (!value) throw new Error('Enter a value');
  switch (state) {
    case 'authorizationStateWaitPhoneNumber': return ['setAuthenticationPhoneNumber', { phone_number: value }];
    case 'authorizationStateWaitCode': return ['checkAuthenticationCode', { code: value }];
    case 'authorizationStateWaitPassword': return ['checkAuthenticationPassword', { password: value }];
    case 'authorizationStateWaitEmailAddress': return ['setAuthenticationEmailAddress', { email_address: value }];
    case 'authorizationStateWaitEmailCode': return ['checkAuthenticationEmailCode', { code: { '@type': 'emailAddressAuthenticationCode', code: value } }];
    default: throw new Error('This authorization step requires another action');
  }
}
export function messageText(message: Td): string {
  const c = message.content || {};
  return c.text?.text || c.caption?.text || ({ messagePhoto: 'Photo', messageVideo: 'Video', messageAnimation: 'Animation', messageVoiceNote: 'Voice message', messageAudio: 'Audio', messageSticker: c.sticker?.emoji || 'Sticker', messageDocument: c.document?.file_name || 'Document' } as Record<string, string>)[c['@type']] || c['@type'] || 'Message';
}
export function mediaFile(message: Td): Td | undefined {
  const c = message.content;
  return c?.photo?.sizes?.at(-1)?.photo || c?.document?.document || c?.video?.video || c?.animation?.animation || c?.audio?.audio || c?.voice_note?.voice || c?.sticker?.sticker;
}
export function botLink(input: string): { username: string; parameter?: string } {
  const value = input.trim();
  if (/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value)) return { username: value.replace(/^@/, '') };
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(url.hostname)) throw new Error('Enter a bot username or https://t.me link');
  const username = url.pathname.slice(1);
  if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) throw new Error('Invalid bot link');
  const parameter = url.searchParams.get('start') || undefined;
  if (parameter && !/^[a-zA-Z0-9_-]{1,64}$/.test(parameter)) throw new Error('Invalid start parameter');
  return { username, parameter };
}

/** Convert only picker-produced local URIs; TDLib cannot read Android content providers directly. */
export function localFilePath(uri: string): string {
  const url = new URL(uri);
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) throw new Error('The selected file must be copied to local storage');
  const path = decodeURIComponent(url.pathname);
  if (!path.startsWith('/') || path.endsWith('/') || path.includes('\0')) throw new Error('Invalid local file path');
  return path;
}
export function documentContent(path: string, caption = ''): Td {
  return { '@type': 'inputMessageDocument', document: { '@type': 'inputDocument', document: { '@type': 'inputFileLocal', path }, disable_content_type_detection: false }, caption: { '@type': 'formattedText', text: caption, entities: [] } };
}
