# Overlay Companion (MCP) Specification

*A general-purpose, human-in-the-loop AI-assisted screen interaction toolkit.*

---

## Overview & Purpose

**Overlay Companion (MCP)** is a desktop-based Model Context Protocol (MCP) server designed to facilitate context-aware, human-assisted UI interactions across arbitrary applications—not tied to any specific use case. Built as a C# AppImage for Linux (with cross-platform potential), it provides a **safe, extendable, and vendor-agnostic interface** enabling AI agents (via Jan.ai or other MCP-compatible systems) to:

- Draw overlays (highlight, label, annotate) on the screen using OS-level transparent windows
- Capture screenshots with real-time performance (<0.5 second latency)
- Emulate user input (clicks and typing) under safely defined policies
- Operate in distinct modes for flexible control over automation and human consent
- Handle multi-monitor setups with proper DPI scaling and coordinate translation
- Maintain element anchoring across viewport changes and scrolling
- Be the foundation for specialized workflows without embedding domain-specific logic

The system is designed as a **public, reusable base tool** that can be extended with private, domain-specific MCP servers for specialized use cases.

## Design Principles

- **Human-in-the-loop by default** — no automated actions unless explicitly enabled per mode or user confirmation
- **Real-time performance** — designed for <0.5 second response times to maintain natural interaction flow
- **Mode-aware behavior** — switching modes adjusts behavior (passive observation vs. assisted interaction vs. autopilot)
- **Privacy-respecting** — screenshots can be scrubbed before sharing; clipboard access controlled by user permission
- **Multi-monitor and DPI-aware** — comprehensive support for complex display setups with proper coordinate translation
- **Rate-limited and efficient** — protects local and remote inference systems from overload while maintaining responsiveness
- **Context-aware** — maintains element anchoring and viewport tracking across UI changes
- **Vendor-agnostic** — works with any MCP-compatible AI system (Jan.ai, Claude, custom implementations)

## Extension Strategy

This repository is intended to serve as a **public, reusable base tool**. Domain-specific workflows (e.g., form filling, document automation, data entry assistance) should be built as **separate, private MCP servers** that integrate with this tool. For example:

- The public MCP server handles overlays, screenshots, input simulation, and modes.
- A private "Workflow-Helper MCP server" uses these tools to focus and orchestrate domain-specific logic.
- This keeps your public repo generic, avoiding naming conflicts or policy concerns related to specific automation use cases on GitHub.

## Core Features

### 1. Overlay Management

The system provides comprehensive overlay capabilities for visual feedback and annotation:

- **Dynamic Overlays**: Create, modify, and remove visual overlays on the screen in real-time
- **Multiple Annotation Types**: Support for boxes, text labels, arrows, icons, and custom annotations
- **Multi-Monitor Support**: Overlays work correctly across multiple monitors with different DPI settings
- **Temporary Overlays**: Auto-expiring overlays for transient feedback with configurable timeouts
- **Batch Operations**: Create multiple overlays simultaneously with sequential or parallel rendering
- **Element Anchoring**: Persistent overlay positioning that survives scrolling and layout changes
- **Customizable Appearance**: Configurable colors, transparency, labels, and styling options

### 2. Screenshot Capture

High-performance, controlled screenshot functionality optimized for real-time AI interaction:

- **Region-Specific Capture**: Capture specific areas of the screen with pixel-perfect accuracy
- **Full-Screen Capture**: Complete desktop screenshots across all monitors
- **Stability Waiting**: Configurable wait times for UI to stabilize before capture
- **Multi-Monitor Aware**: Proper handling of multi-monitor setups with coordinate translation
- **Adaptive Frequency**: AI-controlled screenshot intervals based on interaction context
- **Privacy Controls**: Configurable privacy masks to obscure sensitive information
- **Context Metadata**: Include viewport scroll position, timestamp, and display information
- **Efficient Encoding**: Optimized image compression for fast transmission to AI models

### 3. Input Simulation

Safe, controlled input emulation with human oversight and natural timing:

- **Mouse Clicks**: Simulate left, right, and middle mouse button clicks with precise positioning
- **Keyboard Input**: Type text with configurable speed, natural timing variations, and human-like patterns
- **Confirmation Requirements**: Granular user confirmation controls for different action types
- **Timing Controls**: AI-suggested timing hints with configurable delays for natural interaction
- **Mode-Aware Behavior**: Input behavior adapts based on operational mode (passive/assist/autopilot)
- **Multi-Monitor Support**: Accurate input positioning across different displays and DPI settings
- **Action Validation**: Verify input actions were successful and provide feedback

### 4. Operational Modes

The system operates in distinct modes that control automation behavior:

#### Passive Mode
- No automated actions performed - observation only
- Screenshot capture and overlay drawing available
- Safe for monitoring, analysis, and learning without risk of unintended actions
- Ideal for initial setup, debugging, and AI model training

#### Assist Mode
- AI suggests actions with visual highlights and recommendations
- All actions require explicit user confirmation before execution
- Provides step-by-step guidance while maintaining full user control
- Perfect balance of AI assistance and human oversight

#### Autopilot Mode
- Performs actions automatically with minimal user intervention
- Suitable for trusted, well-tested workflows and repetitive tasks
- Configurable safety limits, rate limiting, and emergency stops
- Can revert to assist mode if unexpected situations arise

#### Composing Mode
- Specialized for text composition, editing, and form filling tasks
- Enhanced clipboard integration and text manipulation capabilities
- Optimized for document creation, email writing, and data entry
- Includes text suggestion, formatting, and content validation features

#### Custom Mode
- User-defined behavior patterns and automation rules
- Configurable per-application or per-task settings
- Extensible scripting interface for specialized use cases
- Allows fine-tuned control over AI behavior and user interaction patterns

### 5. Event System

Real-time monitoring and response to UI events for context-aware automation:

- **Event Subscription**: Subscribe to mouse clicks, keyboard input, window changes, and scroll events
- **Debouncing**: Configurable event debouncing to reduce noise and prevent over-triggering
- **Smart Filtering**: Event filtering based on application context, user preferences, and AI requirements
- **Real-time Notifications**: Immediate notification of subscribed events with minimal latency
- **Context Enrichment**: Events include relevant context like cursor position, active window, and viewport state

### 6. Clipboard Integration

Controlled clipboard access with privacy considerations and intelligent content handling:

- **Read Access**: Retrieve current clipboard content with format detection
- **Write Access**: Set clipboard content programmatically with multiple format support
- **Permission-Based**: Granular user-controlled clipboard access permissions
- **Privacy-Aware**: Optional clipboard content scrubbing for sensitive information
- **Content Analysis**: AI-assisted clipboard content analysis for context-aware suggestions
- **History Tracking**: Optional clipboard history for undo/redo operations

### 7. Context Awareness & Element Tracking

Advanced context management for persistent UI interaction:

- **Element Anchoring**: Persistent identification of UI elements across layout changes
- **Viewport Tracking**: Automatic detection and handling of scroll position changes
- **Window State Management**: Track active windows, focus changes, and application context
- **Layout Change Detection**: Detect and adapt to dynamic UI changes and responsive layouts
- **Cross-Session Persistence**: Optional persistence of element anchors and context across sessions

## Technical Architecture

### MCP Integration

The system is built as a Model Context Protocol (MCP) server, providing:

- **Standardized Interface**: Consistent API following MCP specifications
- **Tool-Based Architecture**: Each capability exposed as a discrete tool
- **Async/Sync Operations**: Appropriate operation modes for different tool types
- **Error Handling**: Comprehensive error reporting and recovery

### Performance Considerations

- **Rate Limiting**: Built-in rate limiting to prevent system overload
- **Efficient Screenshot Capture**: Optimized screenshot algorithms
- **Memory Management**: Careful memory usage for overlay and image operations
- **Low Latency**: Designed for responsive real-time interactions

### Security & Privacy

- **User Consent**: Human-in-the-loop design with explicit consent mechanisms
- **Data Scrubbing**: Capability to remove sensitive information from screenshots
- **Permission Controls**: Granular permissions for different capabilities
- **Audit Trail**: Logging of all actions for security and debugging

### Cross-Platform Compatibility

- **OS-Level Integration**: Native integration with operating system APIs
- **DPI Awareness**: Proper handling of high-DPI displays
- **Multi-Monitor Support**: Correct behavior across multiple displays
- **Window Management**: Proper interaction with window managers and compositors

## Use Cases

### Development and Testing

- **UI Testing**: Automated UI testing with visual verification
- **Bug Reproduction**: Capture and replay user interactions
- **Accessibility Testing**: Overlay-based accessibility analysis
- **Performance Monitoring**: Screenshot-based performance analysis

### Workflow Automation

- **Form Filling**: Automated form completion with human oversight
- **Data Entry**: Assisted data entry with validation
- **Document Processing**: Automated document handling workflows
- **System Administration**: Guided system configuration tasks

### Accessibility and Assistance

- **Visual Assistance**: Overlay-based visual aids for users
- **Navigation Help**: Guided navigation through complex interfaces
- **Learning Tools**: Interactive tutorials and guidance systems
- **Accessibility Enhancement**: Tools for users with disabilities

### Research and Analysis

- **User Behavior Analysis**: Capture and analyze user interaction patterns
- **Interface Evaluation**: Systematic evaluation of user interfaces
- **Usability Studies**: Tools for conducting usability research
- **A/B Testing**: Visual comparison and testing tools

## Integration Examples

### AI Agent Integration

```javascript
// Example: AI agent using overlay companion for form filling
const mcp = new MCPClient('overlay-companion-mcp');

// Set assist mode for human oversight
await mcp.call('set_mode', { mode: 'assist' });

// Take screenshot to analyze current state
const screenshot = await mcp.call('take_screenshot', { full_screen: true });

// AI analyzes screenshot and identifies form fields
const formFields = await aiAnalyze(screenshot.image_base64);

// Highlight identified fields
const overlays = formFields.map(field => ({
  x: field.x, y: field.y, 
  width: field.width, height: field.height,
  label: field.label, color: 'blue'
}));
await mcp.call('batch_overlay', { overlays });

// Fill fields with user confirmation
for (const field of formFields) {
  await mcp.call('click_at', { 
    x: field.x + field.width/2, 
    y: field.y + field.height/2,
    require_user_confirmation: true 
  });
  await mcp.call('type_text', { 
    text: field.value,
    require_user_confirmation: true 
  });
}
```

### Custom Workflow Integration

```javascript
// Example: Custom workflow server using overlay companion
class FormAutomationWorkflow {
  constructor() {
    this.overlayMCP = new MCPClient('overlay-companion-mcp');
  }

  async processFormFilling(formUrl) {
    // Set autopilot mode for this trusted workflow
    await this.overlayMCP.call('set_mode', { mode: 'autopilot' });
    
    // Navigate and fill form
    await this.navigateToForm(formUrl);
    await this.fillFormFields();
    await this.reviewAndSubmit();
  }

  async fillFormFields() {
    const screenshot = await this.overlayMCP.call('take_screenshot');
    const fields = await this.identifyFormFields(screenshot);
    
    // Use overlay companion for actual UI interaction
    for (const field of fields) {
      await this.overlayMCP.call('click_at', field.position);
      await this.overlayMCP.call('type_text', { text: field.value });
    }
  }
}
```

## Future Enhancements

### Planned Features

- **OCR Integration**: Built-in optical character recognition for text extraction
- **Computer Vision**: Enhanced image analysis capabilities
- **Voice Control**: Voice command integration for accessibility
- **Mobile Support**: Extension to mobile platforms
- **Cloud Integration**: Optional cloud-based AI processing
- **Plugin System**: Extensible plugin architecture for custom capabilities

### API Evolution

- **Enhanced Event System**: More granular event types and filtering
- **Advanced Overlays**: 3D overlays and augmented reality features
- **Improved Performance**: Further optimization of screenshot and overlay operations
- **Extended Input**: Support for additional input methods and devices

## Contributing

This specification is designed to be a living document that evolves with the needs of the community. Contributions are welcome in the form of:

- **Feature Requests**: Suggestions for new capabilities
- **Use Case Documentation**: Real-world usage examples
- **Performance Improvements**: Optimization suggestions
- **Security Enhancements**: Security and privacy improvements
- **Cross-Platform Support**: Platform-specific enhancements

## Conclusion

The Overlay Companion (MCP) specification defines a comprehensive, extensible platform for human-in-the-loop UI automation. By providing a safe, controlled interface for screen interaction, it enables the development of sophisticated AI-assisted workflows while maintaining user control and privacy. The modular design and MCP integration make it suitable for a wide range of applications, from simple automation tasks to complex, multi-step workflows.