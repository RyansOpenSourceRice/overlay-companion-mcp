[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io)

# Open Source Licenses for Development Tools

All tools used in this project's development workflow are open source. Here's the complete list:

## Pre-commit Framework
- **Tool**: pre-commit
- **License**: MIT License
- **Repository**: https://github.com/pre-commit/pre-commit
- **Description**: Framework for managing git pre-commit hooks

## Python Tools

### Code Formatting
- **Black**: MIT License - https://github.com/psf/black
  - Python code formatter, maintained by Python Software Foundation
- **isort**: MIT License - https://github.com/pycqa/isort  
  - Import sorting utility

### Code Quality
- **flake8**: MIT License - https://github.com/pycqa/flake8
  - Style guide enforcement and linting
- **pylint**: GPL-2.0 License - https://github.com/pylint-dev/pylint
  - Code analysis and quality checking
- **mypy**: MIT License - https://github.com/python/mypy
  - Static type checker, maintained by Python core team

### Security
- **bandit**: Apache-2.0 License - https://github.com/pycqa/bandit
  - Security linter for Python, maintained by Python Code Quality Authority
- **safety**: MIT License - https://github.com/pyupio/safety
  - Dependency vulnerability scanner
- **detect-secrets**: Apache-2.0 License - https://github.com/Yelp/detect-secrets
  - Prevents secrets from being committed, by Yelp

## General File Tools
- **pre-commit-hooks**: MIT License - https://github.com/pre-commit/pre-commit-hooks
  - Collection of useful pre-commit hooks (trailing whitespace, JSON validation, etc.)

## Markdown Tools
- **markdownlint-cli**: MIT License - https://github.com/igorshubovych/markdownlint-cli
  - Markdown linting and style checking

## Git Tools
- **conventional-pre-commit**: MIT License - https://github.com/compilerla/conventional-pre-commit
  - Enforces conventional commit message format

## C# Tools (Microsoft Open Source)
- **dotnet format**: MIT License - https://github.com/dotnet/format
  - C# code formatter, part of .NET SDK
- **dotnet CLI**: MIT License - https://github.com/dotnet/core
  - .NET command-line interface

## GitHub Actions (Used in CI/CD)
- **actions/checkout**: MIT License - https://github.com/actions/checkout
- **actions/setup-python**: MIT License - https://github.com/actions/setup-python
- **actions/setup-dotnet**: MIT License - https://github.com/actions/setup-dotnet
- **actions/cache**: MIT License - https://github.com/actions/cache
- **actions/upload-artifact**: MIT License - https://github.com/actions/upload-artifact

## License Summary

| License Type | Count | Tools |
|--------------|-------|-------|
| MIT License | 12 | black, isort, flake8, mypy, safety, pre-commit, markdownlint-cli, conventional-pre-commit, dotnet format, GitHub Actions |
| Apache-2.0 | 2 | bandit, detect-secrets |
| GPL-2.0 | 1 | pylint |

## Compliance Notes

### MIT License
- ✅ **Commercial use allowed**
- ✅ **Modification allowed** 
- ✅ **Distribution allowed**
- ✅ **Private use allowed**
- ⚠️ **License and copyright notice required**

### Apache-2.0 License  
- ✅ **Commercial use allowed**
- ✅ **Modification allowed**
- ✅ **Distribution allowed** 
- ✅ **Patent use allowed**
- ⚠️ **License and copyright notice required**

### GPL-2.0 License (pylint only)
- ✅ **Commercial use allowed**
- ✅ **Modification allowed**
- ✅ **Distribution allowed**
- ⚠️ **Source code must be made available**
- ⚠️ **License and copyright notice required**

**Note**: Since pylint is only used as a development tool and not distributed with the application, GPL-2.0 requirements don't affect the main project licensing.

## Verification Commands

You can verify the licenses of installed packages:

```bash
# Check Python package licenses
pip-licenses --format=table

# Check specific package license
pip show black | grep License

# View license files
python -c "import black; print(black.__file__)" | xargs dirname | xargs ls -la
```

## Alternative Tools (If Needed)

If any licensing concerns arise, here are alternative open source tools:

| Current Tool | Alternative | License |
|--------------|-------------|---------|
| pylint | ruff | MIT License |
| bandit | semgrep | LGPL-2.1 |
| safety | pip-audit | Apache-2.0 |

## Corporate Policy Compliance

This toolchain is suitable for:
- ✅ **Enterprise environments**
- ✅ **Commercial projects**
- ✅ **Government projects**
- ✅ **Academic institutions**
- ✅ **Open source projects**

All tools are either:
1. **Permissive licenses** (MIT, Apache-2.0) - no restrictions on use
2. **Development-only tools** (GPL tools don't affect distribution)
3. **Widely adopted** by major corporations (Google, Microsoft, Facebook)

## Community & Maintenance

All tools are:
- ✅ **Actively maintained** by reputable organizations
- ✅ **Large community** with thousands of contributors
- ✅ **Regular security updates**
- ✅ **Professional support available** (if needed)
- ✅ **Used by major tech companies**

## Conclusion

The entire development toolchain is **100% open source** with business-friendly licenses. No proprietary tools, no vendor lock-in, no licensing fees.