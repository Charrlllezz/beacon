import festivalData from '../../config/festivals/lib-2026.json';
import type { FestivalConfig, Stage, ScheduleSlot, POI } from '../../types/festival';
import { haversineDistance } from '../../utils/coordinates';

class FestivalConfigService {
  private config: FestivalConfig = festivalData as FestivalConfig;

  getConfig(): FestivalConfig {
    return this.config;
  }

  getStage(stageId: string): Stage | undefined {
    return this.config.stages.find(s => s.id === stageId);
  }

  getAllStages(): Stage[] {
    return this.config.stages;
  }

  getAllPOIs(): POI[] {
    return this.config.pois;
  }

  getNowPlaying(stageId: string, now = new Date()): ScheduleSlot | undefined {
    const stage = this.getStage(stageId);
    if (!stage) return undefined;
    return stage.schedule.find(slot => {
      const start = new Date(slot.start);
      const end = new Date(slot.end);
      return now >= start && now <= end;
    });
  }

  getUpNext(stageId: string, now = new Date()): ScheduleSlot | undefined {
    const stage = this.getStage(stageId);
    if (!stage) return undefined;
    const upcoming = stage.schedule
      .filter(slot => new Date(slot.start) > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return upcoming[0];
  }

  getNearestStage(lat: number, lng: number): Stage | undefined {
    if (!this.config.stages.length) return undefined;
    return this.config.stages.reduce((nearest, stage) => {
      const dNearest = haversineDistance(lat, lng, nearest.location.lat, nearest.location.lng);
      const dCurrent = haversineDistance(lat, lng, stage.location.lat, stage.location.lng);
      return dCurrent < dNearest ? stage : nearest;
    });
  }
}

export const festivalConfig = new FestivalConfigService();
