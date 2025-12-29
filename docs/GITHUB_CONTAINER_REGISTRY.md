[![Sheld.io: Prefunctional Development](https://img.shields.io/badge/Sheld.io-Prefunctional%20Development-blueviolet?style=flat-square)](https://sheld.io) [![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

# GitHub Container Registry Setup

This document explains how to use the automated GitHub Container Registry (GHCR) setup for the Overlay Companion MCP project.

## 🚀 Overview

The project automatically builds and publishes container images to GitHub Container Registry with:
- **Date-based versioning**: `YYYY.MM.DD.quantity` format
- **Automated cleanup**: Removes old images to save storage
- **Multi-architecture builds**: Supports AMD64 and ARM64
- **Security scanning**: Trivy vulnerability scanning
- **Automated tagging**: Git tags created for releases

## 📦 Published Images

Two container images are published:

### 1. MCP Server
- **Image**: `ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server`
- **Description**: C# MCP server with overlay functionality
- **Port**: 3000
- **Tags**: `latest`, `main`, version tags (e.g., `2024.01.15.1`)

### 2. Web Interface
- **Image**: `ghcr.io/ryansopensaucerice/overlay-companion-mcp/web-interface`
- **Description**: Node.js web interface with management UI
- **Port**: 8080
- **Tags**: `latest`, `main`, version tags (e.g., `2024.01.15.1`)

## 🔄 Automated Workflows

### Build and Push Workflow
**File**: `.github/workflows/container-registry.yml`

**Triggers**:
- Push to `main` or `develop` branches
- Pull requests to `main`
- Manual dispatch
- Changes to container-related files

**Features**:
- **Date-based versioning**: Automatically generates `YYYY.MM.DD.quantity` tags
- **Multi-architecture**: Builds for AMD64 and ARM64
- **Caching**: Uses GitHub Actions cache for faster builds
- **Security scanning**: Trivy vulnerability scanner
- **Git tagging**: Creates Git tags for main branch builds

### Cleanup Workflow
**File**: `.github/workflows/cleanup-containers.yml`

**Schedule**: Daily at 2 AM UTC

**Features**:
- **Retention policy**: Keeps images newer than 30 days
- **Version limit**: Maintains minimum 10 versions
- **Untagged cleanup**: Removes untagged intermediate images
- **Manual trigger**: Can be run manually with custom parameters

## 📋 Usage Instructions

### 1. Pull Images from GHCR

```bash
# Pull latest MCP server
podman pull ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:latest

# Pull latest web interface
podman pull ghcr.io/ryansopensaucerice/overlay-companion-mcp/web-interface:latest

# Pull specific version
podman pull ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:2024.01.15.1
```

### 2. Run Containers

```bash
# Run MCP server
podman run -d --name mcp-server \
  -p 3000:3000 \
  ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:latest

# Run web interface
podman run -d --name web-interface \
  -p 8080:8080 \
  -e MCP_SERVER_URL=http://localhost:3000 \
  ghcr.io/ryansopensaucerice/overlay-companion-mcp/web-interface:latest
```

### 3. Use in Compose Files

```yaml
version: '3.8'
services:
  mcp-server:
    image: ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:latest
    ports:
      - "3000:3000"
    restart: unless-stopped

  web-interface:
    image: ghcr.io/ryansopensaucerice/overlay-companion-mcp/web-interface:latest
    ports:
      - "8080:8080"
    environment:
      - MCP_SERVER_URL=http://mcp-server:3000
    depends_on:
      - mcp-server
    restart: unless-stopped
```

## 🏷️ Version Tagging System

### Format: `YYYY.MM.DD.quantity`

- **YYYY**: 4-digit year
- **MM**: 2-digit month (01-12)
- **DD**: 2-digit day (01-31)
- **quantity**: Sequential number for same-day releases

### Examples:
- `2024.01.15.1` - First release on January 15, 2024
- `2024.01.15.2` - Second release on January 15, 2024
- `2024.02.01.1` - First release on February 1, 2024

### Special Tags:
- `latest` - Always points to the most recent main branch build
- `main` - Latest build from main branch
- `develop` - Latest build from develop branch

## 🧹 Cleanup Configuration

### Default Retention Policy:
- **Age**: Keep images newer than 30 days
- **Count**: Keep minimum 10 versions per image
- **Untagged**: Remove untagged intermediate images
- **Protected tags**: Never delete `latest`, `main`, `develop`

### Manual Cleanup:
```bash
# Trigger cleanup workflow manually
gh workflow run cleanup-containers.yml

# With custom parameters
gh workflow run cleanup-containers.yml \
  -f retention_days=14 \
  -f min_versions=5 \
  -f dry_run=true
```

## 🔒 Security Features

### Vulnerability Scanning:
- **Tool**: Trivy security scanner
- **Frequency**: Every build
- **Integration**: Results uploaded to GitHub Security tab
- **Coverage**: OS packages, language dependencies, known CVEs

### Access Control:
- **Public images**: Anyone can pull images
- **Push access**: Only repository collaborators
- **Token scope**: Uses `GITHUB_TOKEN` with minimal required permissions

## 🛠️ Development Workflow

### 1. Local Development:
```bash
# Build locally
podman build -f infra/Dockerfile.mcp -t local/mcp-server .
podman build -f infra/Dockerfile.web -t local/web-interface .

# Test locally
podman run -p 3000:3000 local/mcp-server
podman run -p 8080:8080 local/web-interface
```

### 2. Push to Trigger Build:
```bash
git add .
git commit -m "Update container configuration"
git push origin main  # Triggers automatic build and publish
```

### 3. Monitor Build:
- Check GitHub Actions tab for build status
- View published images in GitHub Packages
- Check security scan results in Security tab

## 📊 Monitoring and Logs

### Build Logs:
- GitHub Actions → Container Registry workflow
- Individual job logs for build, push, cleanup

### Image Information:
- GitHub → Packages → Container registry
- View all versions, download stats, vulnerability reports

### Security Reports:
- GitHub → Security → Code scanning alerts
- Trivy scan results for each image version

## 🔧 Troubleshooting

### Common Issues:

1. **Build Failures**:
   - Check Dockerfile syntax
   - Verify source file paths
   - Review build logs in Actions tab

2. **Push Failures**:
   - Verify GITHUB_TOKEN permissions
   - Check repository package settings
   - Ensure proper image naming

3. **Pull Failures**:
   - Verify image name and tag
   - Check if image is public
   - Authenticate if accessing private images

### Debug Commands:
```bash
# Check image details
podman inspect ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:latest

# View image layers
podman history ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:latest

# Test image locally
podman run --rm -it ghcr.io/ryansopensaucerice/overlay-companion-mcp/mcp-server:latest /bin/bash
```

## 📚 Additional Resources

- [GitHub Container Registry Documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Podman Documentation](https://docs.podman.io/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
