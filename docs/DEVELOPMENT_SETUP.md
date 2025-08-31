# Development Setup Guide

## Automatic Setup for AllHands/AI Agents

**🚀 One-Command Setup (Recommended):**
```bash
# Clone and set up everything automatically
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
# Edit some files
vim src/Program.cs
vim tests/test_new_feature.py

# Add and commit (hooks run automatically)
git add .
git commit -m "feat: add multi-monitor support"
# ↑ Pre-commit hooks run here automatically
# ✅ All checks pass, commit succeeds
```

#### When Hooks Find Issues
```bash
git commit -m "feat: add new feature"

# Output:
# black....................................................................Failed
# - hook id: black
# - files were modified by this hook
# 
# isort....................................................................Passed
# flake8...................................................................Failed
# - hook id: flake8
# - exit code: 1
# 
# Line 42: E501 line too long (95 > 88 characters)

# Fix the issues (or let auto-fixers handle them)
git add .  # Add the auto-fixed files
git commit -m "feat: add new feature"
# ✅ Now it passes
```

#### Skip Hooks (Emergency Only)
```bash
# Skip all hooks (not recommended)
git commit -m "hotfix: emergency fix" --no-verify

# Skip specific hook
SKIP=flake8 git commit -m "feat: work in progress"
```

#### Run Hooks Manually
```bash
# Run all hooks on all files
pre-commit run --all-files

# Run specific hook
pre-commit run black --all-files

# Run hooks on specific files
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
# Reinstall hooks
pre-commit uninstall
pre-commit install
pre-commit install --hook-type commit-msg
```

#### Update Hooks
```bash
# Update to latest versions
pre-commit autoupdate

# Update specific hook
pre-commit autoupdate --repo https://github.com/psf/black
```

#### Performance Issues
```bash
# Run hooks in parallel (faster)
pre-commit run --all-files --show-diff-on-failure

# Skip slow hooks during development
SKIP=bandit,detect-secrets git commit -m "wip: development"
```

### IDE Integration

#### VS Code
Install the "Pre-commit" extension to see hook results in the editor.

#### JetBrains (Rider, PyCharm)
Enable "Run pre-commit hooks" in VCS settings.

#### Command Line
```bash
# Add to your shell profile (.bashrc, .zshrc)
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