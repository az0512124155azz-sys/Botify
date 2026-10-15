using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
namespace BotHub;
public partial class MainWindow : Window
{
    private TdClient? client;
    private string state="";
    private readonly Dictionary<long,BotChat> bots=new();
    private long selected;
    private int apiId;
    private string apiHash="";
    private sealed record BotChat(long Id,string Label);
    public MainWindow(){InitializeComponent();Closed+=(_,_)=>client?.Dispose();}
    private void ConnectClicked(object sender,RoutedEventArgs e)
    {
        if(!int.TryParse(ApiId.Text,out apiId)||string.IsNullOrWhiteSpace(ApiHash.Text)){Status.Text="Enter a valid Telegram developer API ID and API hash.";return;}
        try {apiHash=ApiHash.Text.Trim();client?.Dispose();client=new TdClient();client.Update+=OnUpdate;Status.Text="TDLib initialized. Starting authorization...";}
        catch(DllNotFoundException){Status.Text="tdjson.dll is missing. Install a matching native TDLib library before connecting.";}
        catch(Exception ex){Status.Text="Unable to initialize TDLib: "+ex.Message;}
    }
    private void OnUpdate(JsonElement value)=>Dispatcher.InvokeAsync(()=>Process(value));
    private void Process(JsonElement item)
    {
        if(!item.TryGetProperty("@type",out var t))return;
        var kind=t.GetString();
        if(kind=="error"){Status.Text="Telegram error: "+item.GetProperty("message").GetString();return;}
        if(kind=="updateAuthorizationState"){
            var auth=item.GetProperty("authorization_state");
            state=auth.GetProperty("@type").GetString()??"";
            Status.Text=state;
            if(state=="authorizationStateWaitTdlibParameters"){
                client?.Send("setTdlibParameters",new {
                    use_test_dc=false,database_directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BotHub","tdlib"),
                    files_directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BotHub","files"),
                    database_encryption_key="",use_file_database=true,use_chat_info_database=true,use_message_database=true,
                    use_secret_chats=false,api_id=apiId,api_hash=apiHash,system_language_code="en",device_model="Windows",
                    system_version=Environment.OSVersion.VersionString,application_version="0.3"
                });
            }
            else if(state=="authorizationStateWaitEncryptionKey")client?.Send("checkDatabaseEncryptionKey",new {encryption_key=""});
            else if(state=="authorizationStateReady"){Status.Text="Connected to Telegram";client?.Send("loadChats",new {chat_list=new {@type="chatListMain"},limit=100});}
            return;
        }
        if(kind=="updateNewChat"){var chat=item.GetProperty("chat");ReadChat(chat);return;}
        if(kind=="messages"){foreach(var message in item.GetProperty("messages").EnumerateArray()){if(message.TryGetProperty("content",out var content)&&content.TryGetProperty("text",out var t2))Messages.Items.Add(t2.GetProperty("text").GetString());}return;}
        if(kind=="updateUser"){
            var user=item.GetProperty("user");
            if(user.TryGetProperty("type",out var ut)&&ut.GetProperty("@type").GetString()=="userTypeBot"){
                var uid=user.GetProperty("id").GetInt64();
                foreach(var chat in allChats.Values)if(chat.userId==uid)AddBot(chat.id,chat.name);
            }
        }
        if(kind=="chat"){ReadChat(item);return;}
        if(kind=="messages"){foreach(var m in item.GetProperty("messages").EnumerateArray()){if(m.ValueKind==JsonValueKind.Null)continue;if(m.TryGetProperty("content",out var content)&&content.TryGetProperty("text",out var body))Messages.Items.Insert(0,body.GetProperty("text").GetString());}return;}
        if(kind=="updateNewMessage"){
            var m=item.GetProperty("message");if(m.GetProperty("chat_id").GetInt64()!=selected)return;
            if(m.TryGetProperty("content",out var c)&&c.TryGetProperty("text",out var text)) Messages.Items.Add(text.GetProperty("text").GetString());
        }
    }
    private readonly Dictionary<long,(long id,long userId,string name)> allChats=new();
    private void ReadChat(JsonElement chat)
    {
        long id=chat.GetProperty("id").GetInt64();
        string name=chat.TryGetProperty("title",out var title)?title.GetString()??"Bot":"Bot";
        if(chat.TryGetProperty("type",out var type)&&type.GetProperty("@type").GetString()=="chatTypePrivate"){
            long userId=type.GetProperty("user_id").GetInt64();allChats[id]=(id,userId,name);
            client?.Send("getUser",new {user_id=userId});
        }
    }
    private void AddBot(long id,string name){if(bots.ContainsKey(id))return;var b=new BotChat(id,name);bots[id]=b;Chats.Items.Add(b);}
    private void SubmitClicked(object sender,RoutedEventArgs e)
    {
        if(client==null)return;
        var value=Credential.Text.Trim();if(value.Length==0)return;
        switch(state){
            case "authorizationStateWaitPhoneNumber":client.Send("setAuthenticationPhoneNumber",new {phone_number=value});break;
            case "authorizationStateWaitCode":client.Send("checkAuthenticationCode",new {code=value});break;
            case "authorizationStateWaitPassword":client.Send("checkAuthenticationPassword",new {password=value});break;
            case "authorizationStateWaitEmailCode":client.Send("checkAuthenticationEmailCode",new {code=new {@type="emailAddressAuthenticationCode",code=value}});break;
            default:Status.Text="Current login state does not accept this input.";break;
        }
        Credential.Clear();
    }
    private void ChatSelected(object sender,SelectionChangedEventArgs e)
    {
        if(Chats.SelectedItem is not BotChat c||client==null)return;
        selected=c.Id;ChatTitle.Text=c.Label;Messages.Items.Clear();
        client.Send("openChat",new {chat_id=selected});
        client.Send("getChatHistory",new {chat_id=selected,from_message_id=0,offset=0,limit=50,only_local=false});
    }
    private void SendClicked(object sender,RoutedEventArgs e)
    {
        if(client==null||selected==0||string.IsNullOrWhiteSpace(Composer.Text))return;
        client.Send("sendMessage",new {chat_id=selected,input_message_content=new {@type="inputMessageText",text=new {@type="formattedText",text=Composer.Text}}});
        Composer.Clear();
    }
}