#!/bin/bash

# Fix common markdown issues automatically

set -e

echo "🔧 Fixing common markdown issues..."

# Function to fix a single file
fix_file() {
    local file="$1"
    echo "  📝 Fixing $file..."

    # Create backup
    cp "$file" "$file.bak"

    # Fix emphasis style (asterisk to underscore for single emphasis)
    sed -i 's/\*\([^*]*\)\*/_\1_/g' "$file"

    # Add blank lines before lists (simple cases)
    sed -i '/^[^-*+[:space:]]/N;s/\n\([[:space:]]*[-*+]\)/\n\n\1/' "$file"

    # Add blank lines after lists (simple cases)
    sed -i '/^[[:space:]]*[-*+]/N;s/\n\([^[:space:]-*+]\)/\n\n\1/' "$file"

    # Add blank lines before headings
    sed -i '/^[^#[:space:]]/N;s/\n\(#\)/\n\n\1/' "$file"

    # Add blank lines after headings
    sed -i '/^#/N;s/\n\([^[:space:]#]\)/\n\n\1/' "$file"

    # Add blank lines before code blocks
    sed -i '/^[^`[:space:]]/N;s/\n\(```\)/\n\n\1/' "$file"

    # Add blank lines after code blocks
    sed -i '/^```$/N;s/\n\([^[:space:]`]\)/\n\n\1/' "$file"

    # Remove trailing spaces (simple)
    sed -i 's/[[:space:]]*$//' "$file"

    # Ensure single trailing newline
    sed -i -e :a -e '/^\s*$/{$d;N;ba' -e '}' "$file"
    echo "" >> "$file"

    echo "  ✅ Fixed $file"
}

# Fix main specification files
if [ -f "SPECIFICATION.md" ]; then
    fix_file "SPECIFICATION.md"
fi

if [ -f "MCP_SPECIFICATION.md" ]; then
    fix_file "MCP_SPECIFICATION.md"
fi

if [ -f "README.md" ]; then
    fix_file "README.md"
fi

if [ -f "temp/CONTINUATION_README.md" ]; then
    fix_file "temp/CONTINUATION_README.md"
fi

# Fix docs directory
if [ -d "docs" ]; then
    find docs -name "*.md" -type f | while read -r file; do
        fix_file "$file"
    done
fi

echo "✅ Markdown fixes completed"
echo "💡 Backup files created with .bak extension"
echo "🔍 Run markdown linting again to check results"
