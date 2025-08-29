/**
 * KasmVNC Client Component
 * Replaces GuacamoleClient for simplified VNC access with multi-monitor support
 */

export class KasmVNCClient {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            url: options.url || 'http://localhost:6901',
            autoConnect: options.autoConnect !== false,
            multiMonitor: options.multiMonitor !== false,
            ...options
        };
        
        this.connected = false;
        this.displays = [];
        this.currentDisplay = 0;
        
        this.init();
    }

    init() {
        this.createUI();
        if (this.options.autoConnect) {
            this.connect();
        }
    }

    createUI() {
        this.container.innerHTML = `
            <div class="kasmvnc-client">
                <div class="kasmvnc-toolbar">
                    <div class="connection-controls">
                        <button id="connect-btn" class="btn btn-primary">Connect</button>
                        <button id="disconnect-btn" class="btn btn-secondary" disabled>Disconnect</button>
                        <span class="connection-status">Disconnected</span>
                    </div>
                    <div class="display-controls" style="display: none;">
                        <button id="add-display-btn" class="btn btn-info">Add Display</button>
                        <select id="display-select">
                            <option value="0">Display 1</option>
                        </select>
                        <button id="fullscreen-btn" class="btn btn-secondary">Fullscreen</button>
                    </div>
                </div>
                <div class="kasmvnc-container">
                    <iframe id="kasmvnc-frame" 
                            src="" 
                            style="width: 100%; height: 600px; border: none; display: none;">
                    </iframe>
                    <div id="connection-message" class="connection-message">
                        Click Connect to access the remote desktop
                    </div>
                </div>
            </div>
        `;

        this.setupEventListeners();
    }

    setupEventListeners() {
        const connectBtn = this.container.querySelector('#connect-btn');
        const disconnectBtn = this.container.querySelector('#disconnect-btn');
        const addDisplayBtn = this.container.querySelector('#add-display-btn');
        const displaySelect = this.container.querySelector('#display-select');
        const fullscreenBtn = this.container.querySelector('#fullscreen-btn');

        connectBtn.addEventListener('click', () => this.connect());
        disconnectBtn.addEventListener('click', () => this.disconnect());
        addDisplayBtn.addEventListener('click', () => this.addDisplay());
        displaySelect.addEventListener('change', (e) => this.switchDisplay(parseInt(e.target.value)));
        fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    async connect() {
        try {
            this.updateStatus('Connecting...');
            
            // Load KasmVNC in iframe
            const frame = this.container.querySelector('#kasmvnc-frame');
            const message = this.container.querySelector('#connection-message');
            
            frame.src = this.options.url;
            frame.style.display = 'block';
            message.style.display = 'none';
            
            // Wait for frame to load
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
                
                frame.onload = () => {
                    clearTimeout(timeout);
                    resolve();
                };
                
                frame.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('Failed to load KasmVNC'));
                };
            });

            this.connected = true;
            this.updateStatus('Connected');
            this.updateControls();
            
            // Enable multi-monitor controls if supported
            if (this.options.multiMonitor) {
                this.container.querySelector('.display-controls').style.display = 'flex';
            }

            // Emit connection event
            this.emit('connected');
            
        } catch (error) {
            console.error('KasmVNC connection failed:', error);
            this.updateStatus('Connection failed: ' + error.message);
            this.emit('error', error);
        }
    }

    disconnect() {
        const frame = this.container.querySelector('#kasmvnc-frame');
        const message = this.container.querySelector('#connection-message');
        
        frame.src = '';
        frame.style.display = 'none';
        message.style.display = 'block';
        message.textContent = 'Disconnected';
        
        this.connected = false;
        this.updateStatus('Disconnected');
        this.updateControls();
        
        // Hide multi-monitor controls
        this.container.querySelector('.display-controls').style.display = 'none';
        
        this.emit('disconnected');
    }

    addDisplay() {
        if (!this.connected) return;
        
        // KasmVNC handles multi-monitor by opening new browser windows
        // We'll simulate this by opening a new window with the VNC URL
        const displayWindow = window.open(
            this.options.url + '?display=' + (this.displays.length + 1),
            `kasmvnc-display-${this.displays.length + 1}`,
            'width=1920,height=1080,scrollbars=yes,resizable=yes'
        );
        
        if (displayWindow) {
            this.displays.push({
                id: this.displays.length + 1,
                window: displayWindow
            });
            
            // Update display selector
            const select = this.container.querySelector('#display-select');
            const option = document.createElement('option');
            option.value = this.displays.length;
            option.textContent = `Display ${this.displays.length + 1}`;
            select.appendChild(option);
            
            this.emit('displayAdded', { displayId: this.displays.length });
        }
    }

    switchDisplay(displayIndex) {
        if (displayIndex === 0) {
            // Main display - focus on iframe
            this.container.querySelector('#kasmvnc-frame').focus();
        } else if (this.displays[displayIndex - 1]) {
            // Secondary display - focus on window
            const display = this.displays[displayIndex - 1];
            if (display.window && !display.window.closed) {
                display.window.focus();
            }
        }
        
        this.currentDisplay = displayIndex;
        this.emit('displaySwitched', { displayIndex });
    }

    toggleFullscreen() {
        const frame = this.container.querySelector('#kasmvnc-frame');
        
        if (!document.fullscreenElement) {
            frame.requestFullscreen().catch(err => {
                console.error('Error attempting to enable fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    updateStatus(status) {
        const statusElement = this.container.querySelector('.connection-status');
        statusElement.textContent = status;
        statusElement.className = `connection-status ${status.toLowerCase().replace(/[^a-z]/g, '-')}`;
    }

    updateControls() {
        const connectBtn = this.container.querySelector('#connect-btn');
        const disconnectBtn = this.container.querySelector('#disconnect-btn');
        
        connectBtn.disabled = this.connected;
        disconnectBtn.disabled = !this.connected;
    }

    // Simple event emitter
    emit(event, data) {
        const customEvent = new CustomEvent(`kasmvnc:${event}`, { detail: data });
        this.container.dispatchEvent(customEvent);
    }

    // Public API methods
    isConnected() {
        return this.connected;
    }

    getDisplays() {
        return this.displays;
    }

    getCurrentDisplay() {
        return this.currentDisplay;
    }

    // Cleanup method
    destroy() {
        this.disconnect();
        
        // Close all secondary display windows
        this.displays.forEach(display => {
            if (display.window && !display.window.closed) {
                display.window.close();
            }
        });
        
        this.displays = [];
        this.container.innerHTML = '';
    }
}