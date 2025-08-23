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
    echo -e "${RED}❌ Usage: $0 <path-to-appimage>${NC}"
    echo -e "${RED}   AppImage file not found: $APPIMAGE_PATH${NC}"
    exit 1
fi

echo -e "${BLUE}🔍 Validating AppImage: $(basename "$APPIMAGE_PATH")${NC}"
echo "=================================="

# Test 1: Basic file properties
echo -e "${YELLOW}📋 Checking file properties...${NC}"
if [ ! -x "$APPIMAGE_PATH" ]; then
    echo -e "${RED}❌ AppImage is not executable${NC}"
    exit 1
fi

FILE_SIZE=$(du -h "$APPIMAGE_PATH" | cut -f1)
echo -e "${GREEN}✅ File size: $FILE_SIZE${NC}"

# Test 2: AppImage extraction
echo -e "${YELLOW}📦 Testing AppImage extraction...${NC}"
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

if ! "$APPIMAGE_PATH" --appimage-extract >/dev/null 2>&1; then
    echo -e "${RED}❌ AppImage extraction failed${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}✅ AppImage extraction successful${NC}"

# Test 3: Check required files
echo -e "${YELLOW}📁 Checking required files...${NC}"
REQUIRED_FILES=(
    "squashfs-root/AppRun"
    "squashfs-root/usr/bin/overlay-companion-mcp"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ Missing required file: $file${NC}"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
done

echo -e "${GREEN}✅ All required files present${NC}"

# Test 4: Check for GTK4 libraries
echo -e "${YELLOW}🔍 Checking for GTK4 dependencies...${NC}"
if find squashfs-root/usr/lib -name 'libgtk-4*.so*' 2>/dev/null | grep -q libgtk-4; then
    echo -e "${GREEN}✅ GTK4 libraries found in AppImage${NC}"
    GTK4_BUNDLED=true
else
    echo -e "${YELLOW}⚠️  GTK4 libraries not bundled - will require system GTK4${NC}"
    GTK4_BUNDLED=false
fi

# Test 5: Runtime execution test
echo -e "${YELLOW}🚀 Testing AppImage execution...${NC}"
cd - >/dev/null

# Create log file
LOG_FILE=$(mktemp)

# Test help command with timeout
if timeout "$TIMEOUT_SEC" "$APPIMAGE_PATH" --help >"$LOG_FILE" 2>&1; then
    echo -e "${GREEN}✅ AppImage help command executed successfully${NC}"
    EXECUTION_SUCCESS=true
else
    echo -e "${RED}❌ AppImage execution failed or timed out${NC}"
    echo -e "${YELLOW}📋 Execution log:${NC}"
    cat "$LOG_FILE"
    EXECUTION_SUCCESS=false
fi

# Test 6: Check for critical errors
echo -e "${YELLOW}🔍 Analyzing execution for critical errors...${NC}"
CRITICAL_ERRORS=false

if grep -q "Unable to load shared library.*Gtk" "$LOG_FILE"; then
    echo -e "${RED}❌ CRITICAL: GTK4 dependency error detected${NC}"
    CRITICAL_ERRORS=true
fi

if grep -q "DllNotFoundException" "$LOG_FILE"; then
    echo -e "${RED}❌ CRITICAL: Native library dependency error detected${NC}"
    CRITICAL_ERRORS=true
fi

if grep -q "Unhandled exception" "$LOG_FILE"; then
    echo -e "${RED}❌ CRITICAL: Unhandled exception detected${NC}"
    CRITICAL_ERRORS=true
fi

# Cleanup
rm -rf "$TEMP_DIR" "$LOG_FILE"

# Final validation result
echo ""
echo -e "${BLUE}📊 Validation Summary${NC}"
echo "=================================="

if [ "$EXECUTION_SUCCESS" = true ] && [ "$CRITICAL_ERRORS" = false ]; then
    echo -e "${GREEN}✅ AppImage validation PASSED${NC}"
    if [ "$GTK4_BUNDLED" = false ]; then
        echo -e "${YELLOW}⚠️  Note: GTK4 not bundled - target systems must have GTK4 installed${NC}"
    fi
    exit 0
else
    echo -e "${RED}❌ AppImage validation FAILED${NC}"
    if [ "$EXECUTION_SUCCESS" = false ]; then
        echo -e "${RED}   - Execution test failed${NC}"
    fi
    if [ "$CRITICAL_ERRORS" = true ]; then
        echo -e "${RED}   - Critical dependency errors detected${NC}"
    fi
    exit 1
fi
