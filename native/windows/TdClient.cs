using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BotHub;
public sealed class TdException(int code, string message) : Exception(message) { public int Code { get; } = code; }

// A process-wide receiver routes by @client_id. Closing a client never starts a second receiver.
public sealed class TdClient : IAsyncDisposable
{
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl)] private static extern int td_create_client_id();
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl)] private static extern void td_send(int id, [MarshalAs(UnmanagedType.LPUTF8Str)] string request);
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr td_receive(double timeout);
    [DllImport("tdjson", CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr td_execute([MarshalAs(UnmanagedType.LPUTF8Str)] string request);
    private static readonly ConcurrentDictionary<int,TdClient> Clients = new();
    private static readonly object PumpLock = new();
    private static bool pumping;
    private readonly int id;
    private long sequence;
    private int closing;
    private readonly ConcurrentDictionary<string,TaskCompletionSource<JsonElement>> pending = new();
    private readonly TaskCompletionSource closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public event Action<JsonElement>? Update;
    public event Action<Exception>? Fault;
    public TdClient()
    {
        lock (PumpLock)
        {
            td_execute("{\"@type\":\"setLogVerbosityLevel\",\"new_verbosity_level\":0}");
            id = td_create_client_id(); Clients[id] = this;
            if (!pumping) { pumping = true; _ = Task.Run(Pump); }
        }
    }
    public async Task<JsonElement> Request(string method, object? args=null)
    {
        if (Volatile.Read(ref closing)!=0) throw new ObjectDisposedException(nameof(TdClient));
        var extra=Interlocked.Increment(ref sequence).ToString();
        var source=new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var map=new Dictionary<string,object?>();
        if(args!=null) { using var doc=JsonDocument.Parse(JsonSerializer.Serialize(args)); foreach(var p in doc.RootElement.EnumerateObject())map[p.Name]=p.Value.Clone(); }
        map["@type"]=method; map["@extra"]=extra; pending[extra]=source;
        try { td_send(id,JsonSerializer.Serialize(map)); return await source.Task.WaitAsync(TimeSpan.FromSeconds(45)); }
        finally { pending.TryRemove(extra,out _); }
    }
    private static void Pump()
    {
        while(true)
        {
            try
            {
                var ptr=td_receive(0.3); if(ptr==IntPtr.Zero)continue;
                using var doc=JsonDocument.Parse(Marshal.PtrToStringUTF8(ptr)!); var value=doc.RootElement.Clone();
                if(!value.TryGetProperty("@client_id",out var cid)||!Clients.TryGetValue(cid.GetInt32(),out var client))continue;
                if(value.TryGetProperty("@extra",out var extra)&&client.pending.TryRemove(extra.GetString()!,out var source))
                {
                    if(value.GetProperty("@type").GetString()=="error")source.TrySetException(new TdException(value.GetProperty("code").GetInt32(),value.GetProperty("message").GetString()!));
                    else source.TrySetResult(value);
                }
                else client.Update?.Invoke(value);
                if(value.GetProperty("@type").GetString()=="updateAuthorizationState"&&value.GetProperty("authorization_state").GetProperty("@type").GetString()=="authorizationStateClosed")
                {Clients.TryRemove(client.id,out _);client.closed.TrySetResult();}
            }
            catch(Exception error) { foreach(var c in Clients.Values) { foreach(var p in c.pending.Values)p.TrySetException(error); c.Fault?.Invoke(error); } }
        }
    }
    public async ValueTask DisposeAsync()
    {
        if(Interlocked.Exchange(ref closing,1)!=0) { await closed.Task.WaitAsync(TimeSpan.FromSeconds(15)); return; }
        td_send(id,"{\"@type\":\"close\"}");
        foreach(var p in pending.Values)p.TrySetException(new ObjectDisposedException(nameof(TdClient)));
        pending.Clear();
        await closed.Task.WaitAsync(TimeSpan.FromSeconds(15)); Update=null; Fault=null;
    }
}
