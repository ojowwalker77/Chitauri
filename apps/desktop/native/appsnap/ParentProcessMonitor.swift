import Darwin
import Foundation

final class ParentProcessMonitor {
    private let originalParent = getppid()
    private var timer: Timer?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self else { return }
            let currentParent = getppid()
            if currentParent == 1 || currentParent != self.originalParent {
                exit(EXIT_SUCCESS)
            }
        }
    }
}
