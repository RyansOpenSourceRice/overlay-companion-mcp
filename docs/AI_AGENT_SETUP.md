[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

# AI Agent & AllHands Setup Specification

## Automatic Development Environment Setup

This repository is configured for **automatic setup** when working with AI agents and AllHands instances.

### Required Setup Command

**IMPORTANT:** Run this command immediately after cloning the repository:

```bash
./scripts/setup-dev-environment.sh
```

### What Gets Configured Automatically

#### 1. Pre-commit Hooks (Code Quality)
- **Black**: Python code formatting
- **isort**: Import sorting
- **flake8**: Style and syntax checking
- **mypy**: Type checking
- **bandit**: Security vulnerability scanning
- **safety**: Dependency security checking
- **pylint**: Code quality analysis
- **markdownlint**: Markdown formatting
- **detect-secrets**: Prevents credential commits
- **dotnet format**: C# code formatting

#### 2. Development Environment
- Python virtual environment (`tests/ai-gui/.venv`)
- All Python test dependencies installed
- .NET dependencies restored
- Security baseline created

#### 3. Quality Assurance
- Initial code quality checks run
- All linting tools configured and tested
- Git hooks installed and active

### Multi-Language Linting Strategy

This repository uses **multiple workflow files** approach (industry standard):

```
.github/workflows/
├── python-lint.yml     ✅ Comprehensive Python linting
├── csharp-lint.yml     ✅ C# formatting and analysis  
├── markdown-lint.yml   ✅ Documentation quality
└── ci-cd.yml          ✅ Build and deployment
```

**Benefits:**
- Language-specific triggers (only run when relevant files change)
- Parallel execution for faster CI
- Clear separation of concerns
- Easy maintenance and debugging

### Development Workflow

#### For AI Agents
1. **Clone repository**
2. **Run setup script**: `./scripts/setup-dev-environment.sh`
3. **Start development** - hooks run automatically on commit
4. **All code quality checks pass** before push

#### Pre-commit Hook Behavior
```bash
git add file.py
git commit -m "feat: add new feature"
# ↑ Hooks run automatically here
# ✅ Code formatting applied
# ✅ Security scanning passed
# ✅ Style checks passed
# ✅ Commit successful
```

#### If Hooks Find Issues
```bash
git commit -m "feat: add feature"
# ❌ black: Code formatting issues (auto-fixed)
# ❌ flake8: Line too long
# ❌ bandit: Potential security issue

# Fix issues or review auto-fixes
git add .  # Add auto-fixed files
git commit -m "feat: add feature"
# ✅ All checks pass
```

### File Structure for Development

```
overlay-companion-mcp/
├── .pre-commit-config.yaml          # Pre-commit configuration
├── scripts/setup-dev-environment.sh # Automatic setup script
├── docs/
│   ├── DEVELOPMENT_SETUP.md         # Detailed development guide
│   ├── AI_AGENT_SETUP.md           # This file - AI agent instructions
│   └── OPEN_SOURCE_LICENSES.md     # License compliance info
├── tests/ai-gui/
│   ├── .venv/                       # Python virtual environment
│   ├── requirements.txt             # Python dependencies
│   └── *.py                        # Test files
└── .github/workflows/
    ├── python-lint.yml              # Python quality checks
    ├── csharp-lint.yml              # C# quality checks
    └── markdown-lint.yml            # Documentation checks
```

### Quality Standards Enforced

#### Python Code
- **Formatting**: Black (88 char line length)
- **Import sorting**: isort (Black-compatible profile)
- **Style**: flake8 (PEP 8 compliance)
- **Type checking**: mypy (ignore missing imports)
- **Security**: bandit (vulnerability scanning)
- **Dependencies**: safety (known CVE checking)
- **Quality**: pylint (code analysis)

#### C# Code
- **Formatting**: dotnet format (Microsoft standards)
- **Analysis**: Built-in .NET analyzers
- **Security**: .NET security scanning

#### Markdown Documentation
- **Style**: markdownlint (consistent formatting)
- **Spelling**: cspell (spell checking)
- **Links**: markdown-link-check (broken link detection)

#### Git Commits
- **Format**: Conventional commits (feat:, fix:, docs:, etc.)
- **Security**: No secrets or credentials
- **File size**: No large files (>1MB)

### Troubleshooting

#### Setup Script Fails
```bash
# Check Python installation
python3 --version

# Check pip installation  
pip3 --version

# Manual pre-commit install
pip install pre-commit
pre-commit install
```

#### Pre-commit Issues
```bash
# Update hooks to latest versions
pre-commit autoupdate

# Run specific hook manually
pre-commit run black --all-files

# Skip hooks temporarily (emergency only)
git commit -m "hotfix: emergency" --no-verify
```

#### Python Environment Issues
```bash
# Recreate virtual environment
cd tests/ai-gui
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Integration with AllHands

**Expected behavior for AllHands instances:**

1. **Repository cloned** → Automatically run `./scripts/setup-dev-environment.sh`
2. **Development starts** → Pre-commit hooks active
3. **Code changes made** → Quality checks run on commit
4. **Push to GitHub** → CI/CD passes (code already validated)

### Benefits for AI Development

- ⚡ **Instant feedback** on code quality
- 🔧 **Automatic formatting** (no manual work)
- 🛡️ **Security scanning** (prevents credential leaks)
- 📝 **Consistent style** across all languages
- 🚀 **Faster CI** (pre-validated code)
- 👥 **Team consistency** (same standards for all contributors)

### Open Source Compliance

All development tools are **100% open source**:
- MIT License: pre-commit, black, flake8, mypy, safety
- Apache-2.0: bandit, detect-secrets
- GPL-2.0: pylint (development-only, doesn't affect distribution)

See [OPEN_SOURCE_LICENSES.md](OPEN_SOURCE_LICENSES.md) for complete license information.

### Success Indicators

✅ **Setup successful when:**
- `pre-commit --version` works
- `git commit` triggers hooks
- Python virtual environment exists at `tests/ai-gui/.venv`
- `dotnet restore` completes successfully
- Initial `pre-commit run --all-files` completes

✅ **Development ready when:**
- Code commits trigger automatic formatting
- Security scans run on every commit
- CI/CD workflows pass consistently
- All linting tools report clean code