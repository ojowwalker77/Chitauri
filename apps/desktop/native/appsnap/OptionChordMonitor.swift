import CoreGraphics
import Foundation

private let leftOptionKey = CGKeyCode(0x3A)
private let rightOptionKey = CGKeyCode(0x3D)
private let leftOptionDeviceFlag = CGEventFlags(rawValue: 0x20)
private let rightOptionDeviceFlag = CGEventFlags(rawValue: 0x40)

private func optionChordEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if let userInfo {
        let monitor = Unmanaged<OptionChordMonitor>.fromOpaque(userInfo).takeUnretainedValue()
        monitor.receive(type: type, event: event)
    }
    return Unmanaged.passUnretained(event)
}

final class OptionChordMonitor {
    private let emitter: NDJSONEmitter
    private let onChord: () -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var retryTimer: Timer?
    private var leftDown = false
    private var rightDown = false
    private var latched = false
    private var lastErrorCode: String?

    init(emitter: NDJSONEmitter, onChord: @escaping () -> Void) {
        self.emitter = emitter
        self.onChord = onChord
    }

    func start() {
        if !install() {
            retryTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                _ = self?.install()
            }
        }
    }

    fileprivate func receive(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            reset()
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            emitter.emitError(
                AppSnapFailure(
                    code: "event_tap_disabled",
                    message: "macOS disabled the passive Option-key listener; TeaCode re-enabled it."
                ),
                capturedAt: appSnapTimestamp()
            )
            return
        }
        guard type == .flagsChanged else { return }
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        guard keyCode == leftOptionKey || keyCode == rightOptionKey else { return }

        leftDown = event.flags.contains(leftOptionDeviceFlag)
        rightDown = event.flags.contains(rightOptionDeviceFlag)
        if !event.flags.contains(.maskAlternate) {
            reset()
            return
        }
        if leftDown && rightDown && !latched {
            latched = true
            onChord()
        } else if !leftDown || !rightDown {
            latched = false
        }
    }

    private func reset() {
        leftDown = false
        rightDown = false
        latched = false
    }

    private func reportOnce(_ failure: AppSnapFailure) {
        guard lastErrorCode != failure.code else { return }
        lastErrorCode = failure.code
        emitter.emitError(failure, capturedAt: appSnapTimestamp())
    }

    private func install() -> Bool {
        guard tap == nil else { return true }
        guard CGPreflightListenEventAccess() else {
            reportOnce(AppSnapFailure(
                code: "input-monitoring-required",
                message: "Input Monitoring permission is required for the two-Option-key shortcut."
            ))
            return false
        }
        let flagsChangedMask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
        guard let newTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: flagsChangedMask,
            callback: optionChordEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ), let newSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, newTap, 0)
        else {
            reportOnce(AppSnapFailure(
                code: "event_tap_unavailable",
                message: "macOS could not create the passive Option-key listener."
            ))
            return false
        }
        tap = newTap
        source = newSource
        lastErrorCode = nil
        CFRunLoopAddSource(CFRunLoopGetMain(), newSource, .commonModes)
        CGEvent.tapEnable(tap: newTap, enable: true)
        retryTimer?.invalidate()
        retryTimer = nil
        emitter.emitReady()
        return true
    }
}
