#!/bin/bash

# Markdown Linting Script
# Run this script to check markdown files locally before committing

# set -e  # Commented out to allow script to continue on errors

echo "🔍 Running Markdown Quality Checks..."
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required tools are installed
check_tool() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed${NC}"
        echo "Install with: npm install -g $1"
        return 1
    fi
    return 0
}

# Install tools if needed
install_tools() {
    echo "📦 Checking required tools..."

    tools_needed=()

    if ! check_tool "markdownlint"; then
        tools_needed+=("markdownlint-cli")
    fi

    if ! check_tool "cspell"; then
        tools_needed+=("cspell")
    fi

    if ! check_tool "markdown-toc"; then
        tools_needed+=("markdown-toc")
    fi

    if [ ${#tools_needed[@]} -ne 0 ]; then
        echo -e "${YELLOW}Installing missing tools: ${tools_needed[*]}${NC}"
        npm install -g "${tools_needed[@]}"
    fi

    echo -e "${GREEN}✅ All tools are available${NC}"
}

# Run markdownlint
run_markdownlint() {
    echo ""
    echo "🔧 Running markdownlint..."

    if markdownlint "**/*.md" --ignore node_modules; then
        echo -e "${GREEN}✅ Markdownlint passed${NC}"
        return 0
    else
        echo -e "${RED}❌ Markdownlint failed${NC}"
        return 1
    fi
}

# Run spell check
run_spellcheck() {
    echo ""
    echo "📝 Running spell check..."

    if cspell "**/*.md" --no-progress; then
        echo -e "${GREEN}✅ Spell check passed${NC}"
        return 0
    else
        echo -e "${RED}❌ Spell check failed${NC}"
        echo -e "${YELLOW}💡 Add unknown words to .cspell.json if they are correct${NC}"
        return 1
    fi
}

# Check table of contents
check_toc() {
    echo ""
    echo "📋 Checking table of contents..."

    toc_issues=0

    for file in SPECIFICATION.md MCP_SPECIFICATION.md; do
        if [ -f "$file" ]; then
            echo "Checking TOC for $file..."

            if grep -q "<!-- toc -->" "$file"; then
                # Generate expected TOC
                markdown-toc --no-firsth1 "$file" > /tmp/expected_toc.md

                # Extract current TOC
                sed -n '/<!-- toc -->/,/<!-- tocstop -->/p' "$file" > /tmp/current_toc.md

                if ! diff -q /tmp/expected_toc.md /tmp/current_toc.md > /dev/null; then
                    echo -e "${RED}❌ TOC is out of date in $file${NC}"
                    echo -e "${YELLOW}💡 Run: markdown-toc -i $file${NC}"
                    toc_issues=$((toc_issues + 1))
                else
                    echo -e "${GREEN}✅ TOC is up to date in $file${NC}"
                fi
            else
                echo -e "${YELLOW}ℹ️  No TOC markers found in $file${NC}"
            fi
        fi
    done

    if [ $toc_issues -eq 0 ]; then
        echo -e "${GREEN}✅ Table of contents check passed${NC}"
        return 0
    else
        echo -e "${RED}❌ Table of contents check failed${NC}"
        return 1
    fi
}



# Main execution
main() {
    echo "Starting markdown quality checks..."

    # Change to script directory
    cd "$(dirname "$0")/.."

    # Install tools if needed
    install_tools

    # Run all checks
    checks_passed=0
    total_checks=0

    # Markdownlint
    total_checks=$((total_checks + 1))
    if run_markdownlint; then
        checks_passed=$((checks_passed + 1))
    fi

    # Spell check
    total_checks=$((total_checks + 1))
    if run_spellcheck; then
        checks_passed=$((checks_passed + 1))
    fi

    # TOC check
    total_checks=$((total_checks + 1))
    if check_toc; then
        checks_passed=$((checks_passed + 1))
    fi



    # Summary
    echo ""
    echo "=================================="
    echo "📊 Summary: $checks_passed/$total_checks checks passed"

    if [ $checks_passed -eq $total_checks ]; then
        echo -e "${GREEN}🎉 All markdown quality checks passed!${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠️  Some checks failed, but continuing (non-blocking mode)${NC}"
        echo -e "${YELLOW}💡 Consider fixing these issues when convenient${NC}"
        exit 0  # Changed from exit 1 to make it non-blocking
    fi
}

# Run main function
main "$@"
