import config from './config.js';
import logger from './logger.js';

let psResult = null;

let loading = false;

async function ps() {
  if (psResult) return psResult;
  
  if (loading) {
    return await loading;
  }

  loading = runPs();

  setTimeout(() => {
    psResult = null;
  }, 5 * 1000); 

  return await loading;
}

async function runPs() {
  logger.info('Fetching process information...');
  // Implementation for fetching process information

  let tmp = {};

  for( let host of config.routing.hosts) {
    try {
      const res = await fetch(`${host}/api/ps`);
      if (!res.ok) {
        logger.warn(`Failed to fetch process information from ${host}: ${res.status} ${res.statusText}`);
        continue;
      }
      const data = await res.json();

      console.log(host, data);

      for (const model of data.models) {
        if( !tmp[model.name] ) {
          tmp[model.name] = model;
        }
      }
    } catch (err) {
      logger.warn(`Error fetching models from ${host}: ${err.message}`);
    }
  }

  psResult = tmp;

  console.log('ps', psResult);
  return psResult;
}

export default ps ;