import Foundation

struct AppSnapFailure: Error {
    let code: String
    let message: String
}

struct AppSnapCaptureResult {
    let id: String
    let capturedAt: String
    let path: String
    let name: String
    let sourceAppName: String?
    let sourceBundleIdentifier: String?
    let sourceAppIconDataUrl: String?
    let sourceWindowTitle: String?
}

func appSnapTimestamp(_ date: Date = Date()) -> String {
    ISO8601DateFormatter().string(from: date)
}

final class NDJSONEmitter {
    private let queue = DispatchQueue(label: "dev.jow.teacode.appsnap.protocol")

    func emitPermissions(inputMonitoring: Bool, screenRecording: Bool) {
        emit([
            "type": "permissions",
            "inputMonitoring": inputMonitoring ? "granted" : "denied",
            "screenRecording": screenRecording ? "granted" : "denied",
        ])
    }

    func emitReady() {
        emit(["type": "ready"])
    }

    func emitTriggered(id: String, capturedAt: String) {
        emit(["type": "triggered", "id": id, "capturedAt": capturedAt])
    }

    func emitCaptured(_ result: AppSnapCaptureResult) {
        var payload: [String: Any] = [
            "type": "captured",
            "id": result.id,
            "capturedAt": result.capturedAt,
            "path": result.path,
            "name": result.name,
        ]
        payload["sourceAppName"] = result.sourceAppName ?? NSNull()
        payload["sourceBundleIdentifier"] = result.sourceBundleIdentifier ?? NSNull()
        payload["sourceAppIconDataUrl"] = result.sourceAppIconDataUrl ?? NSNull()
        payload["sourceWindowTitle"] = result.sourceWindowTitle ?? NSNull()
        emit(payload)
    }

    func emitError(_ failure: AppSnapFailure, id: String? = nil, capturedAt: String? = nil) {
        var payload: [String: Any] = [
            "type": "error",
            "code": failure.code,
            "message": failure.message,
        ]
        if let id { payload["id"] = id }
        if let capturedAt { payload["capturedAt"] = capturedAt }
        emit(payload)
    }

    func diagnostic(_ message: String) {
        FileHandle.standardError.write(Data("[teacode-appsnap-helper] \(message)\n".utf8))
    }

    private func emit(_ payload: [String: Any]) {
        queue.sync {
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  var line = String(data: data, encoding: .utf8)
            else { return }
            line.append("\n")
            FileHandle.standardOutput.write(Data(line.utf8))
        }
    }
}
