using System;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BotHub;

// Native TDLib JSON bridge. Requires a matching tdjson.dll beside the executable.
// The receive loop is single-threaded as required by TDLib.
public sealed class TdClient : IDisposable
{
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl)]
    private static extern int td_create_client_id();
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl, CharSet=CharSet.Ansi)]
    private static extern void td_send(int client_id, [MarshalAs(UnmanagedType.LPUTF8Str)] string request);
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl)]
    private static extern IntPtr td_receive(double timeout);

    private readonly int id;
    private readonly CancellationTokenSource cancellation = new();
    public event Action<JsonElement>? Update;
    public TdClient()
    {
        id = td_create_client_id();
        _ = Task.Run(ReceiveLoop);
        Send("getOption", new { name="version" });
    }
    public void Send(string method, object? args = null)
    {
        var json = JsonSerializer.Serialize(new { @type=method });
        if (args != null)
        {
            using var baseDoc=JsonDocument.Parse(json);
            using var argDoc=JsonDocument.Parse(JsonSerializer.Serialize(args));
            var map=new System.Collections.Generic.Dictionary<string,object?> {["@type"]=method};
            foreach (var p in argDoc.RootElement.EnumerateObject()) map[p.Name]=p.Value.Clone();
            json=JsonSerializer.Serialize(map);
        }
        td_send(id,json);
    }
    private async Task ReceiveLoop()
    {
        while (!cancellation.IsCancellationRequested)
        {
            IntPtr ptr=td_receive(0.3);
            if (ptr==IntPtr.Zero) continue;
            try
            {
                var json=Marshal.PtrToStringUTF8(ptr);
                if (json==null) continue;
                using var doc=JsonDocument.Parse(json);
                Update?.Invoke(doc.RootElement.Clone());
            }
            catch (Exception) { /* Bad responses must not crash app */ }
            await Task.Yield();
        }
    }
    public void Dispose() { cancellation.Cancel(); cancellation.Dispose(); }
}
