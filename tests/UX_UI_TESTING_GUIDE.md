# Overlay Companion MCP - UX/UI Testing Guide

## User Perspective Testing - Real World Scenario

This guide tests the Overlay Companion MCP from a **real user's perspective** - someone with:
- Fedora Desktop (host) with Cherry AI and Firefox
- Fedora VM (guest) for testing
- No Python coding experience
- Wants GUI-based configuration

---

## ✅ Pre-Flight Check: Are You Ready?

**Your Setup:**
- ✅ Fedora Desktop with Cherry AI installed
- ✅ Firefox browser
- ✅ Fedora VM (VirtualBox, VMware, Proxmox, or KVM)
- ✅ Network connectivity between host and VM

**You are READY to proceed!**

---

## Phase 1: Documentation Review (Before Installation)

### Test 1.1: First Impressions - README.md

**What to check:**
1. Open the GitHub repository: https://github.com/RyansOpenSourceRice/overlay-companion-mcp
2. Read the README.md

**Questions to answer:**
- [ ] Can you understand what this project does in 30 seconds?
- [ ] Is the architecture diagram clear?
- [ ] Are the installation steps obvious?
- [ ] Do you know which installation method to use?

**Expected User Journey:**
```
User reads: "AI-powered screen overlay system with MCP integration"
User sees: Architecture diagram showing Host → Containers → VM
User finds: "Option A: KasmVNC Setup (Recommended)"
User thinks: "Okay, I'll use KasmVNC"
```

**UX Issues to Note:**
- ❓ Is "KasmVNC" explained before it's recommended?
- ❓ Is the difference between "Host" and "VM" clear?
- ❓ Are there too many options (Option A, Option B, custom ports)?

---

### Test 1.2: Installation Instructions Clarity

**What to check:**
Read the installation section carefully.

**Questions:**
- [ ] Do you know where to run each command (host vs VM)?
- [ ] Are the curl commands safe to run?
- [ ] Is it clear what gets installed?
- [ ] Are there screenshots or visual guides?

**Expected User Journey:**
```
Step 1: Run on HOST: curl -fsSL ... | bash
Step 2: Create VM (optional)
Step 3: Run on VM: curl -fsSL ... | bash
Step 4: Connect them together
```

**UX Issues to Note:**
- ❓ "Optional" VM - but is it really optional?
- ❓ What if the user already has a VM?
- ❓ What if port 8080 is already in use?

---

## Phase 2: Installation Testing (Hands-On)

### Test 2.1: Host Installation (Your Fedora Desktop)

**Action:** Install on your Fedora Desktop

```bash
# On your Fedora Desktop (HOST)
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/host-setup-kasmvnc.sh | bash
```

**What to observe:**
- [ ] Does the script explain what it's doing?
- [ ] Does it check for prerequisites?
- [ ] Does it handle port conflicts gracefully?
- [ ] Does it show progress indicators?
- [ ] Does it provide next steps at the end?

**Expected Output:**
```
✅ Installing Overlay Companion MCP (KasmVNC)...
✅ Checking prerequisites...
✅ Installing podman...
✅ Pulling container images...
✅ Starting services...
✅ Installation complete!

Next steps:
1. Access web interface: http://localhost:8080
2. Set up VM with: curl -fsSL ... | bash
```

**UX Issues to Note:**
- ❓ Does it explain what podman is?
- ❓ Does it ask for confirmation before installing?
- ❓ Does it handle errors gracefully?
- ❓ Does it provide a way to uninstall?

---

### Test 2.2: VM Installation (Your Fedora VM)

**Action:** Install on your Fedora VM

```bash
# SSH into your Fedora VM or open terminal in VM
curl -fsSL https://raw.githubusercontent.com/RyansOpenSourceRice/overlay-companion-mcp/main/vm-setup-kasmvnc.sh | bash
```

**What to observe:**
- [ ] Does it explain what KasmVNC is?
- [ ] Does it configure the desktop environment?
- [ ] Does it provide the connection URL?
- [ ] Does it start services automatically?

**Expected Output:**
```
✅ Installing KasmVNC on VM...
✅ Installing desktop environment...
✅ Configuring KasmVNC...
✅ Starting services...
✅ Installation complete!

KasmVNC is running on: http://VM_IP:6901
```

**UX Issues to Note:**
- ❓ Does it tell you the VM's IP address?
- ❓ Does it explain how to connect from the host?
- ❓ Does it set a default password?

---

## Phase 3: Web Interface Testing (GUI Configuration)

### Test 3.1: Accessing the Web Interface

**Action:** Open Firefox on your Fedora Desktop

```
URL: http://localhost:8080
```

**What to check:**
- [ ] Does the page load quickly?
- [ ] Is the interface intuitive?
- [ ] Are there clear navigation buttons?
- [ ] Is there a status dashboard?

**Expected Interface:**
```
┌─────────────────────────────────────────┐
│ 🏠 Overlay Companion MCP                │
├─────────────────────────────────────────┤
│ [Home] [Connections] [Settings]         │
├─────────────────────────────────────────┤
│                                         │
│  AI-Powered Screen Overlay System      │
│                                         │
│  [Quick Connect] [New Connection]      │
│                                         │
│  System Status:                        │
│  ✅ MCP Server: Running                │
│  ✅ KasmVNC: Connected                 │
│  ✅ WebSocket: Active                  │
│                                         │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Is the purpose of each section clear?
- ❓ Are there tooltips or help text?
- ❓ Is the design responsive (mobile-friendly)?

---

### Test 3.2: Connecting to Your VM (No Python Required!)

**Action:** Click "New Connection" or "Quick Connect"

**What to check:**
- [ ] Is there a form to enter VM details?
- [ ] Are the fields clearly labeled?
- [ ] Is there validation for IP addresses?
- [ ] Is there a "Test Connection" button?

**Expected Form:**
```
┌─────────────────────────────────────────┐
│ Add New Connection                      │
├─────────────────────────────────────────┤
│ Connection Name: [My Fedora VM        ] │
│ VM IP Address:   [192.168.1.100       ] │
│ KasmVNC Port:    [6901                ] │
│ Username:        [user                ] │
│ Password:        [••••••••            ] │
│                                         │
│ [Test Connection] [Save] [Cancel]      │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Does it auto-detect the VM IP?
- ❓ Does it remember saved connections?
- ❓ Does it show connection status (green/red)?
- ❓ Can you edit/delete connections?

---

### Test 3.3: Cherry AI Integration (MCP Configuration)

**Action:** Configure Cherry AI to use the MCP server

**What to check:**
- [ ] Is there a "Copy MCP Config" button?
- [ ] Does it provide Cherry AI-specific instructions?
- [ ] Is the MCP URL clearly displayed?

**Expected Interface:**
```
┌─────────────────────────────────────────┐
│ Cherry AI Integration                   │
├─────────────────────────────────────────┤
│ MCP Server URL:                         │
│ http://localhost:3000                   │
│ [Copy URL]                              │
│                                         │
│ Cherry AI Configuration:                │
│ 1. Open Cherry AI Settings              │
│ 2. Go to MCP Servers                    │
│ 3. Add New Server                       │
│ 4. Paste URL: http://localhost:3000     │
│ 5. Click "Connect"                      │
│                                         │
│ [Copy Config JSON]                      │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Does it explain what MCP is?
- ❓ Does it provide a JSON config snippet?
- ❓ Does it link to Cherry AI docs?
- ❓ Does it show connection status?

---

## Phase 4: Functional Testing (Using the System)

### Test 4.1: Viewing the VM Desktop

**Action:** Click "Connect" to view your VM desktop

**What to check:**
- [ ] Does the VM desktop appear in the browser?
- [ ] Is the resolution correct?
- [ ] Can you interact with the VM (mouse/keyboard)?
- [ ] Is there a fullscreen option?

**Expected Experience:**
```
┌─────────────────────────────────────────┐
│ [Fullscreen] [Disconnect] [Settings]    │
├─────────────────────────────────────────┤
│                                         │
│     [VM Desktop Appears Here]          │
│                                         │
│     You can click, type, and           │
│     interact with the VM               │
│                                         │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Is the performance smooth?
- ❓ Are there lag indicators?
- ❓ Can you copy/paste between host and VM?
- ❓ Is there a disconnect button?

---

### Test 4.2: AI Overlay Testing (Cherry AI)

**Action:** In Cherry AI, ask it to create an overlay

**Example prompts:**
```
"Show me a red circle at coordinates 500, 300"
"Create a text overlay that says 'Hello World' at the top left"
"Take a screenshot of the current desktop"
"Click the Firefox icon"
```

**What to check:**
- [ ] Does the overlay appear on the VM desktop?
- [ ] Is the overlay positioned correctly?
- [ ] Can you see the overlay in real-time?
- [ ] Does Cherry AI confirm the action?

**Expected Experience:**
```
You: "Show me a red circle at 500, 300"

Cherry AI: "I've created a red circle overlay at 
coordinates (500, 300) on your VM desktop. 
You should see it now."

[Red circle appears on VM desktop in browser]
```

**UX Issues to Note:**
- ❓ Is there visual feedback when overlays are created?
- ❓ Can you remove overlays easily?
- ❓ Does it work with multiple monitors?
- ❓ Is there a delay between command and overlay?

---

### Test 4.3: Multi-Monitor Support

**Action:** Add a second monitor to your VM

**What to check:**
- [ ] Is there an "Add Display" button?
- [ ] Does it open a new browser window/tab?
- [ ] Can you position windows independently?
- [ ] Do overlays work on both monitors?

**Expected Interface:**
```
┌─────────────────────────────────────────┐
│ Monitor 1 (Primary)                     │
│ [Add Display] [Remove Display]          │
├─────────────────────────────────────────┤
│     [VM Desktop - Monitor 1]           │
└─────────────────────────────────────────┘

[Click "Add Display"]

┌─────────────────────────────────────────┐
│ Monitor 2 (Secondary)                   │
│ [Remove Display]                        │
├─────────────────────────────────────────┤
│     [VM Desktop - Monitor 2]           │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Is multi-monitor setup intuitive?
- ❓ Does it remember monitor layouts?
- ❓ Can you drag windows between monitors?

---

## Phase 5: Settings & Configuration (GUI-Based)

### Test 5.1: Clipboard Bridge Configuration

**Action:** Navigate to Settings → Clipboard

**What to check:**
- [ ] Is there a toggle to enable/disable clipboard bridge?
- [ ] Can you configure the VM clipboard URL?
- [ ] Is there a "Test Connection" button?
- [ ] Does it show connection status?

**Expected Interface:**
```
┌─────────────────────────────────────────┐
│ Clipboard Bridge Settings               │
├─────────────────────────────────────────┤
│ Enable VM Clipboard: [✓]                │
│                                         │
│ VM Clipboard URL:                       │
│ http://192.168.1.100:8765               │
│                                         │
│ API Key: [••••••••••••••••]             │
│                                         │
│ Timeout: [5] seconds                    │
│                                         │
│ Fallback to local: [✓]                  │
│                                         │
│ Status: ✅ Connected                    │
│                                         │
│ [Test Connection] [Save] [Reset]        │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Does it explain what clipboard bridge does?
- ❓ Does it auto-detect the VM clipboard service?
- ❓ Does it validate the API key?
- ❓ Does it show error messages clearly?

---

### Test 5.2: MCP Server Settings

**Action:** Navigate to Settings → MCP Server

**What to check:**
- [ ] Can you change the MCP port?
- [ ] Can you enable/disable features?
- [ ] Is there a restart button?
- [ ] Does it show server logs?

**Expected Interface:**
```
┌─────────────────────────────────────────┐
│ MCP Server Settings                     │
├─────────────────────────────────────────┤
│ Server Port: [3000]                     │
│                                         │
│ Features:                               │
│ [✓] Screen Capture                      │
│ [✓] Overlay Annotations                 │
│ [✓] Mouse/Keyboard Simulation           │
│ [✓] Clipboard Access                    │
│                                         │
│ Transport Protocol:                     │
│ ● Streamable HTTP (Recommended)         │
│ ○ HTTP+SSE (Deprecated)                 │
│ ○ STDIO (Legacy)                        │
│                                         │
│ [Restart Server] [View Logs]            │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Does it explain what each feature does?
- ❓ Does it warn about deprecated protocols?
- ❓ Does it require restart after changes?
- ❓ Can you export/import settings?

---

## Phase 6: Troubleshooting & Help

### Test 6.1: Built-in Help System

**What to check:**
- [ ] Is there a "Help" or "?" button?
- [ ] Are there tooltips on hover?
- [ ] Is there a troubleshooting guide?
- [ ] Is there a link to documentation?

**Expected Help Interface:**
```
┌─────────────────────────────────────────┐
│ Help & Troubleshooting                  │
├─────────────────────────────────────────┤
│ Common Issues:                          │
│                                         │
│ ❓ Can't connect to VM                  │
│    → Check VM IP address                │
│    → Verify KasmVNC is running          │
│    → Test network connectivity          │
│                                         │
│ ❓ Overlays not appearing               │
│    → Check MCP server status            │
│    → Verify Cherry AI connection        │
│    → Check browser console              │
│                                         │
│ ❓ Clipboard not working                │
│    → Enable clipboard bridge            │
│    → Check VM clipboard service         │
│    → Test connection                    │
│                                         │
│ [View Full Documentation]               │
│ [Report Issue on GitHub]                │
└─────────────────────────────────────────┘
```

**UX Issues to Note:**
- ❓ Is the help contextual (shows relevant help)?
- ❓ Are error messages actionable?
- ❓ Is there a diagnostic tool?

---

### Test 6.2: Error Handling

**Action:** Intentionally cause errors to test handling

**Scenarios to test:**
1. **Disconnect VM** - Does it show a clear error?
2. **Enter invalid IP** - Does it validate before saving?
3. **Stop MCP server** - Does the UI show degraded state?
4. **Network timeout** - Does it retry gracefully?

**Expected Error Messages:**
```
❌ Connection Failed
   Unable to connect to VM at 192.168.1.100:6901
   
   Possible causes:
   • VM is not running
   • KasmVNC service is stopped
   • Firewall blocking port 6901
   • Incorrect IP address
   
   [Retry] [Edit Connection] [View Logs]
```

**UX Issues to Note:**
- ❓ Are errors user-friendly (not technical jargon)?
- ❓ Do errors suggest solutions?
- ❓ Is there a way to report errors?

---

## Phase 7: Documentation Quality

### Test 7.1: README.md Comprehensiveness

**Checklist:**
- [ ] Clear project description
- [ ] Architecture diagram
- [ ] Installation instructions (host and VM)
- [ ] Usage examples
- [ ] Cherry AI integration guide
- [ ] Troubleshooting section
- [ ] Links to detailed docs

**Rating Scale:**
- ⭐⭐⭐⭐⭐ Excellent - Everything is clear
- ⭐⭐⭐⭐ Good - Minor improvements needed
- ⭐⭐⭐ Okay - Some confusion
- ⭐⭐ Poor - Hard to understand
- ⭐ Very Poor - Unusable

---

### Test 7.2: In-App Documentation

**What to check:**
- [ ] Is there a "Getting Started" guide in the UI?
- [ ] Are there video tutorials or GIFs?
- [ ] Is there a changelog?
- [ ] Are there example use cases?

**Expected In-App Docs:**
```
┌─────────────────────────────────────────┐
│ Getting Started                         │
├─────────────────────────────────────────┤
│ 1. Connect to Your VM                   │
│    [Watch Video] [Read Guide]           │
│                                         │
│ 2. Configure Cherry AI                  │
│    [Watch Video] [Read Guide]           │
│                                         │
│ 3. Create Your First Overlay            │
│    [Watch Video] [Read Guide]           │
│                                         │
│ 4. Advanced Features                    │
│    [Watch Video] [Read Guide]           │
│                                         │
│ [Skip Tutorial] [Next]                  │
└─────────────────────────────────────────┘
```

---

## Summary: UX/UI Issues Found

### Critical Issues (Must Fix)
- [ ] Issue 1: ___________________________________
- [ ] Issue 2: ___________________________________
- [ ] Issue 3: ___________________________________

### Major Issues (Should Fix)
- [ ] Issue 1: ___________________________________
- [ ] Issue 2: ___________________________________
- [ ] Issue 3: ___________________________________

### Minor Issues (Nice to Have)
- [ ] Issue 1: ___________________________________
- [ ] Issue 2: ___________________________________
- [ ] Issue 3: ___________________________________

---

## Overall UX/UI Rating

**Documentation:** ⭐⭐⭐⭐⭐ (1-5 stars)
**Installation:** ⭐⭐⭐⭐⭐ (1-5 stars)
**Web Interface:** ⭐⭐⭐⭐⭐ (1-5 stars)
**Configuration:** ⭐⭐⭐⭐⭐ (1-5 stars)
**Error Handling:** ⭐⭐⭐⭐⭐ (1-5 stars)
**Help System:** ⭐⭐⭐⭐⭐ (1-5 stars)

**Overall:** ⭐⭐⭐⭐⭐ (1-5 stars)

---

## Recommendations for Improvement

### For Non-Technical Users
1. Add a "Quick Start" wizard that guides through setup
2. Provide video tutorials for each major feature
3. Add more tooltips and contextual help
4. Simplify technical jargon (explain MCP, KasmVNC, etc.)

### For GUI Configuration
1. Add visual connection status indicators
2. Provide one-click VM detection
3. Add configuration import/export
4. Create preset configurations for common setups

### For Documentation
1. Add more screenshots and diagrams
2. Create a FAQ section
3. Add troubleshooting flowcharts
4. Provide example use cases with step-by-step guides

---

## Next Steps for Testing

1. **Install on your Fedora Desktop** (host)
2. **Install on your Fedora VM** (guest)
3. **Access the web interface** at http://localhost:8080
4. **Connect Cherry AI** to the MCP server
5. **Test overlay creation** with AI commands
6. **Document any issues** you encounter
7. **Rate the overall experience** using the checklist above

---

## Questions to Answer After Testing

1. **Could you complete the setup without Python knowledge?**
   - Yes / No / Partially

2. **Was the web interface intuitive?**
   - Yes / No / Somewhat

3. **Did Cherry AI integration work smoothly?**
   - Yes / No / Had issues

4. **Would you recommend this to a non-technical friend?**
   - Yes / No / With reservations

5. **What was the most confusing part?**
   - (Your answer here)

6. **What was the best part of the experience?**
   - (Your answer here)

---

## Contact & Support

If you encounter issues during testing:
- **GitHub Issues:** https://github.com/RyansOpenSourceRice/overlay-companion-mcp/issues
- **Documentation:** Check the `/docs` folder
- **Logs:** Check `podman logs overlay-companion`

---

**Happy Testing! 🚀**
