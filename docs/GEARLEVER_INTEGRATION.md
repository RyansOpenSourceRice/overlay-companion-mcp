[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

# GearLever Integration (Legacy - Desktop AppImage)

## Overview

Note: The project is now web-only and does not ship a desktop AppImage. This document is preserved for historical context in case a native desktop/AppImage distribution is reintroduced.

[GearLever](https://mijorus.it/posts/gearlever/update-url-info/) is an AppImage manager that provides automatic update capabilities. This document outlines the planned integration to make a future Overlay Companion desktop AppImage compatible with GearLever's update system.

## Current Status

- ✅ **AppImageUpdate Support**: Already implemented with zsync delta updates
- ✅ **GitHub Releases Integration**: Automatic releases with proper metadata
- 🔄 **GearLever Support**: Planned for future implementation

## Implementation Plan

### 1. Update URL Information

GearLever requires specific metadata embedded in the AppImage to enable automatic updates. This involves:

#### A. AppImage Metadata
Add the following information to the AppImage during build:

```bash
# In build-appimage.sh
export UPDATE_INFORMATION="gh-releases-zsync|RyansOpenSourceRice|overlay-companion-mcp|latest|overlay-companion-mcp-*-x86_64.AppImage.zsync"
```

#### B. Desktop File Enhancement
Update the `.desktop` file to include GearLever-specific metadata:

```ini
[Desktop Entry]
# ... existing entries ...
X-AppImage-UpdateInformation=gh-releases-zsync|RyansOpenSourceRice|overlay-companion-mcp|latest|overlay-companion-mcp-*-x86_64.AppImage.zsync
X-AppImage-Version=2025.08.23.6
```

### 2. Build Script Modifications

#### A. Enhanced build-appimage.sh
```bash
# Add GearLever compatibility
echo "🔧 Adding GearLever update information..."
export UPDATE_INFORMATION="gh-releases-zsync|RyansOpenSourceRice|overlay-companion-mcp|latest|overlay-companion-mcp-*-x86_64.AppImage.zsync"

# Embed update information in AppImage
if [ -n "$UPDATE_INFORMATION" ]; then
    echo "   Update Information: $UPDATE_INFORMATION"
    # This will be embedded by appimagetool automatically
fi
```

#### B. GitHub Actions Workflow
Ensure the workflow generates the necessary files:

```yaml
- name: Generate GearLever metadata
  run: |
    echo "UPDATE_INFORMATION=gh-releases-zsync|RyansOpenSourceRice|overlay-companion-mcp|latest|overlay-companion-mcp-*-x86_64.AppImage.zsync" >> $GITHUB_ENV
```

### 3. Testing and Validation

#### A. Metadata Verification
```bash
# Check if AppImage has proper update information
./overlay-companion-mcp-*.AppImage --appimage-extract-and-run --appimage-updateinformation

# Verify zsync file is accessible
curl -I "https://github.com/RyansOpenSourceRice/overlay-companion-mcp/releases/latest/download/overlay-companion-mcp-latest-x86_64.AppImage.zsync"
```

#### B. GearLever Integration Test
1. Install GearLever
2. Add the AppImage to GearLever
3. Verify automatic update detection
4. Test update process

### 4. Documentation Updates

#### A. README.md
Add GearLever installation and usage instructions:

```markdown
### GearLever Integration

For automatic AppImage management with GearLever:

1. **Install GearLever**: Available from Flathub or GitHub releases
2. **Add AppImage**: Drag and drop the AppImage into GearLever
3. **Automatic Updates**: GearLever will handle updates automatically
```

#### B. Release Notes Template
Include GearLever compatibility information in release notes.

## Benefits

### For Users
- **Automatic Updates**: Seamless background updates via GearLever
- **Centralized Management**: Manage all AppImages from one interface
- **Update Notifications**: Visual notifications when updates are available
- **Rollback Support**: Easy rollback to previous versions if needed

### For Developers
- **Reduced Support**: Users can manage updates independently
- **Better Distribution**: Integration with popular AppImage managers
- **Standardized Updates**: Following AppImage ecosystem best practices

## Implementation Timeline

- **Phase 1**: Research and planning (Current)
- **Phase 2**: Build script modifications
- **Phase 3**: Testing and validation
- **Phase 4**: Documentation and release

## References

- [GearLever Update URL Info](https://mijorus.it/posts/gearlever/update-url-info/)
- [AppImage Update Information](https://docs.appimage.org/packaging-guide/optional/updates.html)
- [AppImageUpdate Documentation](https://github.com/AppImage/AppImageUpdate)

## Notes

This enhancement will be implemented after the current update system is stable and tested. The existing AppImageUpdate integration provides a solid foundation for GearLever compatibility.
