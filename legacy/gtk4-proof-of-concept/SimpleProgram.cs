using Gtk;
using System;

namespace Gtk4ProofOfConcept;

class SimpleProgram
{
    static int Main(string[] args)
    {
        Console.WriteLine("GTK4 Simple Test");
        Console.WriteLine("================");

        // Create the main application
        var app = Gtk.Application.New("com.example.gtk4-simple", Gio.ApplicationFlags.FlagsNone);

        app.OnActivate += (sender, args) =>
        {
            Console.WriteLine("Application activated");

            // Create a simple window
            var window = ApplicationWindow.New((Gtk.Application)sender);
            window.Title = "GTK4 Simple Test";
            window.SetDefaultSize(300, 200);

            var button = Button.New();
            button.Label = "Hello GTK4!";

            button.OnClicked += (s, a) =>
            {
                Console.WriteLine("Button clicked!");
            };

            window.Child = button;
            window.Show();

            Console.WriteLine("Simple window created and shown");
        };

        // Run the application
        var result = app.RunWithSynchronizationContext(null);
        Console.WriteLine($"Application exited with code: {result}");
        return result;
    }
}
