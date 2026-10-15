export type TelegramCommand={command:string;description:string};
export type InlineButton={text:string;url?:string;callback_data?:string};
export type TelegramUpdate={update_id:number;message?:{message_id:number;chat:{id:number};text?:string;reply_markup?:{inline_keyboard:InlineButton[][]}};callback_query?:{id:string;data?:string}};
export class TelegramBotError extends Error{constructor(message:string,readonly code?:number){super(message);this.name='TelegramBotError'}}
export async function botApi<T>(token:string,method:string,params:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
 if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))throw new TelegramBotError('Invalid BotFather token format');
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal});
 let result:{ok:boolean;result?:T;description?:string;error_code?:number};
 try{result=await response.json()}catch{throw new TelegramBotError('Invalid response from Telegram')}
 if(!response.ok||!result.ok||result.result===undefined)throw new TelegramBotError(result.description||'Telegram API error',result.error_code||response.status);
 return result.result;
}
export function normalizeChatId(value:string):number|string{
 const v=value.trim();if(/^@\w{5,}$/.test(v))return v;
 if(!/^-?\d{1,16}$/.test(v))throw new Error('Enter a numeric chat ID or public @username');
 const n=Number(v);if(!Number.isSafeInteger(n))throw new Error('Chat ID exceeds JavaScript safe integer range');
 return n;
}
