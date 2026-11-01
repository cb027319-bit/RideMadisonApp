import { Linking } from 'react-native';

/** Bike directions in Google Maps (app if installed, otherwise browser).
 *  In-app turn-by-turn routing is a later milestone. */
export function openBikeDirections(lat: number, lon: number) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=bicycling`;
  void Linking.openURL(url);
}

/** Bike directions in Apple Maps from the rider's location. */
export function openAppleBikeDirections(lat: number, lon: number) {
  void Linking.openURL(`https://maps.apple.com/directions?destination=${lat},${lon}&mode=cycling`);
}

export function callPhone(phone: string) {
  void Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}

export function openWebsite(url: string) {
  void Linking.openURL(/^https?:\/\//.test(url) ? url : `https://${url}`);
}
