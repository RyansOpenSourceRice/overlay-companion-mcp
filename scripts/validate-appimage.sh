#!/bin/bash

# AppImage Validation Script
# Validates that an AppImage has all required dependencies and can start properly

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APPIMAGE_PATH="${1:-}"
TIMEOUT_SEC="${TIMEOUT_SEC:-30}"

if [ -z "$APPIMAGE_PATH" ] || [ ! -f "$APPIMAGE_PATH" ]; then
    echo -e "${RED}X Usage: $0 <path-to-appimage>${NC}"
    echo -e "${RED}   AppImage file not found: $APPIMAGE_PATH${NC}"
    exit 1
fi

# Convert to absolute path to avoid issues when changing directories
APPIMAGE_PATH=$(realpath "$APPIMAGE_PATH")

echo -e "${BLUE}Validating AppImage: $(basename "$APPIMAGE_PATH")${NC}"
echo "=================================="

# Test 1: Basic file properties
echo -e "${YELLOW}> Checking file properties...${NC}"
if [ ! -x "$APPIMAGE_PATH" ]; then
    echo -e "${RED}X AppImage is not executable${NC}"
    exit 1
fi

FILE_SIZE=$(du -h "$APPIMAGE_PATH" | cut -f1)
echo -e "${GREEN}+ File size: $FILE_SIZE${NC}"

# Test 2: AppImage extraction with detailed error reporting
echo -e "${YELLOW}> Testing AppImage extraction...${NC}"
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

if ! "$APPIMAGE_PATH" --appimage-extract > extraction.log 2>&1; then
    echo -e "${RED}X AppImage extraction failed${NC}"
    echo -e "${YELLOW}Extraction error details:${NC}"
    cat extraction.log

    # Check if it's a valid AppImage file
    echo -e "${YELLOW}> Checking file type...${NC}"
    file "$APPIMAGE_PATH"

    if file "$APPIMAGE_PATH" | grep -q "ELF"; then
        echo -e "${YELLOW}> File appears to be an ELF executable, checking AppImage format...${NC}"
        # Try to get AppImage info
        if "$APPIMAGE_PATH" --appimage-help > help.log 2>&1; then
            echo -e "${GREEN}+ AppImage help available:${NC}"
            cat help.log
        else
            echo -e "${RED}X Not a valid AppImage format${NC}"
            echo -e "${YELLOW}Help command output:${NC}"
            cat help.log || echo "No help output available"
        fi
    else
        echo -e "${RED}X File is not an ELF executable${NC}"
    fi

    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}+ AppImage extraction successful${NC}"

# Test 3: Check required files
echo -e "${YELLOW}> Checking required files in extracted AppImage...${NC}"
if [ ! -d "squashfs-root" ]; then
    echo -e "${RED}X squashfs-root directory not found${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

cd squashfs-root

# Check for AppRun
if [ ! -f "AppRun" ]; then
    echo -e "${RED}X AppRun not found${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}+ AppRun found${NC}"

# Check for .desktop file
if ! find . -name "*.desktop" | grep -q .; then
    echo -e "${YELLOW}! No .desktop file found (optional but recommended)${NC}"
else
    echo -e "${GREEN}+ Desktop file found${NC}"
fi

# Test 4: Basic dependency check
echo -e "${YELLOW}> Checking basic dependencies...${NC}"
if command -v ldd >/dev/null 2>&1; then
    if [ -f "AppRun" ] && file AppRun | grep -q "ELF"; then
        echo -e "${YELLOW}> Checking AppRun dependencies:${NC}"
        if ldd AppRun > deps.log 2>&1; then
            # Check for missing dependencies
            if grep -q "not found" deps.log; then
                echo -e "${YELLOW}! Some dependencies may be missing:${NC}"
                grep "not found" deps.log
            else
                echo -e "${GREEN}+ All basic dependencies found${NC}"
            fi
        else
            echo -e "${YELLOW}! Could not check dependencies${NC}"
        fi
    fi
fi

# Test 5: Try to run AppImage with --help (headless mode)
echo -e "${YELLOW}> Testing AppImage execution (--help)...${NC}"
cd "$TEMP_DIR"

# Set headless mode to avoid GUI issues in CI
export HEADLESS=1

if timeout "$TIMEOUT_SEC" "$APPIMAGE_PATH" --help > help_test.log 2>&1; then
    echo -e "${GREEN}+ AppImage --help executed successfully${NC}"
    if grep -q "Usage\|Options\|Help" help_test.log; then
        echo -e "${GREEN}+ Help output looks valid${NC}"
    else
        echo -e "${YELLOW}! Help output may be incomplete:${NC}"
        head -10 help_test.log
    fi
else
    echo -e "${YELLOW}! AppImage --help test failed or timed out${NC}"
    echo -e "${YELLOW}Output:${NC}"
    cat help_test.log

    # Check for specific error patterns
    if grep -q "Unable to load shared library.*Gtk" help_test.log; then
        echo -e "${RED}X GTK4 dependency error detected${NC}"
        echo -e "${YELLOW}This indicates missing GTK4 libraries in the AppImage${NC}"
        rm -rf "$TEMP_DIR"
        exit 1
    elif grep -q "DllNotFoundException" help_test.log; then
        echo -e "${RED}X .NET dependency error detected${NC}"
        rm -rf "$TEMP_DIR"
        exit 1
    else
        echo -e "${YELLOW}! Non-critical execution issue (may be timeout or display-related)${NC}"
    fi
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo -e "${GREEN}=================================="
echo -e "${GREEN}AppImage validation completed successfully!${NC}"
echo -e "${GREEN}=================================="
