import CoreGraphics
import Foundation

/// Which pair of physical modifier keys must be held together to trigger AppSnap.
/// Must stay in sync with `DesktopAppSnapChord` in packages/contracts/src/ipc.ts.
enum ModifierChord: String {
    case option
    case shift
    case control
    case command

    static let `default`: ModifierChord = .option

    var label: String {
        switch self {
        case .option: return "Option"
        case .shift: return "Shift"
        case .control: return "Control"
        case .command: return "Command"
        }
    }

    var leftKeyCode: CGKeyCode {
        switch self {
        case .option: return CGKeyCode(0x3A)
        case .shift: return CGKeyCode(0x38)
        case .control: return CGKeyCode(0x3B)
        case .command: return CGKeyCode(0x37)
        }
    }

    var rightKeyCode: CGKeyCode {
        switch self {
        case .option: return CGKeyCode(0x3D)
        case .shift: return CGKeyCode(0x3C)
        case .control: return CGKeyCode(0x3E)
        case .command: return CGKeyCode(0x36)
        }
    }

    // Device-dependent modifier bits (IOLLEvent.h NX_DEVICE*KEYMASK). Unlike the higher-level
    // `CGEventFlags.mask*` constants below, these distinguish which physical side (left/right)
    // of the same logical modifier is down, which is what the chord detection needs.
    var leftDeviceFlag: CGEventFlags {
        switch self {
        case .option: return CGEventFlags(rawValue: 0x20)
        case .shift: return CGEventFlags(rawValue: 0x02)
        case .control: return CGEventFlags(rawValue: 0x01)
        case .command: return CGEventFlags(rawValue: 0x08)
        }
    }

    var rightDeviceFlag: CGEventFlags {
        switch self {
        case .option: return CGEventFlags(rawValue: 0x40)
        case .shift: return CGEventFlags(rawValue: 0x04)
        case .control: return CGEventFlags(rawValue: 0x2000)
        case .command: return CGEventFlags(rawValue: 0x10)
        }
    }

    var overallMask: CGEventFlags {
        switch self {
        case .option: return .maskAlternate
        case .shift: return .maskShift
        case .control: return .maskControl
        case .command: return .maskCommand
        }
    }
}

private func modifierChordEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if let userInfo {
        let monitor = Unmanaged<ModifierChordMonitor>.fromOpaque(userInfo).takeUnretainedValue()
        monitor.receive(type: type, event: event)
    }
    return Unmanaged.passUnretained(event)
}

final class ModifierChordMonitor {
    private let chord: ModifierChord
    private let emitter: NDJSONEmitter
    private let onChord: () -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var retryTimer: Timer?
    private var leftDown = false
    private var rightDown = false
    private var latched = false
    private var lastErrorCode: String?

    init(chord: ModifierChord, emitter: NDJSONEmitter, onChord: @escaping () -> Void) {
        self.chord = chord
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
                    message: "macOS disabled the passive \(chord.label)-key listener; TeaCode re-enabled it."
                ),
                capturedAt: appSnapTimestamp()
            )
            return
        }
        guard type == .flagsChanged else { return }
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        guard keyCode == chord.leftKeyCode || keyCode == chord.rightKeyCode else { return }

        leftDown = event.flags.contains(chord.leftDeviceFlag)
        rightDown = event.flags.contains(chord.rightDeviceFlag)
        if !event.flags.contains(chord.overallMask) {
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
                message: "Input Monitoring permission is required for the two-\(chord.label)-key shortcut."
            ))
            return false
        }
        let flagsChangedMask = CGEventMask(1) << CGEventType.flagsChanged.rawValue
        guard let newTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: flagsChangedMask,
            callback: modifierChordEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ), let newSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, newTap, 0)
        else {
            reportOnce(AppSnapFailure(
                code: "event_tap_unavailable",
                message: "macOS could not create the passive \(chord.label)-key listener."
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
