// Temporary stub implementations for GTK4 types until runtime environment is properly configured
// This allows the project to compile and run in headless mode while preserving the GTK4 migration architecture

using System;

namespace GirCore.Gtk
{
    public class ApplicationWindow : IDisposable
    {
        public static ApplicationWindow New(Application app) => new ApplicationWindow();
        public void SetTitle(string title) { }
        public void SetDefaultSize(int width, int height) { }
        public void SetResizable(bool resizable) { }
        public void SetDecorated(bool decorated) { }
        public void SetModal(bool modal) { }
        public void SetChild(object widget) { }
        public void SetVisible(bool visible) { }
        public void Close() { }
        public event EventHandler? OnRealize;
        public event EventHandler? OnShow;
        public event Func<object, EventArgs, bool>? OnCloseRequest;
        public GirCore.Gdk.Surface? GetSurface() => null;
        public void Dispose() { }
    }

    public class DrawingArea : IDisposable
    {
        public static DrawingArea New() => new DrawingArea();
        public void SetSizeRequest(int width, int height) { }
        public void SetDrawFunc(Action<DrawingArea, GirCore.Cairo.Context, int, int, IntPtr> callback, IntPtr userData, Action? destroy) { }
        public void QueueDraw() { }
        public void Dispose() { }
    }

    public class Application : IDisposable
    {
        public static Application New(string appId, GirCore.Gio.ApplicationFlags flags) => new Application();
        public void Run(int argc, string[]? argv) { }
        public void Quit() { }
        public event EventHandler? OnActivate;
        public event EventHandler? OnStartup;
        public event EventHandler? OnShutdown;
        public void Dispose() { }
    }

    public class Notebook : IDisposable
    {
        public static Notebook New() => new Notebook();
        public void SetScrollable(bool scrollable) { }
        public void AppendPage(Box content, Label label) { }
        public void Dispose() { }
    }

    public class Box : IDisposable
    {
        public static Box New(Orientation orientation, int spacing) => new Box();
        public void SetMarginTop(int margin) { }
        public void SetMarginBottom(int margin) { }
        public void SetMarginStart(int margin) { }
        public void SetMarginEnd(int margin) { }
        public void Append(object widget) { }
        public void Dispose() { }
    }

    public class Label : IDisposable
    {
        public static Label New(string text) => new Label();
        public void SetMarkup(string markup) { }
        public void SetText(string text) { }
        public void SetXalign(float align) { }
        public void Dispose() { }
    }

    public class Button : IDisposable
    {
        public static Button NewWithLabel(string label) => new Button();
        public void SetLabel(string label) { }
        public event EventHandler? OnClicked;
        public void Dispose() { }
    }

    public class Entry : IDisposable
    {
        public static Entry New() => new Entry();
        public void SetText(string text) { }
        public string GetText() => "";
        public void Dispose() { }
    }

    public class TextView : IDisposable
    {
        public static TextView New() => new TextView();
        public void SetEditable(bool editable) { }
        public void Dispose() { }
    }

    public class ListBox : IDisposable
    {
        public static ListBox New() => new ListBox();
        public void Append(ListBoxRow row) { }
        public void Dispose() { }
    }

    public class ListBoxRow : IDisposable
    {
        public static ListBoxRow New() => new ListBoxRow();
        public void SetChild(object widget) { }
        public void Dispose() { }
    }

    public class ScrolledWindow : IDisposable
    {
        public static ScrolledWindow New() => new ScrolledWindow();
        public void SetChild(object widget) { }
        public void SetSizeRequest(int width, int height) { }
        public void Dispose() { }
    }

    public enum Orientation
    {
        Horizontal,
        Vertical
    }

    public static class Functions
    {
        public static void Init()
        {
            Console.WriteLine("GTK4 stub initialized (headless mode)");
        }
    }
}

namespace GirCore.Gdk
{
    public class Surface
    {
        public void SetInputRegion(object? region)
        {
            Console.WriteLine("GTK4 stub: SetInputRegion called (click-through enabled)");
        }
    }
}

namespace GirCore.Cairo
{
    public class Context
    {
        public void SetSourceRgba(double r, double g, double b, double a) { }
        public void Rectangle(double x, double y, double width, double height) { }
        public void Fill() { }
        public void MoveTo(double x, double y) { }
        public void ShowText(string text) { }
        public void SetLineWidth(double width) { }
        public void Stroke() { }
    }
}

namespace GirCore.Gio
{
    public enum ApplicationFlags
    {
        FlagsNone = 0
    }
}

namespace GirCore.GLib
{
    public static class Functions
    {
        public static bool IdleAdd(uint priority, Func<bool> function, IntPtr data) => false;
        public static bool IdleAdd(Func<bool> function) => false;
    }
}
