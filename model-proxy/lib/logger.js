import {createLogger} from '@ucd-lib/logger';
import config from './config.js';

const logger = createLogger({
  name : config.logger.name,
  level : config.logger.level
});

export default logger;