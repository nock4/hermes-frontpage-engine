// Deny otherwise-native sensor capture throughout a browser context. Replace
// only the prototype method: dedicated synthetic navigator.mediaDevices objects
// remain in control, regardless of init-script ordering. Never open hardware.
export function denyOtherwiseNativeCapture() {
  if (typeof MediaDevices === 'undefined') return
  MediaDevices.prototype.getUserMedia = async function () {
    throw new DOMException('Automated sensor fixture: capture not granted; explicit synthetic stream required', 'NotAllowedError')
  }
}
