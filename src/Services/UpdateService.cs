using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace OverlayCompanion.Services;

/// <summary>
/// Service for checking and managing AppImage updates
/// </summary>
public class UpdateService
{
    private readonly ILogger<UpdateService> _logger;
    private readonly HttpClient _httpClient;
    private const string GITHUB_API_URL = "https://api.github.com/repos/RyansOpenSauceRice/overlay-companion-mcp/releases/latest";
    
    public UpdateService(ILogger<UpdateService> logger, HttpClient httpClient)
    {
        _logger = logger;
        _httpClient = httpClient;
    }

    /// <summary>
    /// Check if running as AppImage
    /// </summary>
    public bool IsRunningAsAppImage()
    {
        return !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("APPIMAGE"));
    }

    /// <summary>
    /// Get current AppImage path
    /// </summary>
    public string? GetAppImagePath()
    {
        return Environment.GetEnvironmentVariable("APPIMAGE");
    }

    /// <summary>
    /// Check for available updates
    /// </summary>
    public async Task<UpdateInfo?> CheckForUpdatesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            if (!IsRunningAsAppImage())
            {
                _logger.LogInformation("Not running as AppImage, update checking disabled");
                return null;
            }

            _logger.LogInformation("Checking for updates...");
            
            // Add timeout to HTTP request
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(15)); // 15 second HTTP timeout
            
            var response = await _httpClient.GetStringAsync(GITHUB_API_URL, timeoutCts.Token);
            var release = JsonSerializer.Deserialize<GitHubRelease>(response);
            
            if (release == null)
            {
                _logger.LogWarning("Failed to parse GitHub release information");
                return null;
            }

            var currentVersion = GetCurrentVersion();
            var latestVersion = release.TagName?.TrimStart('v');
            
            if (string.IsNullOrEmpty(latestVersion) || string.IsNullOrEmpty(currentVersion))
            {
                _logger.LogWarning("Could not determine version information");
                return null;
            }

            var updateAvailable = IsNewerVersion(latestVersion, currentVersion);
            
            return new UpdateInfo
            {
                CurrentVersion = currentVersion,
                LatestVersion = latestVersion,
                UpdateAvailable = updateAvailable,
                ReleaseUrl = release.HtmlUrl,
                ReleaseNotes = release.Body,
                PublishedAt = release.PublishedAt
            };
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Update check was cancelled");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check for updates");
            return null;
        }
    }

    /// <summary>
    /// Update the AppImage using AppImageUpdate
    /// </summary>
    public async Task<bool> UpdateAppImageAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            if (!IsRunningAsAppImage())
            {
                _logger.LogWarning("Not running as AppImage, cannot update");
                return false;
            }

            var appImagePath = GetAppImagePath();
            if (string.IsNullOrEmpty(appImagePath))
            {
                _logger.LogError("Could not determine AppImage path");
                return false;
            }

            // Check if AppImageUpdate is available
            if (!IsAppImageUpdateAvailable())
            {
                _logger.LogError("AppImageUpdate is not installed. Please install it first");
                return false;
            }

            _logger.LogInformation("Starting AppImage update...");
            
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "appimageupdate",
                    Arguments = $"\"{appImagePath}\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            
            // Create tasks for reading output and waiting for exit
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();
            var waitTask = process.WaitForExitAsync(cancellationToken);
            
            // Wait for all tasks to complete or cancellation
            await Task.WhenAll(outputTask, errorTask, waitTask);
            
            var output = await outputTask;
            var error = await errorTask;
            
            if (process.ExitCode == 0)
            {
                _logger.LogInformation("AppImage updated successfully");
                _logger.LogInformation("Update output: {Output}", output);
                return true;
            }
            else
            {
                _logger.LogError("AppImage update failed with exit code {ExitCode}", process.ExitCode);
                _logger.LogError("Update error: {Error}", error);
                return false;
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("AppImage update was cancelled");
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update AppImage");
            return false;
        }
    }

    /// <summary>
    /// Check if AppImageUpdate is available
    /// </summary>
    public bool IsAppImageUpdateAvailable()
    {
        try
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "appimageupdate",
                    Arguments = "--version",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                }
            };

            process.Start();
            process.WaitForExit(5000); // 5 second timeout
            
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private string GetCurrentVersion()
    {
        // Try to get version from assembly or environment
        var version = typeof(UpdateService).Assembly.GetName().Version?.ToString();
        if (!string.IsNullOrEmpty(version))
        {
            return version;
        }

        // Fallback to date-based version
        return DateTime.Now.ToString("yyyy.MM.dd");
    }

    private bool IsNewerVersion(string latest, string current)
    {
        try
        {
            // Simple version comparison for date-based versions (YYYY.MM.DD format)
            if (DateTime.TryParse(latest.Replace('.', '-'), out var latestDate) &&
                DateTime.TryParse(current.Replace('.', '-'), out var currentDate))
            {
                return latestDate > currentDate;
            }

            // Fallback to string comparison
            return string.Compare(latest, current, StringComparison.OrdinalIgnoreCase) > 0;
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>
/// Information about available updates
/// </summary>
public class UpdateInfo
{
    public string CurrentVersion { get; set; } = "";
    public string LatestVersion { get; set; } = "";
    public bool UpdateAvailable { get; set; }
    public string? ReleaseUrl { get; set; }
    public string? ReleaseNotes { get; set; }
    public DateTime? PublishedAt { get; set; }
}

/// <summary>
/// GitHub release information
/// </summary>
internal class GitHubRelease
{
    public string? TagName { get; set; }
    public string? Name { get; set; }
    public string? Body { get; set; }
    public string? HtmlUrl { get; set; }
    public DateTime? PublishedAt { get; set; }
}