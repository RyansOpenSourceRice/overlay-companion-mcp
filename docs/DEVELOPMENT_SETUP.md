# Development Setup Guide

<!-- markdownlint-disable MD051 -->
<!-- toc -->
- [Automatic Setup for AllHands/AI Agents](#automatic-setup-for-allhandsai-agents)
- [Clone and set up everything automatically](#clone-and-set-up-everything-automatically)
- [Manual Setup (Alternative)](#manual-setup-alternative)
  - [Prerequisites](#prerequisites)
  - [Step-by-Step Setup](#step-by-step-setup)
- [Pre-commit Hooks Setup](#pre-commit-hooks-setup)
  - [Installation](#installation)
  - [What Gets Checked](#what-gets-checked)
    - [Python Files (`.py`)](#python-files-py)
    - [C# Files (`.cs`, `.csproj`)](#c-files-cs-csproj)
    - [Markdown Files (`.md`)](#markdown-files-md)
    - [All Files](#all-files)
    - [Git Commits](#git-commits)
  - [Usage Examples](#usage-examples)
    - [Normal Development](#normal-development)
- [Edit some files](#edit-some-files)
- [Add and commit (hooks run automatically)](#add-and-commit-hooks-run-automatically)
- [↑ Pre-commit hooks run here automatically](#pre-commit-hooks-run-here-automatically)
- [✅ All checks pass, commit succeeds](#all-checks-pass-commit-succeeds)
  - [When Hooks Find Issues](#when-hooks-find-issues)
- [Output:](#output)
- [black....................................................................Failed](#blackfailed)
- [- hook id: black](#hook-id-black)
- [- files were modified by this hook](#files-were-modified-by-this-hook)
- [isort....................................................................Passed](#isortpassed)
- [flake8...................................................................Failed](#flake8failed)
- [- hook id: flake8](#hook-id-flake8)
- [- exit code: 1](#exit-code-1)
- [Line 42: E501 line too long (95 > 88 characters)](#line-42-e501-line-too-long-95-88-characters)
- [Fix the issues (or let auto-fixers handle them)](#fix-the-issues-or-let-auto-fixers-handle-them)
- [✅ Now it passes](#now-it-passes)
  - [Skip Hooks (Emergency Only)](#skip-hooks-emergency-only)
- [Skip all hooks (not recommended)](#skip-all-hooks-not-recommended)
- [Skip specific hook](#skip-specific-hook)
  - [Run Hooks Manually](#run-hooks-manually)
- [Run all hooks on all files](#run-all-hooks-on-all-files)
- [Run specific hook](#run-specific-hook)
- [Run hooks on specific files](#run-hooks-on-specific-files)
  - [Configuration](#configuration)
    - [Disable a Hook Temporarily](#disable-a-hook-temporarily)
    - [Exclude Files](#exclude-files)
    - [Add Custom Arguments](#add-custom-arguments)
  - [Troubleshooting](#troubleshooting)
    - [Hook Installation Issues](#hook-installation-issues)
- [Reinstall hooks](#reinstall-hooks)
  - [Update Hooks](#update-hooks)
- [Update to latest versions](#update-to-latest-versions)
- [Update specific hook](#update-specific-hook)
  - [Performance Issues](#performance-issues)
- [Run hooks in parallel (faster)](#run-hooks-in-parallel-faster)
- [Skip slow hooks during development](#skip-slow-hooks-during-development)
  - [IDE Integration](#ide-integration)
    - [VS Code](#vs-code)
    - [JetBrains (Rider, PyCharm)](#jetbrains-rider-pycharm)
    - [Command Line](#command-line)
- [Add to your shell profile (.bashrc, .zshrc)](#add-to-your-shell-profile-bashrc-zshrc)
  - [Team Workflow](#team-workflow)
  - [Benefits](#benefits)
- [Appendix: GUI threading best practices (consolidated)](#appendix-gui-threading-best-practices-consolidated)
- [GUI Threading Best Practices (Legacy Desktop)](#gui-threading-best-practices-legacy-desktop)
- [🚨 The Problem: GUI Thread Blocking](#the-problem-gui-thread-blocking)
  - [Common Symptoms:](#common-symptoms)
- [✅ The Solution: Proper Async Threading](#the-solution-proper-async-threading)
  - [1. **Background Thread Execution**](#1-background-thread-execution)
  - [2. **UI Thread Marshaling with GLib.Idle.Add()**](#2-ui-thread-marshaling-with-glibidleadd)
  - [3. **Operation Cancellation**](#3-operation-cancellation)
  - [4. **Prevent Multiple Concurrent Operations**](#4-prevent-multiple-concurrent-operations)
- [🔧 GTK4-Specific Threading Tools](#gtk4-specific-threading-tools)
  - [**GLib.Idle.Add()**](#glibidleadd)
  - [**GLib.Timeout.Add()**](#glibtimeoutadd)
  - [**ConfigureAwait(false)**](#configureawaitfalse)
- [📋 Implementation Checklist](#implementation-checklist)
  - [For Long-Running Operations:](#for-long-running-operations)
  - [For Button Click Handlers:](#for-button-click-handlers)
- [🎯 Key Principles](#key-principles)
- [🔍 Debugging Threading Issues](#debugging-threading-issues)
  - [Tools:](#tools)
  - [Common Issues:](#common-issues)
- [📚 Additional Resources](#additional-resources)
<!-- tocstop -->
<!-- markdownlint-enable MD051 -->

## Automatic Setup for AllHands/AI Agents

**🚀 One-Command Setup (Recommended):**
```bash
## Clone and set up everything automatically
git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp.git
cd overlay-companion-mcp
./scripts/setup-dev-environment.sh
```

This script automatically:
- ✅ Installs pre-commit hooks for code quality
- ✅ Sets up Python virtual environment for testing
- ✅ Installs all development dependencies
- ✅ Configures security scanning and formatting
- ✅ Runs initial code quality checks
- ✅ Restores .NET dependencies
- ✅ Creates secrets detection baseline

**For AllHands instances:** This setup script should be run automatically when starting work on this repository.

## Manual Setup (Alternative)

If the automatic setup fails or you prefer manual control:

### Prerequisites
- .NET 8.0 SDK
- Python 3.8+
- Git

### Step-by-Step Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp.git
   cd overlay-companion-mcp
   ```

2. **Install pre-commit:**
   ```bash
   pip install pre-commit
   ```

3. **Install hooks:**
   ```bash
   pre-commit install
   pre-commit install --hook-type commit-msg
   ```

4. **Set up Python test environment:**
   ```bash
   cd tests/ai-gui
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ../..
   ```

5. **Restore .NET dependencies:**
   ```bash
   cd src
   dotnet restore
   cd ..
   ```

6. **Run initial checks:**
   ```bash
   pre-commit run --all-files
   ```

## Pre-commit Hooks Setup

Pre-commit hooks run automatically before each commit to ensure code quality and consistency.

### Installation

1. **Install pre-commit** (one-time setup):
   ```bash
   pip install pre-commit
   ```

2. **Install the hooks** (one-time per repository):
   ```bash
   cd overlay-companion-mcp
   pre-commit install
   pre-commit install --hook-type commit-msg
   ```

3. **Test the setup**:
   ```bash
   pre-commit run --all-files
   ```

### What Gets Checked

#### Python Files (`.py`)
- **Black**: Code formatting (auto-fixes)
- **isort**: Import sorting (auto-fixes)  
- **flake8**: Style and syntax checking
- **bandit**: Security vulnerability scanning

#### C# Files (`.cs`, `.csproj`)
- **dotnet format**: Code formatting (auto-fixes)

#### Markdown Files (`.md`)
- **markdownlint**: Markdown linting and formatting

#### All Files
- **Trailing whitespace**: Removes extra spaces
- **End of file**: Ensures files end with newline
- **Large files**: Prevents committing files >1MB
- **Secrets detection**: Prevents committing API keys/passwords
- **YAML/JSON validation**: Ensures valid syntax

#### Git Commits
- **Conventional commits**: Enforces commit message format
  - ✅ `feat: add new overlay tool`
  - ✅ `fix: resolve screenshot capture bug`
  - ✅ `docs: update API documentation`
  - ❌ `updated stuff`

### Usage Examples

#### Normal Development
```bash
## Edit some files
vim src/Program.cs
vim tests/test_new_feature.py

## Add and commit (hooks run automatically)
git add .
git commit -m "feat: add multi-monitor support"
## ↑ Pre-commit hooks run here automatically
## ✅ All checks pass, commit succeeds
```

#### When Hooks Find Issues
```bash
git commit -m "feat: add new feature"

## Output:
## black....................................................................Failed
## - hook id: black
## - files were modified by this hook
## 
## isort....................................................................Passed
## flake8...................................................................Failed
## - hook id: flake8
## - exit code: 1
## 
## Line 42: E501 line too long (95 > 88 characters)

## Fix the issues (or let auto-fixers handle them)
git add .  # Add the auto-fixed files
git commit -m "feat: add new feature"
## ✅ Now it passes
```

#### Skip Hooks (Emergency Only)
```bash
## Skip all hooks (not recommended)
git commit -m "hotfix: emergency fix" --no-verify

## Skip specific hook
SKIP=flake8 git commit -m "feat: work in progress"
```

#### Run Hooks Manually
```bash
## Run all hooks on all files
pre-commit run --all-files

## Run specific hook
pre-commit run black --all-files

## Run hooks on specific files
pre-commit run --files src/Program.cs tests/test_*.py
```

### Configuration

The configuration is in `.pre-commit-config.yaml`. You can:

#### Disable a Hook Temporarily
```yaml
- repo: https://github.com/pycqa/flake8
  rev: 7.0.0
  hooks:
    - id: flake8
      # Temporarily disable
      stages: [manual]
```

#### Exclude Files
```yaml
- repo: https://github.com/pycqa/bandit
  rev: 1.7.5
  hooks:
    - id: bandit
      exclude: ^tests/|^scripts/legacy/
```

#### Add Custom Arguments
```yaml
- repo: https://github.com/psf/black
  rev: 23.12.1
  hooks:
    - id: black
      args: ["--line-length=100"]
```

### Troubleshooting

#### Hook Installation Issues
```bash
## Reinstall hooks
pre-commit uninstall
pre-commit install
pre-commit install --hook-type commit-msg
```

#### Update Hooks
```bash
## Update to latest versions
pre-commit autoupdate

## Update specific hook
pre-commit autoupdate --repo https://github.com/psf/black
```

#### Performance Issues
```bash
## Run hooks in parallel (faster)
pre-commit run --all-files --show-diff-on-failure

## Skip slow hooks during development
SKIP=bandit,detect-secrets git commit -m "wip: development"
```

### IDE Integration

#### VS Code
Install the "Pre-commit" extension to see hook results in the editor.

#### JetBrains (Rider, PyCharm)
Enable "Run pre-commit hooks" in VCS settings.

#### Command Line
```bash
## Add to your shell profile (.bashrc, .zshrc)
alias pc="pre-commit run --all-files"
alias pcu="pre-commit autoupdate"
```

### Team Workflow

1. **First-time contributors**:
   ```bash
   git clone https://github.com/RyansOpenSourceRice/overlay-companion-mcp
   cd overlay-companion-mcp
   pip install pre-commit
   pre-commit install
   pre-commit install --hook-type commit-msg
   ```

2. **Regular development**:
   - Hooks run automatically on every commit
   - No additional steps needed
   - Code is automatically formatted and checked

3. **CI/CD integration**:
   - Pre-commit hooks catch issues locally
   - GitHub Actions runs the same checks
   - Faster CI builds because code is already clean

### Benefits

- ⚡ **Instant feedback** instead of waiting for CI
- 🔧 **Auto-formatting** keeps code consistent
- 🛡️ **Security scanning** prevents credential leaks
- 📝 **Consistent commits** with conventional commit format
- 🚀 **Faster CI** because code is pre-validated
- 👥 **Team consistency** regardless of IDE/editor choice

---
## Appendix: GUI threading best practices (consolidated)
## GUI Threading Best Practices (Legacy Desktop)

Note: The project is now web-only. This document is preserved for historical context and applies only to the former GTK/Avalonia desktop UI paths.

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
