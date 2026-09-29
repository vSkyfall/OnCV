import { distance } from "@turf/distance";
import { point } from "@turf/helpers";
import { COORDINATE_SCALE } from "@/config/contract";

export type LatLng = { lat: number; lng: number };

export const toScaledCoordinate = (degrees: number): bigint => BigInt(Math.round(degrees * COORDINATE_SCALE));
export const fromScaledCoordinate = (scaled: bigint): number => Number(scaled) / COORDINATE_SCALE;

/** Great-circle distance in kilometres (Turf uses [lng, lat] order). */
export function distanceKm(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: "kilometers" });
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function getCurrentPosition(options?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Bu tarayıcı konum servislerini desteklemiyor."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
      ...options,
    });
  });
}

export function geolocationErrorMessage(error: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Konum yalnızca HTTPS üzerinden alınabilir. Uygulamayı HTTPS adresinden açın.";
  }
  const code = (error as GeolocationPositionError | undefined)?.code;
  switch (code) {
    case 1:
      return "Konum izni reddedildi. Tarayıcı ayarlarından bu site için konum iznini açın.";
    case 2:
      return "Konum belirlenemedi. GPS / Wi-Fi açık olduğundan emin olun.";
    case 3:
      return "Konum isteği zaman aşımına uğradı. Tekrar deneyin.";
    default:
      return error instanceof Error ? error.message : "Konum alınamadı.";
  }
}
