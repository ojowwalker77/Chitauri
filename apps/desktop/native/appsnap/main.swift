import AppKit
import Foundation

let emitter = NDJSONEmitter()
let arguments = Array(CommandLine.arguments.dropFirst())

if arguments == ["--check-permissions"] {
    let permissions = AppSnapPermissions.current()
    emitter.emitPermissions(
        inputMonitoring: permissions.inputMonitoring,
        screenRecording: permissions.screenRecording
    )
    exit(EXIT_SUCCESS)
}

if arguments == ["--request-permissions"] {
    let permissions = AppSnapPermissions.request()
    emitter.emitPermissions(
        inputMonitoring: permissions.inputMonitoring,
        screenRecording: permissions.screenRecording
    )
    exit(EXIT_SUCCESS)
}

guard arguments.first == "--watch",
      let outputIndex = arguments.firstIndex(of: "--output-dir"),
      arguments.indices.contains(outputIndex + 1),
      let excludedIndex = arguments.firstIndex(of: "--excluded-bundle-id"),
      arguments.indices.contains(excludedIndex + 1)
else {
    emitter.emitError(AppSnapFailure(
        code: "invalid_arguments",
        message: "Expected --check-permissions, --request-permissions, or --watch arguments."
    ))
    exit(EXIT_FAILURE)
}

let chord: ModifierChord
if let chordIndex = arguments.firstIndex(of: "--chord"), arguments.indices.contains(chordIndex + 1) {
    guard let parsedChord = ModifierChord(rawValue: arguments[chordIndex + 1]) else {
        emitter.emitError(AppSnapFailure(
            code: "invalid_arguments",
            message: "Unknown --chord value; expected option, shift, control, or command."
        ))
        exit(EXIT_FAILURE)
    }
    chord = parsedChord
} else {
    chord = .default
}

let outputDirectory = URL(fileURLWithPath: arguments[outputIndex + 1], isDirectory: true)
do {
    try preparePrivateOutputDirectory(outputDirectory)
} catch let failure as AppSnapFailure {
    emitter.emitError(failure)
    exit(EXIT_FAILURE)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let coordinator = WindowCaptureCoordinator(
    emitter: emitter,
    outputDirectory: outputDirectory,
    excludedBundleIdentifier: arguments[excludedIndex + 1]
)
let monitor = ModifierChordMonitor(chord: chord, emitter: emitter) { coordinator.handleGesture() }
let parentMonitor = ParentProcessMonitor()
parentMonitor.start()
monitor.start()
RunLoop.main.run()
