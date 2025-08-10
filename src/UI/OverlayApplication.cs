using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OverlayCompanion.UI;

/// <summary>
/// Avalonia application with GUI for MCP server configuration
/// </summary>
public class OverlayApplication : Application
{
    public IServiceProvider? ServiceProvider { get; set; }

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            if (ServiceProvider != null)
            {
                // Create main window with dependency injection
                var logger = ServiceProvider.GetRequiredService<ILogger<MainWindow>>();
                var lifetime = ServiceProvider.GetRequiredService<IHostApplicationLifetime>();
                
                desktop.MainWindow = new MainWindow(ServiceProvider, logger, lifetime);
            }
            else
            {
                // Fallback without DI
                desktop.MainWindow = new MainWindow(null!, null!, null!);
            }
        }

        base.OnFrameworkInitializationCompleted();
    }
}