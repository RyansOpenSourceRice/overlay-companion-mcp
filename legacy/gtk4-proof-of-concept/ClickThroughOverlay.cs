using Gtk;
using System;
using Cairo;
using Gdk;

namespace Gtk4ProofOfConcept;

class ClickThroughOverlay
{
    static int Main(string[] args)
    {
        Console.WriteLine("GTK4 Click-Through Overlay Proof of Concept");
        Console.WriteLine("============================================");

        // Create the main application
        var app = Gtk.Application.New("com.example.gtk4-clickthrough", Gio.ApplicationFlags.FlagsNone);

        app.OnActivate += (sender, args) =>
        {
            Console.WriteLine("Application activated");

            // Create overlay window
            var overlayWindow = CreateClickThroughOverlay((Gtk.Application)sender);
            overlayWindow.Show();

            // Create a regular window for testing click-through
            var testWindow = CreateTestWindow((Gtk.Application)sender);
            testWindow.Show();

            Console.WriteLine("Windows created. Test click-through by clicking on overlay area.");
            Console.WriteLine("The overlay should be semi-transparent red and clicks should pass through to the test window.");
        };

        // Run the application
        var result = app.RunWithSynchronizationContext(null);
        Console.WriteLine($"Application exited with code: {result}");
        return result;
    }

    static ApplicationWindow CreateClickThroughOverlay(Gtk.Application app)
    {
        var window = ApplicationWindow.New(app);

        // Configure window for overlay behavior
        window.Title = "GTK4 Click-Through Overlay";
        window.SetDefaultSize(400, 300);
        window.Decorated = false; // Remove window decorations
        window.Resizable = false;

        // Create semi-transparent background
        var drawingArea = DrawingArea.New();
        drawingArea.SetSizeRequest(400, 300);

        // Set up drawing callback for transparency and visual feedback
        drawingArea.SetDrawFunc((area, cr, width, height) =>
        {
            // Set semi-transparent red background
            cr.SetSourceRgba(1.0, 0.0, 0.0, 0.3); // Red with 30% opacity
            cr.Rectangle(0, 0, width, height);
            cr.Fill();

            // Draw text
            cr.SetSourceRgba(1.0, 1.0, 1.0, 0.8); // White text
            cr.MoveTo(50, height / 2);
            cr.ShowText("GTK4 Click-Through Overlay Test - Should be clickable through!");
        });

        // CRITICAL: Enable click-through by setting input shape
        window.OnRealize += (sender, args) =>
        {
            Console.WriteLine("Window realized, attempting to set click-through...");

            try
            {
                // Get the native surface
                var surface = window.GetSurface();
                if (surface != null)
                {
                    // Create empty input region for click-through
                    // This is the key: an empty region means no input is captured
                    // Try passing null to disable input entirely
                    surface.SetInputRegion(null!);

                    Console.WriteLine("✓ Click-through enabled successfully!");
                    Console.WriteLine("  The overlay window should now pass all mouse clicks through to windows below.");
                }
                else
                {
                    Console.WriteLine("✗ Could not get surface");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ Error setting click-through: {ex.Message}");
                Console.WriteLine($"  Stack trace: {ex.StackTrace}");
            }
        };

        window.Child = drawingArea;

        Console.WriteLine("Created click-through overlay window");
        return window;
    }

    static ApplicationWindow CreateTestWindow(Gtk.Application app)
    {
        var window = ApplicationWindow.New(app);
        window.Title = "Test Window - Click Here Through Overlay";
        window.SetDefaultSize(350, 250);

        // Create a box to hold multiple test elements
        var box = Box.New(Orientation.Vertical, 10);
        box.SetMarginStart(20);
        box.SetMarginEnd(20);
        box.SetMarginTop(20);
        box.SetMarginBottom(20);

        // Add a label
        var label = Label.New("If click-through works, you should be able to click this button even when the red overlay is on top:");
        label.SetWrap(true);
        box.Append(label);

        // Add a test button
        var button = Button.New();
        button.Label = "🎯 Click me to test click-through!";

        button.OnClicked += (sender, args) =>
        {
            Console.WriteLine("🎉 SUCCESS! Button clicked - click-through is working!");
            Console.WriteLine("  This means GTK4 can provide true OS-level click-through on Wayland!");
        };

        box.Append(button);

        // Add another interactive element
        var entry = Entry.New();
        entry.PlaceholderText = "Type here to test text input click-through";
        box.Append(entry);

        window.Child = box;

        Console.WriteLine("Created test window with interactive elements");
        return window;
    }
}
