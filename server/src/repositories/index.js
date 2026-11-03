// Builds every repository once, at start-up, so all SQL statements are prepared a single time.
import { createUsersRepository } from './users.js';
import { createSessionsRepository } from './sessions.js';
import { createCategoriesRepository, createCollectionsRepository } from './taxonomy.js';
import { createPerfumesRepository } from './perfumes.js';
import { createOrdersRepository } from './orders.js';
import { createEventsRepository } from './events.js';
import {
  createImagesRepository, createGuideRepository,
  createSettingsRepository, createActivityRepository,
} from './content.js';
import { SETTINGS_FIELDS } from './settings-fields.js';

export function createRepositories(db) {
  return {
    db,
    users: createUsersRepository(db),
    sessions: createSessionsRepository(db),
    categories: createCategoriesRepository(db),
    collections: createCollectionsRepository(db),
    perfumes: createPerfumesRepository(db),
    orders: createOrdersRepository(db),
    events: createEventsRepository(db),
    images: createImagesRepository(db),
    guide: createGuideRepository(db),
    settings: createSettingsRepository(db, SETTINGS_FIELDS),
    activity: createActivityRepository(db),
  };
}
