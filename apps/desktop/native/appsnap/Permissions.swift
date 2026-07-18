import CoreGraphics
import Foundation

struct AppSnapPermissions {
    static func current() -> (inputMonitoring: Bool, screenRecording: Bool) {
        (CGPreflightListenEventAccess(), CGPreflightScreenCaptureAccess())
    }

    static func request() -> (inputMonitoring: Bool, screenRecording: Bool) {
        if !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
        if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
        return current()
    }
}
