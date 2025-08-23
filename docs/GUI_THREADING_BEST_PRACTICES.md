# GUI Threading Best Practices

This document outlines the threading best practices implemented in the Overlay Companion MCP to prevent GUI freezing and ensure responsive user interfaces.

## 🚨 The Problem: GUI Thread Blocking

GUI applications have a **main UI thread** that handles all user interface updates. When long-running operations (like network requests) run on this thread, the entire UI becomes unresponsive - buttons don't work, windows can't be moved, and the app appears "frozen."

### Common Symptoms:
- App becomes completely unresponsive
- X button doesn't work
- Need to force-kill from taskbar
- Multiple button clicks queue up and execute all at once

## ✅ The Solution: Proper Async Threading

### 1. **Background Thread Execution**
```csharp
// ❌ BAD: Blocks UI thread
var result = await SomeNetworkOperation();

// ✅ GOOD: Run on background thread
var result = await Task.Run(async () => 
{
    return await SomeNetworkOperation().ConfigureAwait(false);
});
```

### 2. **UI Thread Marshaling with GLib.Idle.Add()**
```csharp
// ✅ Update UI from background thread safely
GLib.Idle.Add(() =>
{
    button.SetLabel("Updated!");
    button.SetSensitive(true);
    return false; // Don't repeat
});
```

### 3. **Operation Cancellation**
```csharp
// ✅ Implement timeouts and cancellation
private CancellationTokenSource? _cancellationTokenSource;

// Set up cancellation with timeout
_cancellationTokenSource = new CancellationTokenSource(TimeSpan.FromSeconds(30));

// Use in async operations
await SomeOperation(_cancellationTokenSource.Token);
```

### 4. **Prevent Multiple Concurrent Operations**
```csharp
// ✅ Use flags to prevent multiple operations
private bool _operationInProgress = false;

private async void OnButtonClick(object sender, EventArgs e)
{
    if (_operationInProgress) return; // Ignore if already running
    
    _operationInProgress = true;
    try
    {
        // Do work...
    }
    finally
    {
        _operationInProgress = false;
    }
}
```

## 🔧 GTK4-Specific Threading Tools

### **GLib.Idle.Add()**
- **Purpose**: Execute code on the main UI thread from background threads
- **Usage**: UI updates, dialog creation, button state changes
- **Return**: `false` to execute once, `true` to repeat

```csharp
// Execute on UI thread
GLib.Idle.Add(() =>
{
    label.SetText("Updated from background thread");
    return false; // Execute once
});
```

### **GLib.Timeout.Add()**
- **Purpose**: Execute code after a delay or repeatedly
- **Usage**: Delayed UI updates, periodic checks

```csharp
// Execute after 2 seconds
GLib.Timeout.Add(0, 2000, () =>
{
    button.SetLabel("Reset");
    return false; // Don't repeat
});
```

### **ConfigureAwait(false)**
- **Purpose**: Prevent deadlocks and improve performance
- **Usage**: All async calls in background threads

```csharp
// ✅ Use ConfigureAwait(false) in background threads
var result = await httpClient.GetStringAsync(url).ConfigureAwait(false);
```

## 📋 Implementation Checklist

### For Long-Running Operations:
- [ ] **Background Thread**: Use `Task.Run()` for CPU/IO intensive work
- [ ] **UI Marshaling**: Use `GLib.Idle.Add()` for UI updates from background threads
- [ ] **Cancellation**: Implement `CancellationTokenSource` with timeouts
- [ ] **Progress Feedback**: Update UI to show operation is in progress
- [ ] **Error Handling**: Catch exceptions and show user-friendly messages
- [ ] **State Management**: Prevent multiple concurrent operations
- [ ] **Resource Cleanup**: Dispose cancellation tokens and resources

### For Button Click Handlers:
```csharp
private async void OnButtonClick(object sender, EventArgs e)
{
    // 1. Check if operation already in progress
    if (_operationInProgress) return;
    
    var button = sender as Button;
    
    try
    {
        // 2. Set up cancellation and state
        _operationInProgress = true;
        _cancellationTokenSource = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        
        // 3. Update UI immediately
        GLib.Idle.Add(() =>
        {
            button?.SetLabel("Working...");
            button?.SetSensitive(false);
            return false;
        });
        
        // 4. Do work on background thread
        var result = await Task.Run(async () =>
        {
            return await DoWork().ConfigureAwait(false);
        }, _cancellationTokenSource.Token).ConfigureAwait(false);
        
        // 5. Update UI with results
        GLib.Idle.Add(() =>
        {
            ShowResults(result);
            return false;
        });
    }
    catch (OperationCanceledException)
    {
        // 6. Handle cancellation
        GLib.Idle.Add(() =>
        {
            ShowMessage("Operation cancelled");
            return false;
        });
    }
    catch (Exception ex)
    {
        // 7. Handle errors
        GLib.Idle.Add(() =>
        {
            ShowError(ex.Message);
            return false;
        });
    }
    finally
    {
        // 8. Always restore UI state
        _operationInProgress = false;
        GLib.Idle.Add(() =>
        {
            button?.SetLabel("Original Label");
            button?.SetSensitive(true);
            return false;
        });
    }
}
```

## 🎯 Key Principles

1. **Never block the UI thread** with long-running operations
2. **Always use background threads** for network/file operations
3. **Marshal UI updates** back to the main thread with `GLib.Idle.Add()`
4. **Implement cancellation** with reasonable timeouts
5. **Provide user feedback** during operations
6. **Handle errors gracefully** with user-friendly messages
7. **Prevent concurrent operations** with state flags
8. **Clean up resources** in finally blocks

## 🔍 Debugging Threading Issues

### Tools:
- **Logging**: Add detailed logging to track thread execution
- **GTK Inspector**: `GTK_DEBUG=interactive ./app` for runtime debugging
- **Process Monitor**: Watch for hanging processes
- **Thread Dumps**: Use debugger to see thread states

### Common Issues:
- **Deadlocks**: Usually caused by not using `ConfigureAwait(false)`
- **UI Freezing**: Long operations on main thread
- **Race Conditions**: Multiple operations modifying shared state
- **Memory Leaks**: Not disposing cancellation tokens

## 📚 Additional Resources

- [GTK4 Threading Documentation](https://docs.gtk.org/glib/main-loop.html)
- [.NET Async Best Practices](https://docs.microsoft.com/en-us/dotnet/csharp/async)
- [ConfigureAwait FAQ](https://devblogs.microsoft.com/dotnet/configureawait-faq/)

This implementation ensures the Overlay Companion MCP remains responsive even during update checks and other long-running operations.