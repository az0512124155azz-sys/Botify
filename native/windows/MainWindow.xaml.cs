using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BotHub;
public partial class MainWindow : Window
{
    private TdClient? client;
    private string state="";
    private bool initialized, ready, connecting, exiting;
    private long selected, generation;
    private readonly Dictionary<long,JsonElement> chats=new(), users=new();
    private readonly Dictionary<long,SortedDictionary<long,JsonElement>> messages=new();
    private readonly Dictionary<long,JsonElement> files=new();
    private readonly HashSet<string> notified=new();
    private readonly List<Command> allCommands=new();
    private Dictionary<long,Preference> preferences=new();
    private System.Windows.Forms.NotifyIcon? tray;
    private record AppCredentialsValue(int Id,string Hash);
    private record Preference(string Category="chat",string Noise="quiet");
    private sealed record BotChat(long Id,long UserId,string Label);
    private sealed record Command(string Value,string Label);
    private static string Type(JsonElement x)=>x.TryGetProperty("@type",out var t)?t.GetString()??"":"";
    private static string Str(JsonElement x,string key)=>x.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.String?v.GetString()??"":"";
    private Preference Pref(long id)=>preferences.GetValueOrDefault(id)??new();
    public MainWindow()
    {
        InitializeComponent(); Closing+=OnClosing;
        try {preferences=SessionStorage.Read<Dictionary<long,Preference>>("preferences.dpapi")??new();var saved=SessionStorage.Read<AppCredentialsValue>("application.dpapi");if(saved!=null){ApiId.Text=saved.Id.ToString();ApiHash.Password=saved.Hash;}}
        catch(Exception ex){Status.Text="Secure storage: "+ex.Message;}
    }
    private async Task Run(Func<Task> action) {try{await action();}catch(Exception ex){Status.Text=ex.Message;}}
    private async Task<JsonElement> Request(string method,object? args=null)=>await (client??throw new InvalidOperationException("Connect Telegram first")).Request(method,args);
    private async void ConnectClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{
        if(connecting||client!=null)return;
        if(!int.TryParse(ApiId.Text,out var apiId)||apiId<=0||!System.Text.RegularExpressions.Regex.IsMatch(ApiHash.Password,"^[a-fA-F0-9]{32}$"))throw new InvalidOperationException("Enter a valid Telegram API ID and hash from my.telegram.org.");
        connecting=true;Connect.IsEnabled=false;
        try {
            var key=SessionStorage.DatabaseKey();var hash=ApiHash.Password;
            client=new TdClient();client.Fault+=ex=>Dispatcher.InvokeAsync(()=>Status.Text="TDLib: "+ex.Message);
            client.Update+=value=>Dispatcher.InvokeAsync(async()=>await Run(()=>Process(value,apiId,hash,key)));
            await Authorize(await Request("getAuthorizationState"),apiId,hash,key);
            SessionStorage.Save("application.dpapi",new AppCredentialsValue(apiId,hash));
            AppCredentials.Visibility=Visibility.Collapsed;
            tray=new System.Windows.Forms.NotifyIcon {Icon=System.Drawing.SystemIcons.Application,Text="BotHub",Visible=true};
            tray.DoubleClick+=(_,_)=>Dispatcher.Invoke(()=>{Show();WindowState=WindowState.Normal;Activate();});
        } catch {if(client!=null){await client.DisposeAsync();client=null;}Connect.IsEnabled=true;throw;}
        finally{connecting=false;}
    });
    private async Task Authorize(JsonElement auth,int apiId,string hash,string key)
    {
        state=Type(auth);Status.Text=state.Replace("authorizationState","");
        AuthPanel.Visibility=state is "authorizationStateWaitPhoneNumber" or "authorizationStateWaitCode" or "authorizationStateWaitPassword" or "authorizationStateWaitEmailAddress" or "authorizationStateWaitEmailCode"?Visibility.Visible:Visibility.Collapsed;
        AuthPrompt.Text=state switch {"authorizationStateWaitPhoneNumber"=>"Phone (+country code)","authorizationStateWaitCode"=>"Telegram code","authorizationStateWaitPassword"=>"2FA password","authorizationStateWaitEmailAddress"=>"Email address","authorizationStateWaitEmailCode"=>"Email code",_=>""};
        Credential.Clear();
        if(state=="authorizationStateWaitTdlibParameters"&&!initialized){initialized=true;await Request("setTdlibParameters",new {database_directory=System.IO.Path.Combine(SessionStorage.Root,"database"),files_directory=System.IO.Path.Combine(SessionStorage.Root,"files"),database_encryption_key=key,use_file_database=true,use_chat_info_database=true,use_message_database=true,use_secret_chats=false,api_id=apiId,api_hash=hash,system_language_code="en",device_model="Windows",system_version=Environment.OSVersion.VersionString,application_version="0.4.0"});}
        else if(state=="authorizationStateReady"&&!ready){ready=true;ClientPanel.IsEnabled=true;LoginPanel.Visibility=Visibility.Collapsed;Status.Text="Connected to Telegram";await LoadChats();}
        else if(state=="authorizationStateWaitOtherDeviceConfirmation") {Status.Text="Confirm on another Telegram device: "+Str(auth,"link");}
        else if(state=="authorizationStateWaitRegistration")Status.Text="Create your Telegram account in Telegram, then reconnect.";
        else if(state=="authorizationStateWaitPremiumPurchase")Status.Text="Telegram requires a Premium purchase for this sign-in. Complete it in the official Telegram app.";
        else if(state=="authorizationStateClosed"){ready=false;ClientPanel.IsEnabled=false;Status.Text="Connection closed. Restart BotHub to reconnect.";}
    }
    private async Task LoadChats()
    {
        foreach(var list in new[]{"chatListMain","chatListArchive"})while(ready){try{await Request("loadChats",new {chat_list=new {@type=list},limit=100});}catch(TdException e)when(e.Code==404){break;}}
    }
    private void Upsert(JsonElement message){long chat=message.GetProperty("chat_id").GetInt64();if(!messages.ContainsKey(chat))messages[chat]=new();messages[chat][message.GetProperty("id").GetInt64()]=message.Clone();}
    private async Task Process(JsonElement item,int apiId,string hash,string key)
    {
        switch(Type(item)) {
            case "updateAuthorizationState":await Authorize(item.GetProperty("authorization_state"),apiId,hash,key);return;
            case "updateConnectionState":Status.Text=Type(item.GetProperty("state")).Replace("connectionState","");return;
            case "updateUser":var user=item.GetProperty("user");users[user.GetProperty("id").GetInt64()]=user.Clone();RefreshBots();return;
            case "updateNewChat":var chat=item.GetProperty("chat");chats[chat.GetProperty("id").GetInt64()]=chat.Clone();RefreshBots();return;
            case "updateChatTitle":
            case "updateChatReadInbox":
                var id=item.GetProperty("chat_id").GetInt64();chats[id]=await Request("getChat",new {chat_id=id});RefreshBots();return;
            case "updateFile":var f=item.GetProperty("file");files[f.GetProperty("id").GetInt64()]=f.Clone();RenderMessages();return;
            case "updateNewMessage":var m=item.GetProperty("message");Upsert(m);var cid=m.GetProperty("chat_id").GetInt64();
                if(!m.GetProperty("is_outgoing").GetBoolean()&&IsBot(cid)&&notified.Add(cid+":"+m.GetProperty("id").GetInt64())&&Pref(cid).Noise!="off"&&(cid!=selected||!IsActive)){
                    tray?.ShowBalloonTip(5000,Str(chats[cid],"title"),Text(m),Pref(cid).Noise=="loud"?System.Windows.Forms.ToolTipIcon.Warning:System.Windows.Forms.ToolTipIcon.None);
                    if(Pref(cid).Noise=="loud")System.Media.SystemSounds.Exclamation.Play();
                    if(notified.Count>2000)notified.Clear();
                }
                if(cid==selected){RenderMessages();await Request("viewMessages",new {chat_id=cid,message_ids=new[]{m.GetProperty("id").GetInt64()},force_read=true});}return;
            case "updateMessageSendSucceeded":
            case "updateMessageSendFailed":var sent=item.GetProperty("message");messages.GetValueOrDefault(sent.GetProperty("chat_id").GetInt64())?.Remove(item.GetProperty("old_message_id").GetInt64());Upsert(sent);RenderMessages();return;
            case "updateDeleteMessages":if(messages.TryGetValue(item.GetProperty("chat_id").GetInt64(),out var list))foreach(var mid in item.GetProperty("message_ids").EnumerateArray())list.Remove(mid.GetInt64());RenderMessages();return;
            case "updateMessageContent":
            case "updateMessageEdited":var edited=await Request("getMessage",new {chat_id=item.GetProperty("chat_id").GetInt64(),message_id=item.GetProperty("message_id").GetInt64()});Upsert(edited);RenderMessages();return;
        }
    }
    private bool IsBot(long id)=>chats.TryGetValue(id,out var c)&&c.TryGetProperty("type",out var t)&&Type(t)=="chatTypePrivate"&&users.TryGetValue(t.GetProperty("user_id").GetInt64(),out var u)&&Type(u.GetProperty("type"))=="userTypeBot";
    private bool refreshing;
    private void RefreshBots(){if(Chats==null||refreshing)return;refreshing=true;try{var keep=selected;Chats.Items.Clear();foreach(var pair in chats.Where(c=>IsBot(c.Key)).OrderBy(c=>Str(c.Value,"title"))){var p=Pref(pair.Key);if(FeedFilter.SelectedIndex==1&&p.Category!="chat"||FeedFilter.SelectedIndex==2&&p.Category!="alerts")continue;var b=new BotChat(pair.Key,pair.Value.GetProperty("type").GetProperty("user_id").GetInt64(),Str(pair.Value,"title"));Chats.Items.Add(b);if(b.Id==keep)Chats.SelectedItem=b;}}finally{refreshing=false;}}
    private async void SubmitClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{
        var value=state=="authorizationStateWaitPassword"?Credential.Password:Credential.Password.Trim();if(value.Length==0)return;
        switch(state){case "authorizationStateWaitPhoneNumber":await Request("setAuthenticationPhoneNumber",new {phone_number=value});break;case "authorizationStateWaitCode":await Request("checkAuthenticationCode",new {code=value});break;case "authorizationStateWaitPassword":await Request("checkAuthenticationPassword",new {password=value});break;case "authorizationStateWaitEmailAddress":await Request("setAuthenticationEmailAddress",new {email_address=value});break;case "authorizationStateWaitEmailCode":await Request("checkAuthenticationEmailCode",new {code=new {@type="emailAddressAuthenticationCode",code=value}});break;}
        Credential.Clear();
    });
    private async void ResendClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{await Request("resendAuthenticationCode");});
    private async void ChatSelected(object sender,SelectionChangedEventArgs e)=>await Run(async()=>{if(refreshing||Chats.SelectedItem is not BotChat c)return;await Select(c);});
    private async Task Select(BotChat c){if(selected!=0&&selected!=c.Id)await Request("closeChat",new {chat_id=selected});selected=c.Id;var g=++generation;ChatTitle.Text=c.Label;allCommands.Clear();Commands.Items.Clear();ApplyPreference();RenderMessages();await Request("openChat",new {chat_id=c.Id});await History(c.Id,false);var full=await Request("getUserFullInfo",new {user_id=c.UserId});if(g!=generation)return;if(full.TryGetProperty("bot_info",out var info)&&info.ValueKind==JsonValueKind.Object)foreach(var cmd in info.GetProperty("commands").EnumerateArray())allCommands.Add(new Command("/"+Str(cmd,"command"),"/"+Str(cmd,"command")+" — "+Str(cmd,"description")));UpdateCommands();}
    private async Task History(long id,bool older){long from=older&&messages.TryGetValue(id,out var old)&&old.Count>0?old.Keys.First():0;var history=await Request("getChatHistory",new {chat_id=id,from_message_id=from,offset=0,limit=50,only_local=false});foreach(var m in history.GetProperty("messages").EnumerateArray())if(m.ValueKind==JsonValueKind.Object)Upsert(m);if(selected==id){RenderMessages();var ids=messages.GetValueOrDefault(id)?.Keys.ToArray();if(ids?.Length>0)await Request("viewMessages",new {chat_id=id,message_ids=ids,force_read=true});}}
    private static string Text(JsonElement m){var c=m.GetProperty("content");if(c.TryGetProperty("text",out var t))return Str(t,"text");if(c.TryGetProperty("caption",out var caption)&&Str(caption,"text")!="")return Str(caption,"text");return Type(c).Replace("message","");}
    private static JsonElement? Media(JsonElement m){var c=m.GetProperty("content");if(c.TryGetProperty("photo",out var photo))return photo.GetProperty("sizes").EnumerateArray().Last().GetProperty("photo");foreach(var pair in new[]{("document","document"),("video","video"),("animation","animation"),("audio","audio"),("voice_note","voice"),("sticker","sticker")})if(c.TryGetProperty(pair.Item1,out var media))return media.GetProperty(pair.Item2);return null;}
    private void RenderMessages(){var atBottom=HistoryScroll.ScrollableHeight-HistoryScroll.VerticalOffset<60;Messages.Children.Clear();if(!messages.TryGetValue(selected,out var list))return;foreach(var m in list.Values){var panel=new StackPanel {Margin=new Thickness(0,4,0,4),Background=m.GetProperty("is_outgoing").GetBoolean()?new SolidColorBrush(Color.FromRgb(219,242,240)):Brushes.White};panel.Children.Add(new TextBlock {Text=Text(m),TextWrapping=TextWrapping.Wrap,Margin=new Thickness(12)});if(m.TryGetProperty("sending_state",out var sending)&&Type(sending)=="messageSendingStateFailed")panel.Children.Add(new TextBlock {Text="Message failed to send",Foreground=Brushes.Firebrick});if(Media(m) is JsonElement media){var download=new Button {Content="Download / open attachment",Margin=new Thickness(8)};download.Click+=async(_,_)=>await Run(async()=>{var file=await Request("downloadFile",new {file_id=media.GetProperty("id").GetInt64(),priority=16,offset=0,limit=0,synchronous=true});var path=Str(file.GetProperty("local"),"path");if(!string.IsNullOrEmpty(path))ProcessStart("explorer.exe","/select,\""+path+"\"");});panel.Children.Add(download);}if(m.TryGetProperty("reply_markup",out var markup)&&Type(markup)=="replyMarkupInlineKeyboard")foreach(var row in markup.GetProperty("rows").EnumerateArray()){var buttons=new WrapPanel();foreach(var b in row.EnumerateArray()){var copy=b.Clone();var btn=new Button {Content=Str(b,"text"),Padding=new Thickness(10,6,10,6),Margin=new Thickness(3)};btn.Click+=async(_,_)=>await Run(()=>Inline(m,copy));buttons.Children.Add(btn);}panel.Children.Add(buttons);}Messages.Children.Add(panel);}if(atBottom)HistoryScroll.ScrollToEnd();}
    private async Task Inline(JsonElement message,JsonElement button){var type=button.GetProperty("type");if(Type(type)=="inlineKeyboardButtonTypeUrl"){OpenUrl(Str(type,"url"));return;}if(Type(type)!="inlineKeyboardButtonTypeCallback")throw new InvalidOperationException("This inline button type is not supported yet: "+Type(type));var answer=await Request("getCallbackQueryAnswer",new {chat_id=message.GetProperty("chat_id").GetInt64(),message_id=message.GetProperty("id").GetInt64(),payload=new {@type="callbackQueryPayloadData",data=Str(type,"data")}});if(Str(answer,"text")!="")MessageBox.Show(Str(answer,"text"),"Bot");if(Str(answer,"url")!="")OpenUrl(Str(answer,"url"));}
    private static void ProcessStart(string file,string? args=null)=>System.Diagnostics.Process.Start(new ProcessStartInfo(file,args??""){UseShellExecute=true});
    private static void OpenUrl(string url){if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||uri.Scheme is not ("http" or "https" or "tg"))throw new InvalidOperationException("Unsupported link");ProcessStart(url);}
    private async void SendClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{if(selected==0||string.IsNullOrWhiteSpace(Composer.Text)||Pref(selected).Category=="alerts")return;Send.IsEnabled=false;try{var text=Composer.Text;var result=await Request("sendMessage",new {chat_id=selected,input_message_content=new {@type="inputMessageText",text=new {@type="formattedText",text}}});Upsert(result);if(Composer.Text==text)Composer.Clear();RenderMessages();}finally{Send.IsEnabled=true;}});
    private void UpdateCommands(){if(Commands==null)return;var prefix=Composer?.Text??"";Commands.Items.Clear();foreach(var command in allCommands.Where(c=>!prefix.StartsWith("/")||c.Value.StartsWith(prefix,StringComparison.OrdinalIgnoreCase)))Commands.Items.Add(command);}
    private void DraftChanged(object sender,TextChangedEventArgs e)=>UpdateCommands();
    private void CommandSelected(object sender,SelectionChangedEventArgs e){if(Commands.SelectedItem is Command c){Composer.Text=c.Value+" ";Composer.Focus();Composer.CaretIndex=Composer.Text.Length;}}
    private void ApplyPreference(){var p=Pref(selected);Category.Content=p.Category=="chat"?"Interactive":"Alerts only";Noise.Content="Notifications: "+p.Noise;ComposePanel.Visibility=p.Category=="chat"?Visibility.Visible:Visibility.Collapsed;Commands.Visibility=ComposePanel.Visibility;}
    private void SavePreference(Preference p){preferences[selected]=p;SessionStorage.Save("preferences.dpapi",preferences);ApplyPreference();RefreshBots();}
    private void CategoryClicked(object sender,RoutedEventArgs e){if(selected!=0)SavePreference(Pref(selected) with {Category=Pref(selected).Category=="chat"?"alerts":"chat"});}
    private void NoiseClicked(object sender,RoutedEventArgs e){if(selected!=0)SavePreference(Pref(selected) with {Noise=Pref(selected).Noise switch {"quiet"=>"loud","loud"=>"off",_=>"quiet"}});}
    private void FilterChanged(object sender,SelectionChangedEventArgs e)=>RefreshBots();
    private async void RefreshClicked(object sender,RoutedEventArgs e)=>await Run(LoadChats);
    private async void OlderClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{if(selected!=0)await History(selected,true);});
    private async void OpenBotClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{
        var value=BotLink.Text.Trim();string parameter="";if(value.StartsWith("https://",StringComparison.Ordinal)){var uri=new Uri(value);if(uri.Host is not ("t.me" or "telegram.me"))throw new InvalidOperationException("Enter a Telegram bot link");value=uri.AbsolutePath.Trim('/');foreach(var part in uri.Query.TrimStart('?').Split('&'))if(part.StartsWith("start="))parameter=Uri.UnescapeDataString(part[6..]);}
        value=value.TrimStart('@');if(!System.Text.RegularExpressions.Regex.IsMatch(value,"^[a-zA-Z][a-zA-Z0-9_]{4,31}$"))throw new InvalidOperationException("Invalid bot username");
        var c=await Request("searchPublicChat",new {username=value});if(Type(c.GetProperty("type"))!="chatTypePrivate")throw new InvalidOperationException("This is not a bot");var uid=c.GetProperty("type").GetProperty("user_id").GetInt64();var u=await Request("getUser",new {user_id=uid});if(Type(u.GetProperty("type"))!="userTypeBot")throw new InvalidOperationException("This account is not a bot");users[uid]=u;var id=c.GetProperty("id").GetInt64();chats[id]=c;RefreshBots();await Select(new BotChat(id,uid,Str(c,"title")));if(parameter!="")await Request("sendBotStartMessage",new {bot_user_id=uid,chat_id=id,parameter});BotLink.Clear();
    });
    private async void LogoutClicked(object sender,RoutedEventArgs e)=>await Run(async()=>{if(MessageBox.Show("Log out of Telegram on this device?","BotHub",MessageBoxButton.YesNo)==MessageBoxResult.Yes)await Request("logOut");});
    private async void OnClosing(object? sender,CancelEventArgs e){if(exiting)return;e.Cancel=true;exiting=true;try{if(client!=null)await client.DisposeAsync();}catch(Exception ex){Status.Text="Closing TDLib: "+ex.Message;}finally{tray?.Dispose();Close();}}
}
