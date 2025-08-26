# Overlay Companion MCP - Docker Image
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app

# Copy project files
COPY src/*.csproj ./src/
RUN dotnet restore src/OverlayCompanion.csproj

# Copy source code and build
COPY . .
RUN dotnet publish src/OverlayCompanion.csproj -c Release -o out

# Runtime image
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app

# Install system dependencies for screen capture
RUN apt-get update && apt-get install -y \
    grim \
    wl-clipboard \
    xclip \
    scrot \
    gnome-screenshot \
    && rm -rf /var/lib/apt/lists/*

# Copy built application
COPY --from=build /app/out .

# Expose port
EXPOSE 3000

# Set environment variables
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:3000

# Run the application
ENTRYPOINT ["dotnet", "overlay-companion-mcp.dll"]