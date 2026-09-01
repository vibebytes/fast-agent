import CryptoKit
import ExpoModulesCore

private func certificateFingerprint(_ certificate: SecCertificate) -> String {
  let der = SecCertificateCopyData(certificate) as Data
  let digest = SHA256.hash(data: der)
  return "sha256:" + digest.map { String(format: "%02x", $0) }.joined()
}

private func normalizePin(_ raw: String?) -> String? {
  guard var hex = raw?.lowercased() else { return nil }
  if hex.hasPrefix("sha256:") { hex = String(hex.dropFirst(7)) }
  hex = hex.replacingOccurrences(of: "[^0-9a-f]", with: "", options: .regularExpression)
  return hex.isEmpty ? nil : "sha256:\(hex)"
}

private final class ProbeDelegate: NSObject, URLSessionDelegate {
  var fingerprint: String?
  var failure: String?

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    defer { completionHandler(.cancelAuthenticationChallenge, nil) }
    guard let trust = challenge.protectionSpace.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
      let leaf = chain.first
    else {
      failure = "no server certificate"
      return
    }
    fingerprint = certificateFingerprint(leaf)
  }
}

private final class SocketDelegate: NSObject, URLSessionDelegate, URLSessionWebSocketDelegate {
  let pin: String
  var onOpen: (() -> Void)?
  var onFail: ((String) -> Void)?
  var onClose: (() -> Void)?

  init(pin: String) {
    self.pin = pin
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard let trust = challenge.protectionSpace.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
      let leaf = chain.first
    else {
      onFail?("no server certificate")
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let got = certificateFingerprint(leaf)
    if got == pin {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      onFail?("server fingerprint \(got) does not match pinned \(pin)")
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    onOpen?()
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    onClose?()
  }
}

public class FastBridgeTlsModule: Module {
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private var socketDelegate: SocketDelegate?

  public func definition() -> ModuleDefinition {
    Name("FastBridgeTls")
    Events("open", "message", "error", "close")

    AsyncFunction("probe") { (url: String, expected: String?, promise: Promise) in
      guard let target = URL(string: url) else {
        promise.reject("ERR_INVALID_URL", "invalid url: \(url)")
        return
      }
      let delegate = ProbeDelegate()
      let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
      var request = URLRequest(url: target)
      request.timeoutInterval = 10
      request.httpMethod = "GET"
      let task = session.dataTask(with: request) { _, _, _ in
        session.finishTasksAndInvalidate()
        if let fingerprint = delegate.fingerprint {
          if let pin = normalizePin(expected), fingerprint != pin {
            promise.reject(
              "ERR_FINGERPRINT_MISMATCH",
              "server fingerprint \(fingerprint) does not match pinned \(pin)"
            )
          } else {
            promise.resolve(fingerprint)
          }
        } else {
          promise.reject("ERR_PROBE_FAILED", delegate.failure ?? "TLS handshake failed")
        }
      }
      task.resume()
    }

    AsyncFunction("connect") { (url: String, fingerprint: String, promise: Promise) in
      guard let target = URL(string: url), let pin = normalizePin(fingerprint) else {
        promise.reject("ERR_INVALID_URL", "invalid url or fingerprint")
        return
      }
      self.disconnectSocket()
      var settled = false
      let delegate = SocketDelegate(pin: pin)
      delegate.onOpen = {
        if !settled {
          settled = true
          promise.resolve(nil)
        }
        self.sendEvent("open", [:])
        self.receiveLoop()
      }
      delegate.onFail = { message in
        if !settled {
          settled = true
          promise.reject("ERR_CONNECT_FAILED", message)
        }
        self.sendEvent("error", ["message": message])
        self.sendEvent("close", [:])
      }
      delegate.onClose = {
        self.sendEvent("close", [:])
      }
      self.socketDelegate = delegate
      let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
      self.session = session
      let task = session.webSocketTask(with: target)
      self.task = task
      task.resume()
    }

    Function("send") { (text: String) -> Bool in
      guard let task = self.task else { return false }
      task.send(.string(text)) { _ in }
      return true
    }

    Function("disconnect") {
      self.disconnectSocket()
    }
  }

  private func receiveLoop() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(.string(let text)):
        self.sendEvent("message", ["data": text])
        self.receiveLoop()
      case .success:
        self.receiveLoop()
      case .failure(let error):
        self.sendEvent("error", ["message": error.localizedDescription])
        self.sendEvent("close", [:])
      }
    }
  }

  private func disconnectSocket() {
    task?.cancel(with: .goingAway, reason: nil)
    session?.invalidateAndCancel()
    task = nil
    session = nil
    socketDelegate = nil
  }
}
