#!/bin/bash

# Script to install git hooks for the overlay-companion-mcp project
# Run this script from the project root to set up pre-commit hooks

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "Installing git hooks for overlay-companion-mcp..."

# Create pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash

# Pre-commit hook to detect project-breaking conflicts
# This hook runs before each commit to ensure the project builds successfully

echo "Running pre-commit checks..."

# Check if we're in the middle of a merge
if [ -f .git/MERGE_HEAD ]; then
    echo "Merge in progress - checking for unresolved conflicts..."

    # Check for conflict markers
    if git diff --cached --name-only | xargs grep -l "^<<<<<<< \|^=======$\|^>>>>>>> " 2>/dev/null; then
        echo "ERROR: Unresolved merge conflicts detected!"
        echo "Please resolve all conflicts before committing."
        exit 1
    fi
fi

# Check if the project builds successfully
echo "Testing project build..."
if command -v dotnet >/dev/null 2>&1; then
    if ! dotnet build src/OverlayCompanion.csproj --verbosity quiet; then
        echo "ERROR: Project build failed!"
        echo "Please fix build errors before committing."
        exit 1
    fi
else
    echo "WARNING: dotnet not found, skipping build check"
fi

echo "Pre-commit checks passed!"
exit 0
EOF

# Make the hook executable
chmod +x "$HOOKS_DIR/pre-commit"

echo "Git hooks installed successfully!"
echo "The pre-commit hook will now:"
echo "  - Check for unresolved merge conflicts"
echo "  - Verify the project builds successfully"
echo "  - Prevent commits that would break the build"
