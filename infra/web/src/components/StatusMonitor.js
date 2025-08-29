/**
 * Status Monitor Component
 * Monitors system health and updates UI status displays
 */

export default class StatusMonitor {
    constructor() {
        this.isRunning = false;
        this.interval = null;
        this.healthCheckInterval = 30000; // 30 seconds
        this.statusUpdateInterval = 5000;  // 5 seconds
        this.lastHealthCheck = null;
        this.systemInfo = null;
    }

    start() {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('📊 Status monitor started');

        // Initial health check
        this.performHealthCheck();
        this.updateSystemInfo();

        // Set up periodic updates
        this.interval = setInterval(() => {
            this.updateSystemInfo();

            // Health check less frequently
            if (!this.lastHealthCheck || Date.now() - this.lastHealthCheck > this.healthCheckInterval) {
                this.performHealthCheck();
            }
        }, this.statusUpdateInterval);
    }

    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        console.log('📊 Status monitor stopped');
    }

    async performHealthCheck() {
        try {
            const response = await fetch('/health', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const healthData = await response.json();
            this.processHealthData(healthData);
            this.lastHealthCheck = Date.now();

            console.log('✅ Health check successful:', healthData.status);

        } catch (error) {
            console.error('❌ Health check failed:', error);
            this.handleHealthCheckError(error);
        }
    }

    processHealthData(healthData) {
        // Update WebSocket status
        const wsStatus = document.getElementById('ws-status');
        if (wsStatus) {
            const wsConnected = healthData.services?.websocket === 'enabled' &&
                              healthData.services?.connectedClients >= 0;
            wsStatus.textContent = wsConnected ? 'Connected' : 'Disconnected';
            wsStatus.style.color = wsConnected ? '#48bb78' : '#f56565';
        }

        // Update system info
        if (healthData.memory) {
            const memoryElement = document.getElementById('system-memory');
            if (memoryElement) {
                const memoryMB = Math.round(healthData.memory.heapUsed / 1024 / 1024);
                memoryElement.textContent = `${memoryMB}MB`;
            }
        }

        if (healthData.uptime) {
            const uptimeElement = document.getElementById('system-uptime');
            if (uptimeElement) {
                uptimeElement.textContent = this.formatUptime(healthData.uptime);
            }
        }

        // Store for later use
        this.systemInfo = healthData;
    }

    handleHealthCheckError(error) {
        // Update UI to show error state
        const wsStatus = document.getElementById('ws-status');
        if (wsStatus) {
            wsStatus.textContent = 'Error';
            wsStatus.style.color = '#f56565';
        }

        // Show notification for critical errors
        if (window.overlayCompanionApp) {
            window.overlayCompanionApp.showNotification(
                'Health check failed - some features may not work properly',
                'warning'
            );
        }
    }

    updateSystemInfo() {
        // Update uptime display
        const uptimeElement = document.getElementById('system-uptime');
        if (uptimeElement && this.systemInfo?.uptime) {
            // Calculate current uptime based on last known uptime
            const timeSinceLastCheck = this.lastHealthCheck ?
                (Date.now() - this.lastHealthCheck) / 1000 : 0;
            const currentUptime = this.systemInfo.uptime + timeSinceLastCheck;
            uptimeElement.textContent = this.formatUptime(currentUptime);
        }

        // Update other dynamic information
        this.updateConnectionCounts();
        this.updatePerformanceMetrics();
    }

    updateConnectionCounts() {
        // This would be updated via WebSocket messages in a real implementation
        // For now, we'll simulate some activity

        const wsStatus = document.getElementById('ws-status');
        if (wsStatus && wsStatus.textContent === 'Connected') {
            // Add a subtle indicator for active connections
            const indicator = '●';
            if (!wsStatus.textContent.includes(indicator)) {
                wsStatus.textContent = `Connected ${indicator}`;
            }
        }
    }

    updatePerformanceMetrics() {
        // Monitor performance and update UI accordingly
        const performanceInfo = this.getPerformanceInfo();

        // Update memory usage color based on usage
        const memoryElement = document.getElementById('system-memory');
        if (memoryElement && performanceInfo.memoryUsagePercent) {
            const usage = performanceInfo.memoryUsagePercent;
            if (usage > 80) {
                memoryElement.style.color = '#f56565'; // Red for high usage
            } else if (usage > 60) {
                memoryElement.style.color = '#ed8936'; // Orange for medium usage
            } else {
                memoryElement.style.color = '#48bb78'; // Green for low usage
            }
        }
    }

    getPerformanceInfo() {
        const info = {
            memoryUsagePercent: 0,
            cpuUsagePercent: 0,
            networkLatency: 0
        };

        // Calculate memory usage percentage if we have the data
        if (this.systemInfo?.memory) {
            const { heapUsed, heapTotal } = this.systemInfo.memory;
            info.memoryUsagePercent = (heapUsed / heapTotal) * 100;
        }

        return info;
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    // Get current system status
    getSystemStatus() {
        return {
            isMonitoring: this.isRunning,
            lastHealthCheck: this.lastHealthCheck,
            systemInfo: this.systemInfo,
            healthStatus: this.systemInfo?.status || 'unknown',
            uptime: this.systemInfo?.uptime || 0,
            memoryUsage: this.systemInfo?.memory || null,
            connectedClients: this.systemInfo?.services?.connectedClients || 0
        };
    }

    // Manual health check trigger
    async triggerHealthCheck() {
        console.log('🔄 Manual health check triggered');
        await this.performHealthCheck();

        if (window.overlayCompanionApp) {
            window.overlayCompanionApp.showNotification('Health check completed', 'info');
        }
    }

    // Set custom health check interval
    setHealthCheckInterval(intervalMs) {
        this.healthCheckInterval = intervalMs;
        console.log(`📊 Health check interval set to ${intervalMs}ms`);
    }

    // Set custom status update interval
    setStatusUpdateInterval(intervalMs) {
        this.statusUpdateInterval = intervalMs;

        // Restart monitoring with new interval
        if (this.isRunning) {
            this.stop();
            this.start();
        }

        console.log(`📊 Status update interval set to ${intervalMs}ms`);
    }

    // Add custom status display
    addCustomStatus(elementId, updateFunction) {
        // This allows other components to register custom status displays
        if (!this.customStatusUpdaters) {
            this.customStatusUpdaters = new Map();
        }

        this.customStatusUpdaters.set(elementId, updateFunction);
        console.log(`📊 Custom status updater registered for ${elementId}`);
    }

    // Update all custom status displays
    updateCustomStatuses() {
        if (!this.customStatusUpdaters) return;

        for (const [elementId, updateFunction] of this.customStatusUpdaters) {
            try {
                const element = document.getElementById(elementId);
                if (element) {
                    updateFunction(element, this.systemInfo);
                }
            } catch (error) {
                console.error(`Error updating custom status for ${elementId}:`, error);
            }
        }
    }

    // Cleanup
    destroy() {
        this.stop();
        this.systemInfo = null;
        this.lastHealthCheck = null;

        if (this.customStatusUpdaters) {
            this.customStatusUpdaters.clear();
        }

        console.log('🗑️ Status monitor destroyed');
    }
}
