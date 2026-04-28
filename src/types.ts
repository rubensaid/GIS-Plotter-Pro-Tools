
export interface Point {
  lat: number;
  lng: number;
}

export interface UTMCoordinate {
  easting: number;
  northing: number;
  zoneNum: number;
  zoneLetter: string;
}

export type CoordType = 'UTM' | 'Decimal';

export interface GeoShape {
  id: string;
  type: 'polygon' | 'polyline';
  points: Point[];
  name: string;
  color: string;
  visible: boolean;
  area?: number; // in square meters
  perimeter?: number; // in meters
}

export interface SnappingSettings {
  enabled: boolean;
  endpoints: boolean;
  midpoints: boolean;
  intersections: boolean;
  centers: boolean;
  threshold: number; // pixels or meters
}
