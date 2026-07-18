import AppKit
import CoreGraphics
import Foundation

final class CaptureFeedback {
    private var window: NSWindow?

    func flash(windowBounds: CGRect) {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        guard let top = NSScreen.screens.map(\.frame.maxY).max() else { return }
        let frame = CGRect(
            x: windowBounds.minX,
            y: top - windowBounds.maxY,
            width: windowBounds.width,
            height: windowBounds.height
        )
        let overlay = NSWindow(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        overlay.level = .screenSaver
        overlay.isOpaque = false
        overlay.backgroundColor = NSColor.white.withAlphaComponent(0.4)
        overlay.ignoresMouseEvents = true
        overlay.collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle]
        overlay.sharingType = .none
        overlay.hasShadow = false
        overlay.alphaValue = 0
        overlay.orderFrontRegardless()
        window = overlay
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.06
            overlay.animator().alphaValue = 1
        } completionHandler: { [weak self, weak overlay] in
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.12
                overlay?.animator().alphaValue = 0
            } completionHandler: {
                overlay?.orderOut(nil)
                self?.window = nil
            }
        }
    }
}
