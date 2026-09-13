import Foundation
import AppKit
import ScreenCaptureKit
import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Darwin

// Window-only ScreenCaptureKit capture. No display/application filter, microphone, or system audio.
// Build: xcrun swiftc -swift-version 5 -parse-as-library -module-cache-path /tmp/missiondeck-swift-cache scripts/demo-video/capture-window.swift -o /tmp/missiondeck-window-recorder
// List (read-only, never prompts): /tmp/missiondeck-window-recorder list
// Record after selecting an exact window: /tmp/missiondeck-window-recorder record --window-id 123 --output /absolute/new.mp4 --duration 180 --width 1920
// SIGINT/SIGTERM stop gracefully and finalize the MP4; an existing output is never overwritten.

private func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
       let line = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}
private struct CaptureError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
private final class RunState: @unchecked Sendable {
    private let lock = NSLock()
    private var stopFlag = false
    private var errorText: String?
    func stop(_ reason: String? = nil) { lock.lock(); stopFlag = true; if let reason { errorText = reason }; lock.unlock() }
    func snapshot() -> (Bool, String?) { lock.lock(); defer { lock.unlock() }; return (stopFlag, errorText) }
}

@available(macOS 14.2, *)
private final class StreamEvents: NSObject, SCStreamDelegate {
    let state: RunState
    init(state: RunState) { self.state = state }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        state.stop("ScreenCaptureKit stopped the selected-window stream: \((error as NSError).code).")
    }
    @available(macOS 15.2, *)
    func streamDidBecomeInactive(_ stream: SCStream) { state.stop("The selected window became unavailable.") }
}

@available(macOS 14.2, *)
private final class WindowRecorder: NSObject, SCStreamOutput, @unchecked Sendable {
    let stream: SCStream
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    let queue = DispatchQueue(label: "missiondeck.window-video.frames")
    let state: RunState
    let streamEvents: StreamEvents
    let width: Int
    let height: Int
    private var firstPTS: CMTime?
    private var lastPTS = CMTime.zero
    private var latestPixel: CVPixelBuffer?
    private var receivedFrames = 0
    private var droppedFrames = 0
    private var startedAt = ProcessInfo.processInfo.systemUptime
    private var accepting = true
    private var firstFrameEmitted = false

    init(window: SCWindow, output: URL, maxWidth: Int, state: RunState) throws {
        self.state = state
        let events = StreamEvents(state: state)
        streamEvents = events
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = CGFloat(filter.pointPixelScale)
        let source = filter.contentRect.size
        let nativeWidth = max(2, Int(source.width * scale))
        let nativeHeight = max(2, Int(source.height * scale))
        let ratio = min(1.0, Double(maxWidth) / Double(nativeWidth))
        width = max(2, Int(Double(nativeWidth) * ratio) / 2 * 2)
        height = max(2, Int(Double(nativeHeight) * ratio) / 2 * 2)
        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.queueDepth = 5
        configuration.showsCursor = true
        configuration.capturesAudio = false
        configuration.excludesCurrentProcessAudio = true
        configuration.scalesToFit = true
        configuration.preservesAspectRatio = true
        configuration.ignoreShadowsSingleWindow = true
        configuration.ignoreGlobalClipSingleWindow = true
        configuration.includeChildWindows = false
        configuration.shouldBeOpaque = true
        configuration.captureResolution = .best
        configuration.streamName = "MissionDeck selected Chrome window"
        if #available(macOS 15.0, *) {
            configuration.captureMicrophone = false
            configuration.showMouseClicks = true
        }
        stream = SCStream(filter: filter, configuration: configuration, delegate: events)
        writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 10_000_000,
                AVVideoExpectedSourceFrameRateKey: 30,
                AVVideoMaxKeyFrameIntervalKey: 60,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ])
        super.init()
        guard writer.canAdd(input) else { throw CaptureError(message: "AVAssetWriter cannot encode this selected window size.") }
        writer.add(input)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    }
    func start() async throws {
        guard writer.startWriting() else { throw CaptureError(message: "The MP4 writer could not start.") }
        writer.startSession(atSourceTime: .zero)
        startedAt = ProcessInfo.processInfo.systemUptime
        do { try await stream.startCapture() }
        catch { writer.cancelWriting(); throw error }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard accepting, type == .screen, CMSampleBufferIsValid(sampleBuffer), CMSampleBufferDataIsReady(sampleBuffer),
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let rawStatus = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: rawStatus) == .complete,
              let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstPTS == nil { firstPTS = pts }
        let relative = CMTimeSubtract(pts, firstPTS!)
        guard relative.isValid, CMTimeCompare(relative, lastPTS) >= 0 else { return }
        latestPixel = pixel
        guard input.isReadyForMoreMediaData else { droppedFrames += 1; return }
        if adaptor.append(pixel, withPresentationTime: relative) {
            receivedFrames += 1; lastPTS = relative
            if !firstFrameEmitted {
                firstFrameEmitted = true
                emit(["event": "first_frame", "width": width, "height": height, "cursor": true, "audio": false])
            }
        } else { state.stop("The MP4 encoder stopped accepting frames.") }
    }
    func finish() async throws -> [String: Any] {
        try? await stream.stopCapture()
        let stats: (Int, Int, Double) = await withCheckedContinuation { continuation in
            queue.async {
                self.accepting = false
                let duration = ProcessInfo.processInfo.systemUptime - self.startedAt
                if let pixel = self.latestPixel, self.input.isReadyForMoreMediaData {
                    let end = CMTime(seconds: max(duration, CMTimeGetSeconds(self.lastPTS) + 1.0 / 30.0), preferredTimescale: 600)
                    _ = self.adaptor.append(pixel, withPresentationTime: end)
                    self.lastPTS = end
                }
                self.input.markAsFinished()
                continuation.resume(returning: (self.receivedFrames, self.droppedFrames, CMTimeGetSeconds(self.lastPTS)))
            }
        }
        guard stats.0 > 0 else { writer.cancelWriting(); throw CaptureError(message: "No frame was captured. Screen access or the selected window may be unavailable.") }
        await writer.finishWriting()
        guard writer.status == .completed else { throw CaptureError(message: "MP4 finalization failed; retain the partial file for inspection.") }
        return ["frames": stats.0, "droppedFrames": stats.1, "durationSeconds": stats.2, "width": width, "height": height]
    }
}

@main
private struct CaptureWindowMain {
    static func main() async {
        do { try await run() }
        catch { emit(["event": "error", "message": error.localizedDescription]); exit(1) }
    }
    static func run() async throws {
        // Establish the WindowServer connection for a command-line process before creating a filter.
        _ = NSApplication.shared
        _ = CGMainDisplayID()
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first, ["list", "record"].contains(command) else {
            throw CaptureError(message: "Use list, or record --window-id ID --output /absolute/new.mp4 --duration 180 [--width 1920].")
        }
        guard CGPreflightScreenCaptureAccess() else {
            emit(["event": "permission", "screenCaptureAllowed": false, "requestedPermission": false])
            throw CaptureError(message: "Screen recording access is unavailable. This tool does not request access or record another surface.")
        }
        guard #available(macOS 14.2, *) else { throw CaptureError(message: "This window-only recorder requires macOS 14.2 or later.") }
        // The root may operate the authorized tab in the background while recording.
        // Record lookup keeps the exact window ID, including an occluded/offscreen window; never switch surfaces.
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: command == "list")
        let windows = content.windows.filter {
            let bundle = $0.owningApplication?.bundleIdentifier ?? ""
            return ["com.google.Chrome", "com.google.Chrome.canary", "com.google.Chrome.beta"].contains(bundle)
                && $0.windowLayer == 0 && $0.frame.width >= 300 && $0.frame.height >= 200
        }
        if command == "list" {
            emit(["event": "windows", "screenCaptureAllowed": true, "recordingStarted": false, "windows": windows.map { [
                "windowId": $0.windowID,
                "title": $0.title ?? "",
                "application": $0.owningApplication?.applicationName ?? "",
                "bundleId": $0.owningApplication?.bundleIdentifier ?? "",
                "width": $0.frame.width,
                "height": $0.frame.height,
            ] as [String: Any] }])
            return
        }
        func option(_ name: String) -> String? { guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return nil }; return args[index + 1] }
        guard let idText = option("--window-id"), let id = UInt32(idText), let window = windows.first(where: { $0.windowID == id }) else {
            throw CaptureError(message: "The exact requested Chrome window was not found. Run list and choose an ID; no fallback is permitted.")
        }
        guard let path = option("--output"), path.hasPrefix("/"), path.hasSuffix(".mp4") else { throw CaptureError(message: "Specify an absolute new MP4 output path.") }
        let output = URL(fileURLWithPath: path)
        guard !FileManager.default.fileExists(atPath: path) else { throw CaptureError(message: "The output already exists and will not be overwritten.") }
        let duration = Double(option("--duration") ?? "180") ?? 0
        let maxWidth = Int(option("--width") ?? "1920") ?? 0
        guard duration >= 1 && duration <= 600 && maxWidth >= 640 && maxWidth <= 3840 else { throw CaptureError(message: "Duration must be 1–600 seconds and width 640–3840 pixels.") }
        try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
        let state = RunState()
        let recorder = try WindowRecorder(window: window, output: output, maxWidth: maxWidth, state: state)
        signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
        let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        interrupt.setEventHandler { state.stop() }; terminate.setEventHandler { state.stop() }
        interrupt.resume(); terminate.resume()
        try await recorder.start()
        emit(["event": "recording", "startedAtUTC": ISO8601DateFormatter().string(from: Date()), "pid": getpid(), "windowId": id, "windowTitle": window.title ?? "", "output": path, "fpsLimit": 30, "durationLimit": duration, "width": recorder.width, "height": recorder.height, "filter": "desktopIndependentWindow", "cursor": true, "audio": false, "childWindows": false])
        let deadline = ProcessInfo.processInfo.systemUptime + duration
        while ProcessInfo.processInfo.systemUptime < deadline && !state.snapshot().0 { try await Task.sleep(nanoseconds: 100_000_000) }
        let stats = try await recorder.finish()
        interrupt.cancel(); terminate.cancel()
        emit(stats.merging(["event": "finished", "output": path, "windowId": id]) { _, new in new })
        if let error = state.snapshot().1 { throw CaptureError(message: error) }
    }
}
