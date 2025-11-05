import UIKit
import Flutter

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    // -------------------------------------------------------------------
    // 👇 START OF FIX: Disable iOS Interactive Pop Gesture
    // -------------------------------------------------------------------
    if let controller = window?.rootViewController as? FlutterViewController {
        // The FlutterViewController is usually embedded in a UINavigationController.
        // We look for that navigation controller and disable its swipe-back gesture.
        // This disables the gesture for ALL screens in the app.
        controller.navigationController?.interactivePopGestureRecognizer?.isEnabled = false
    }
    // -------------------------------------------------------------------
    // 👆 END OF FIX
    // -------------------------------------------------------------------

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}