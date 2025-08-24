using System;

namespace OverlayCompanion.Models;

/// <summary>
/// Represents a point on the screen for overlay positioning
/// Extracted and generalized from GraphicalJobApplicationGuidanceSystem
/// </summary>
public record ScreenPoint(int X, int Y);

/// <summary>
/// Represents a rectangular region on the screen
/// </summary>
public record ScreenRegion(int X, int Y, int Width, int Height)
{
    public ScreenPoint TopLeft => new(X, Y);
    public ScreenPoint BottomRight => new(X + Width, Y + Height);
    public ScreenPoint Center => new(X + Width / 2, Y + Height / 2);
}

/// <summary>
/// Represents a screenshot with metadata
/// </summary>
public class Screenshot
{
    public byte[] ImageData { get; set; } = Array.Empty<byte>();
    public int Width { get; set; }
    public int Height { get; set; }
    public int MonitorIndex { get; set; }
    public double DisplayScale { get; set; } = 1.0;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public ScreenRegion? CaptureRegion { get; set; }

    public string ToBase64() => Convert.ToBase64String(ImageData);
}

/// <summary>
/// Represents an overlay element on the screen
/// </summary>
public class OverlayElement
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public ScreenRegion Bounds { get; set; } = new(0, 0, 50, 50);
    public string Color { get; set; } = "Yellow";
    public string? Label { get; set; }
    public int TemporaryMs { get; set; } = 0; // 0 = permanent
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int MonitorIndex { get; set; } = 0;
    public bool ClickThrough { get; set; } = true; // Enable click-through by default
    public double Opacity { get; set; } = 0.5; // 0.0 transparent, 1.0 opaque
}

/// <summary>
/// Operational modes for the overlay companion
/// </summary>
public enum OperationalMode
{
    Passive,    // View only, no actions
    Assist,     // Suggest actions, require confirmation
    Autopilot,  // Execute actions with user oversight
    Composing,  // Content creation mode
    Custom      // User-defined mode
}

/// <summary>
/// Input event data
/// </summary>
public class InputEvent
{
    public ScreenPoint Position { get; set; } = new(0, 0);
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string EventType { get; set; } = string.Empty; // "click", "move", "key"
    public string? Data { get; set; } // Additional event data
}

/// <summary>
/// Information about a monitor/display
/// </summary>
public class MonitorInfo
{
    public int Index { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Width { get; set; }
    public int Height { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public bool IsPrimary { get; set; }
    public double Scale { get; set; } = 1.0;
    public double RefreshRate { get; set; } = 60.0;
}
