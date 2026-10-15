using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace BotHub;
public partial class MainWindow
{
    // Explicit offline visual test. It never initializes TDLib or reads an account.
    private async Task CaptureDesignSmoke(string destination)
    {
        try {
            Directory.CreateDirectory(destination);
            await Task.Delay(300);
            SaveDesignImage(Path.Combine(destination,"login.png"));
            LoginPanel.Visibility=Visibility.Collapsed;
            ClientPanel.Visibility=Visibility.Visible;
            ClientPanel.IsEnabled=true;
            ConversationEmpty.Visibility=Visibility.Collapsed;
            ComposePanel.Visibility=Visibility.Visible;
            Status.Text="Offline visual smoke — sample data";
            refreshing=true;
            Chats.Items.Add(new BotChat(1002,2,"Ticket Alerts","A new date has been added"));
            Chats.Items.Add(new BotChat(1003,3,"File Converter","document.pdf"));
            Chats.Items.Add(new BotChat(1001,1,"north","Your document is ready."));
            Chats.SelectedIndex=2;
            refreshing=false;
            selected=1001;
            ChatTitle.Text="north";
            var samples=new[]{
                (false,"Send a document to create a summary."),
                (true,"Please organize the summary by topic, with a short example for each one."),
                (false,"Your summary is ready. You can download the file or choose a topic to practice.")
            };
            long id=1;
            foreach(var (outgoing,text) in samples)Upsert(JsonSerializer.SerializeToElement(new {id=id++,chat_id=1001L,is_outgoing=outgoing,date=1792080000,content=new {@type="messageText",text=new {text}}}));
            RenderMessages();
            await Task.Delay(300);
            SaveDesignImage(Path.Combine(destination,"conversation.png"));
            Application.Current.Shutdown(0);
        } catch(Exception ex) {
            File.WriteAllText(Path.Combine(destination,"failure.txt"),ex.ToString());
            Application.Current.Shutdown(1);
        }
    }
    private void SaveDesignImage(string path)
    {
        UpdateLayout();
        var content=(FrameworkElement)Content;
        var bitmap=new RenderTargetBitmap((int)Math.Ceiling(content.ActualWidth),(int)Math.Ceiling(content.ActualHeight),96,96,PixelFormats.Pbgra32);
        bitmap.Render(content);
        var encoder=new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file=File.Create(path);
        encoder.Save(file);
    }
}
