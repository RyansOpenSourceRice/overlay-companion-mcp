# Task List

1. ✅ Analyze click-through overlay issue and framework alternatives
User identified that Avalonia overlays are transparent but not click-through. External GPT consultation suggests GTK4 with Gtk4DotNet for native Fedora Wayland support.
2. ✅ Implement basic click-through in current Avalonia implementation
Added IsHitTestVisible=false to overlay windows and content. This provides Avalonia-level click-through but not true OS-level click-through on Wayland.
3. ✅ Update project specifications to reflect GUI framework decision
Updated README.md and created comprehensive migration plan in test-click-through.md documenting the Wayland click-through limitations and GTK4 migration strategy.
4. ✅ Test current Avalonia click-through implementation
Build succeeded, smoke test passes in ~5s. Current implementation provides Avalonia-level click-through with IsHitTestVisible=false.
5. ✅ Create detailed migration plan from Avalonia to GTK4
Documented comprehensive 4-phase migration plan with effort estimation (3-4 weeks) and technical details in test-click-through.md.
6. ✅ Commit current click-through improvements and documentation
Committed all changes with comprehensive commit message. Added click-through functionality and GTK4 migration plan documentation.
7. ⏳ Evaluate migration from Avalonia to GTK4 for native Wayland click-through
Decision needed: Proceed with GTK4 migration for true Wayland click-through or accept current limitations with Avalonia.

