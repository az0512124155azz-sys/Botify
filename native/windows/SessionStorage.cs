using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BotHub;
public static class SessionStorage
{
    public static string Root { get; }=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BotHub");
    public static T? Read<T>(string name)
    {
        var path=Path.Combine(Root,name);if(!File.Exists(path))return default;
        var clear=ProtectedData.Unprotect(File.ReadAllBytes(path),null,DataProtectionScope.CurrentUser);
        try{return JsonSerializer.Deserialize<T>(clear);}finally{CryptographicOperations.ZeroMemory(clear);}
    }
    public static void Save<T>(string name,T value)
    {
        Directory.CreateDirectory(Root);var clear=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value));
        try {var encrypted=ProtectedData.Protect(clear,null,DataProtectionScope.CurrentUser);var path=Path.Combine(Root,name);File.WriteAllBytes(path+".tmp",encrypted);File.Move(path+".tmp",path,true);}
        finally{CryptographicOperations.ZeroMemory(clear);}
    }
    public static string DatabaseKey()
    {
        var key=Read<string>("database-key.dpapi");if(key!=null)return key;
        // Never replace an existing database's missing key silently.
        if(Directory.Exists(Path.Combine(Root,"database")))throw new InvalidOperationException("The database encryption key is missing. Restore the device key or move the old database before creating a new session.");
        key=Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));Save("database-key.dpapi",key);return key;
    }
}
