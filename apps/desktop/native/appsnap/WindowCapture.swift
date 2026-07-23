import AppKit
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

private let maximumPNGBytes = 10 * 1024 * 1024
private let maximumDimension = 8_192
private let captureTimeout: TimeInterval = 6

struct SelectedWindow {
    let windowID: CGWindowID
    let bounds: CGRect
    let appName: String?
    let bundleIdentifier: String?
    let iconDataURL: String?
    let title: String?
}

private func appIconDataURL(for application: NSRunningApplication) -> String? {
    guard let path = application.bundleURL?.path else { return nil }
    let source = NSWorkspace.shared.icon(forFile: path)
    let target = NSImage(size: NSSize(width: 64, height: 64))
    target.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high
    source.draw(in: NSRect(x: 0, y: 0, width: 64, height: 64))
    target.unlockFocus()
    guard let tiff = target.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]),
          png.count <= 128_000
    else { return nil }
    return "data:image/png;base64,\(png.base64EncodedString())"
}

private func number(_ dictionary: [String: Any], _ key: CFString) -> NSNumber? {
    dictionary[key as String] as? NSNumber
}

func selectFrontmostWindow(excluding bundleIdentifier: String) -> Result<SelectedWindow, AppSnapFailure> {
    guard let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return .failure(AppSnapFailure(
            code: "window_list_unavailable",
            message: "macOS did not provide a window list."
        ))
    }

    var untitledFallback: (CGWindowID, CGRect, String?)?
    var selected: (CGWindowID, CGRect, String?)?
    var selectedApplication: NSRunningApplication?
    for candidate in windows {
        guard let ownerPID = number(candidate, kCGWindowOwnerPID)?.int32Value,
              number(candidate, kCGWindowLayer)?.intValue == 0,
              (number(candidate, kCGWindowAlpha)?.doubleValue ?? 1) > 0,
              (number(candidate, kCGWindowIsOnscreen)?.boolValue ?? true),
              number(candidate, kCGWindowSharingState)?.uint32Value != CGWindowSharingType.none.rawValue,
              let rawWindowID = number(candidate, kCGWindowNumber)?.uint32Value,
              let boundsDictionary = candidate[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
              bounds.width >= 2,
              bounds.height >= 2
        else { continue }

        if let selectedApplication, ownerPID != selectedApplication.processIdentifier {
            break
        }
        guard let application = NSRunningApplication(processIdentifier: ownerPID),
              !application.isTerminated,
              application.bundleIdentifier != bundleIdentifier
        else { continue }
        selectedApplication = application

        let title = (candidate[kCGWindowName as String] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let title, !title.isEmpty {
            selected = (rawWindowID, bounds, title)
            break
        }
        if untitledFallback == nil { untitledFallback = (rawWindowID, bounds, nil) }
    }
    guard let chosen = selected ?? untitledFallback else {
        return .failure(AppSnapFailure(
            code: "no_eligible_window",
            message: "No visible shareable window is available outside TeaCode."
        ))
    }
    guard let app = selectedApplication else {
        return .failure(AppSnapFailure(
            code: "no_frontmost_application",
            message: "There is no frontmost application to capture."
        ))
    }
    return .success(SelectedWindow(
        windowID: chosen.0,
        bounds: chosen.1,
        appName: app.localizedName,
        bundleIdentifier: app.bundleIdentifier,
        iconDataURL: appIconDataURL(for: app),
        title: chosen.2
    ))
}

private func backingScale(for bounds: CGRect) -> CGFloat {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return 2 }
    var displays = Array(repeating: CGDirectDisplayID(), count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return 2 }
    var bestArea: CGFloat = 0
    var bestScale: CGFloat = 2
    for display in displays.prefix(Int(count)) {
        let displayBounds = CGDisplayBounds(display)
        let intersection = displayBounds.intersection(bounds)
        let area = max(0, intersection.width) * max(0, intersection.height)
        if area > bestArea, displayBounds.width > 0 {
            bestArea = area
            bestScale = CGFloat(CGDisplayPixelsWide(display)) / displayBounds.width
        }
    }
    return max(1, bestScale)
}

private func captureDimensions(window: SCWindow, selectedBounds: CGRect) -> (Int, Int)? {
    let scale = backingScale(for: selectedBounds)
    var width = max(1, Int(ceil(window.frame.width * scale)))
    var height = max(1, Int(ceil(window.frame.height * scale)))
    guard width > 1, height > 1 else { return nil }
    let largest = max(width, height)
    if largest > maximumDimension {
        let reduction = Double(maximumDimension) / Double(largest)
        width = max(1, Int((Double(width) * reduction).rounded(.down)))
        height = max(1, Int((Double(height) * reduction).rounded(.down)))
    }
    return (width, height)
}

final class OneFrameCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    typealias Completion = (Result<CGImage, AppSnapFailure>) -> Void

    private let selection: SelectedWindow
    private let completion: Completion
    private let queue = DispatchQueue(label: "dev.jow.teacode.appsnap.stream")
    private let lock = NSLock()
    private var stream: SCStream?
    private var finished = false

    init(selection: SelectedWindow, completion: @escaping Completion) {
        self.selection = selection
        self.completion = completion
    }

    func start() {
        queue.asyncAfter(deadline: .now() + captureTimeout) { [weak self] in
            self?.finish(.failure(AppSnapFailure(
                code: "capture_timed_out",
                message: "Window capture timed out."
            )))
        }
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) {
            [weak self] content, error in
            self?.queue.async { self?.receive(content: content, error: error) }
        }
    }

    private func receive(content: SCShareableContent?, error: Error?) {
        if let error {
            finish(.failure(AppSnapFailure(
                code: "shareable_content_unavailable",
                message: "Could not inspect shareable windows: \(error.localizedDescription)"
            )))
            return
        }
        guard let window = content?.windows.first(where: { $0.windowID == selection.windowID }) else {
            finish(.failure(AppSnapFailure(
                code: "window_unavailable",
                message: "The selected window disappeared before capture."
            )))
            return
        }
        guard let (width, height) = captureDimensions(window: window, selectedBounds: selection.bounds) else {
            finish(.failure(AppSnapFailure(
                code: "invalid_window_dimensions",
                message: "The selected window has invalid dimensions."
            )))
            return
        }

        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.queueDepth = 1
        configuration.scalesToFit = true
        configuration.showsCursor = false
        configuration.colorSpaceName = CGColorSpace.sRGB as CFString
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let nextStream = SCStream(filter: filter, configuration: configuration, delegate: self)
        stream = nextStream
        do {
            try nextStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            nextStream.startCapture { [weak self] error in
                if let error {
                    self?.finish(.failure(AppSnapFailure(
                        code: "capture_start_failed",
                        message: "Could not start window capture: \(error.localizedDescription)"
                    )))
                }
            }
        } catch {
            finish(.failure(AppSnapFailure(
                code: "capture_setup_failed",
                message: "Could not configure window capture: \(error.localizedDescription)"
            )))
        }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen,
              sampleBuffer.isValid,
              sampleBuffer.dataReadiness == .ready,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(
                  sampleBuffer,
                  createIfNecessary: false
              ) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? NSNumber,
              status.intValue == SCFrameStatus.complete.rawValue,
              let buffer = sampleBuffer.imageBuffer
        else { return }

        let image = CIImage(cvPixelBuffer: buffer)
        let context = CIContext(options: [.cacheIntermediates: false])
        guard let cgImage = context.createCGImage(image, from: image.extent) else {
            finish(.failure(AppSnapFailure(
                code: "frame_conversion_failed",
                message: "Could not convert the captured frame."
            )))
            return
        }
        finish(.success(cgImage))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        finish(.failure(AppSnapFailure(
            code: "capture_stopped",
            message: "Window capture stopped: \(error.localizedDescription)"
        )))
    }

    private func finish(_ result: Result<CGImage, AppSnapFailure>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let activeStream = stream
        lock.unlock()
        activeStream?.stopCapture { _ in }
        completion(result)
    }
}

private func resized(_ image: CGImage, width: Int, height: Int) -> CGImage? {
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
              data: nil,
              width: width,
              height: height,
              bitsPerComponent: 8,
              bytesPerRow: 0,
              space: colorSpace,
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
}

func encodePNGWithinLimit(_ image: CGImage) throws -> Data {
    var current = image
    for _ in 0..<20 {
        guard let data = NSBitmapImageRep(cgImage: current).representation(using: .png, properties: [:]) else {
            throw AppSnapFailure(code: "png_encoding_failed", message: "Could not encode the window as PNG.")
        }
        if data.count < maximumPNGBytes { return data }
        let ratio = Double(maximumPNGBytes - 1) / Double(data.count)
        let scale = min(0.82, max(0.25, sqrt(ratio) * 0.9))
        let width = max(1, Int((Double(current.width) * scale).rounded(.down)))
        let height = max(1, Int((Double(current.height) * scale).rounded(.down)))
        guard (width < current.width || height < current.height),
              let next = resized(current, width: width, height: height)
        else { break }
        current = next
    }
    throw AppSnapFailure(
        code: "png_too_large",
        message: "The captured window could not be reduced below TeaCode's 10 MiB image limit."
    )
}

func preparePrivateOutputDirectory(_ directory: URL) throws {
    do {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    } catch {
        throw AppSnapFailure(
            code: "output_directory_unavailable",
            message: "Could not prepare the private capture directory: \(error.localizedDescription)"
        )
    }
}

private func writePrivatePNG(_ data: Data, id: String, directory: URL) throws -> (String, String) {
    let name = "appsnap-\(id).png"
    let destination = directory.appendingPathComponent(name)
    do {
        try data.write(to: destination, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        return (destination.path, name)
    } catch {
        try? FileManager.default.removeItem(at: destination)
        throw AppSnapFailure(
            code: "output_write_failed",
            message: "Could not write the captured PNG: \(error.localizedDescription)"
        )
    }
}

final class WindowCaptureCoordinator {
    private let emitter: NDJSONEmitter
    private let outputDirectory: URL
    private let excludedBundleIdentifier: String
    private let queue = DispatchQueue(label: "dev.jow.teacode.appsnap.capture")
    private let feedback = CaptureFeedback()
    private var activeCapture: OneFrameCapture?

    init(emitter: NDJSONEmitter, outputDirectory: URL, excludedBundleIdentifier: String) {
        self.emitter = emitter
        self.outputDirectory = outputDirectory
        self.excludedBundleIdentifier = excludedBundleIdentifier
    }

    func handleGesture() {
        queue.async { [weak self] in self?.beginCapture() }
    }

    private func beginCapture() {
        let id = UUID().uuidString.lowercased()
        let capturedAt = appSnapTimestamp()
        guard activeCapture == nil else {
            emitter.emitError(
                AppSnapFailure(code: "capture_in_progress", message: "An AppSnap is already being captured."),
                id: id,
                capturedAt: capturedAt
            )
            return
        }
        let selection = DispatchQueue.main.sync {
            selectFrontmostWindow(excluding: excludedBundleIdentifier)
        }
        emitter.emitTriggered(id: id, capturedAt: capturedAt)
        guard case let .success(window) = selection else {
            if case let .failure(failure) = selection {
                emitter.emitError(failure, id: id, capturedAt: capturedAt)
            }
            return
        }
        guard CGPreflightScreenCaptureAccess() else {
            emitter.emitError(
                AppSnapFailure(
                    code: "screen-recording-required",
                    message: "Screen Recording permission is required to capture a window."
                ),
                id: id,
                capturedAt: capturedAt
            )
            return
        }

        let capture = OneFrameCapture(selection: window) { [weak self] result in
            self?.queue.async {
                self?.complete(result, window: window, id: id, capturedAt: capturedAt)
            }
        }
        activeCapture = capture
        capture.start()
    }

    private func complete(
        _ result: Result<CGImage, AppSnapFailure>,
        window: SelectedWindow,
        id: String,
        capturedAt: String
    ) {
        defer { activeCapture = nil }
        switch result {
        case let .failure(failure):
            emitter.emitError(failure, id: id, capturedAt: capturedAt)
        case let .success(image):
            do {
                let png = try encodePNGWithinLimit(image)
                let (path, name) = try writePrivatePNG(png, id: id, directory: outputDirectory)
                DispatchQueue.main.async { [feedback] in feedback.flash(windowBounds: window.bounds) }
                emitter.emitCaptured(AppSnapCaptureResult(
                    id: id,
                    capturedAt: capturedAt,
                    path: path,
                    name: name,
                    sourceAppName: window.appName,
                    sourceBundleIdentifier: window.bundleIdentifier,
                    sourceAppIconDataUrl: window.iconDataURL,
                    sourceWindowTitle: window.title
                ))
            } catch let failure as AppSnapFailure {
                emitter.emitError(failure, id: id, capturedAt: capturedAt)
            } catch {
                emitter.emitError(
                    AppSnapFailure(code: "capture_processing_failed", message: error.localizedDescription),
                    id: id,
                    capturedAt: capturedAt
                )
            }
        }
    }
}
