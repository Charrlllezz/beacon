import type { SFSymbol } from 'expo-symbols';
import type { TagCategory } from '../../types/festival';

// SF Symbol per tag category (map pins, the tag sheet).
export const TAG_CATEGORY_ICONS: Record<TagCategory, SFSymbol> = {
  stage: 'music.note',
  food: 'fork.knife',
  water: 'drop.fill',
  restroom: 'toilet',
  camp: 'tent',
  custom: 'mappin',
};
