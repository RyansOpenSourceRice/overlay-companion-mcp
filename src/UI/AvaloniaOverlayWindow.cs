using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Platform;
using OverlayCompanion.Models;
using OverlayCompanion.Services;
using System.Threading.Tasks;

namespace OverlayCompanion.UI;

/// <summary>
/// Avalonia-based overlay window implementation
/// Provides transparent overlay windows for screen annotation
/// </summary>
public class AvaloniaOverlayWindow : Window, IOverlayWindow
{
    private readonly OverlayElement _overlay;
    private Border? _border;
    private TextBlock? _label;

    public AvaloniaOverlayWindow(OverlayElement overlay)
    {
        _overlay = overlay;
        InitializeWindow();
        CreateContent();
    }

    private void InitializeWindow()
    {
        // Configure window properties for overlay
        WindowState = WindowState.Normal;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Topmost = true;
        ShowInTaskbar = false;
        CanResize = false;

        // Set position and size
        Position = new PixelPoint(_overlay.Bounds.X, _overlay.Bounds.Y);
        Width = _overlay.Bounds.Width;
        Height = _overlay.Bounds.Height;

        // Make window transparent and click-through
        Background = Brushes.Transparent;
        TransparencyLevelHint = new[] { WindowTransparencyLevel.Transparent };

        // Configure for click-through behavior
        ExtendClientAreaToDecorationsHint = true;
        ExtendClientAreaChromeHints = ExtendClientAreaChromeHints.NoChrome;
        ExtendClientAreaTitleBarHeightHint = 0;

        Title = $"Overlay-{_overlay.Id}";
    }

    private void CreateContent()
    {
        // Create border with overlay styling
        _border = new Border
        {
            BorderThickness = new Thickness(2),
            BorderBrush = GetBrushFromColor(_overlay.Color),
            Background = GetBrushFromColor(_overlay.Color, 0.3), // Semi-transparent fill
            CornerRadius = new CornerRadius(4)
        };

        // Add label if specified
        if (!string.IsNullOrEmpty(_overlay.Label))
        {
            _label = new TextBlock
            {
                Text = _overlay.Label,
                Foreground = Brushes.White,
                FontSize = 12,
                FontWeight = FontWeight.Bold,
                HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
                VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap
            };

            _border.Child = _label;
        }

        Content = _border;
    }

    private IBrush GetBrushFromColor(string colorName, double opacity = 1.0)
    {
        Color color;

        // Handle hex colors (#FF0000, #f00, etc.)
        if (colorName.StartsWith("#"))
        {
            try
            {
                color = Color.Parse(colorName);
            }
            catch
            {
                color = Colors.Yellow; // Default fallback
            }
        }
        else
        {
            // Handle named colors
            color = colorName.ToLower() switch
            {
                "red" => Colors.Red,
                "green" => Colors.Green,
                "blue" => Colors.Blue,
                "yellow" => Colors.Yellow,
                "orange" => Colors.Orange,
                "purple" => Colors.Purple,
                "cyan" => Colors.Cyan,
                "magenta" => Colors.Magenta,
                "white" => Colors.White,
                "black" => Colors.Black,
                "gray" or "grey" => Colors.Gray,
                "lime" => Colors.Lime,
                "pink" => Colors.Pink,
                "brown" => Colors.Brown,
                "navy" => Colors.Navy,
                "teal" => Colors.Teal,
                "silver" => Colors.Silver,
                _ => Colors.Yellow // Default
            };
        }

        if (opacity < 1.0)
        {
            color = Color.FromArgb((byte)(255 * opacity), color.R, color.G, color.B);
        }

        return new SolidColorBrush(color);
    }

    public async Task ShowAsync()
    {
        Show();
        await Task.CompletedTask;
    }

    public async Task HideAsync()
    {
        Hide();
        await Task.CompletedTask;
    }

    public async Task UpdatePositionAsync(ScreenRegion bounds)
    {
        Position = new PixelPoint(bounds.X, bounds.Y);
        Width = bounds.Width;
        Height = bounds.Height;
        await Task.CompletedTask;
    }

    public async Task UpdateAppearanceAsync(string color, string? label)
    {
        if (_border != null)
        {
            _border.BorderBrush = GetBrushFromColor(color);
            _border.Background = GetBrushFromColor(color, 0.3);
        }

        if (_label != null && label != null)
        {
            _label.Text = label;
        }

        await Task.CompletedTask;
    }

    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
        Dispose();
    }

    public void Dispose()
    {
        Close();
        GC.SuppressFinalize(this);
    }
}