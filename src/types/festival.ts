export interface GpsPoint {
  lat: number;
  lng: number;
}

export interface ScheduleSlot {
  artistId: string;
  artistName: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export interface Stage {
  id: string;
  name: string;
  shortName: string;
  color: string;
  emoji?: string;
  location: GpsPoint;
  schedule: ScheduleSlot[];
}

export interface POI {
  id: string;
  type: 'medical' | 'water' | 'food' | 'restroom' | 'camping' | 'info' | 'entrance';
  name: string;
  location: GpsPoint;
  icon: string;
}

export type TagCategory = 'stage' | 'food' | 'water' | 'restroom' | 'camp' | 'custom';

export type TagScope = 'crew' | 'community';

export interface TaggedPOI {
  id: string;
  name: string;
  category: TagCategory;
  scope: TagScope;
  lat: number;
  lng: number;
  createdBy: string;
  createdAt: number;
  confirmCount: number;
}

export interface GeoBounds {
  ne: GpsPoint;
  sw: GpsPoint;
}

export interface FestivalConfig {
  $schema: string;
  festival: {
    id: string;
    name: string;
    shortName: string;
    dates: { start: string; end: string };
    timezone: string;
  };
  venue: {
    name?: string;
    center: GpsPoint;
    // The grounds themselves.
    bounds: GeoBounds;
    // Offline satellite area: usually wider than the grounds (parking,
    // camping, shuttle stops, transit). Falls back to `bounds`.
    tileBounds?: GeoBounds;
  };
  stages: Stage[];
  pois: POI[];
}
