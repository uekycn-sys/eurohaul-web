import { CityDepot } from '../map/types';
import { ParkingGuideState } from '../store/useGameStore';

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Evaluates trailer position, angular alignment, and stationary velocity
 * inside the destination depot's illuminated parking bay.
 */
export class ParkingValidator {
  public evaluate(
    depot: CityDepot | null,
    trailerX: number,
    trailerZ: number,
    trailerYaw: number,
    trailerAttached: boolean,
    speedKmh: number
  ): ParkingGuideState {
    if (!depot) {
      return {
        active: false,
        aligned: false,
        distanceMeters: 999,
        angleErrorDeg: 0,
        speedKmh,
        readyToDeliver: false,
      };
    }

    const [bx, , bz] = depot.parkingBayPosition;
    const distanceMeters = Math.hypot(trailerX - bx, trailerZ - bz);
    if (distanceMeters > 85) {
      return {
        active: false,
        aligned: false,
        distanceMeters,
        angleErrorDeg: 0,
        speedKmh,
        readyToDeliver: false,
      };
    }

    // Allow either forward pull-in or reverse backing alignment within +-16 degrees
    const diffForward = Math.abs(wrapAngle(trailerYaw - depot.parkingBayHeadingRad));
    const diffReverse = Math.abs(wrapAngle(trailerYaw - (depot.parkingBayHeadingRad + Math.PI)));
    const angleErrorRad = Math.min(diffForward, diffReverse);
    const angleErrorDeg = Math.round((angleErrorRad * 180) / Math.PI);

    const aligned = trailerAttached && distanceMeters <= 3.6 && angleErrorDeg <= 16;
    const readyToDeliver = aligned && Math.abs(speedKmh) <= 3.5;

    return {
      active: true,
      aligned,
      distanceMeters: Number(distanceMeters.toFixed(1)),
      angleErrorDeg,
      speedKmh: Math.round(Math.abs(speedKmh)),
      readyToDeliver,
    };
  }
}
