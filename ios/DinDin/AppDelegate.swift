import UIKit
import FirebaseCore
import CoreLocation

private final class DinDinSafetyLocationReporter: NSObject, CLLocationManagerDelegate {
  static let shared = DinDinSafetyLocationReporter()
  private let manager = CLLocationManager()
  private var completion: ((UIBackgroundFetchResult) -> Void)?
  private var timeout: DispatchWorkItem?

  override private init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
  }

  func configure(apiBaseUrl: String, token: String) {
    UserDefaults.standard.set(apiBaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: "dindin.safety.api")
    UserDefaults.standard.set(token, forKey: "dindin.safety.token")
    if manager.authorizationStatus == .authorizedAlways {
      manager.startMonitoringSignificantLocationChanges()
    }
  }

  func clear() {
    manager.stopMonitoringSignificantLocationChanges()
    UserDefaults.standard.removeObject(forKey: "dindin.safety.api")
    UserDefaults.standard.removeObject(forKey: "dindin.safety.token")
  }

  func capture(completion: @escaping (UIBackgroundFetchResult) -> Void) {
    guard manager.authorizationStatus == .authorizedAlways else {
      completion(.noData)
      return
    }
    self.completion?(.failed)
    self.completion = completion
    manager.requestLocation()
    let timeout = DispatchWorkItem { [weak self] in self?.finish(.failed) }
    self.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard completion != nil, let location = locations.last else { return }
    let age = -location.timestamp.timeIntervalSinceNow
    guard age >= 0, age <= 120 else {
      finish(.failed)
      return
    }
    guard
      let base = UserDefaults.standard.string(forKey: "dindin.safety.api"),
      let token = UserDefaults.standard.string(forKey: "dindin.safety.token"),
      let url = URL(string: "\(base)/v1/me/safety-location")
    else {
      finish(.failed)
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    request.timeoutInterval = 10
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracy": location.horizontalAccuracy,
      "capturedAt": ISO8601DateFormatter().string(from: location.timestamp),
    ])
    URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      DispatchQueue.main.async { self?.finish((200...299).contains(status) ? .newData : .failed) }
    }.resume()
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if completion != nil { finish(.failed) }
  }

  private func finish(_ result: UIBackgroundFetchResult) {
    timeout?.cancel()
    timeout = nil
    let callback = completion
    completion = nil
    callback?(result)
  }
}

@objc(DinDinSafetyLocation)
final class DinDinSafetyLocationModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func configure(_ apiBaseUrl: String, token: String) {
    DinDinSafetyLocationReporter.shared.configure(apiBaseUrl: apiBaseUrl, token: token)
  }

  @objc func clearConfiguration() {
    DinDinSafetyLocationReporter.shared.clear()
  }
}

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()
    return true
  }

  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    let type = String(describing: userInfo["type"] ?? "")
    let stage = String(describing: userInfo["stage"] ?? "")
    guard type == "dindin-reminder", stage == "2" else {
      completionHandler(.noData)
      return
    }
    DinDinSafetyLocationReporter.shared.capture(completion: completionHandler)
  }
}
