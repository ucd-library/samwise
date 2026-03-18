import config from './config.js';
import logger from './logger.js';

let models = null;
let modelRoutes = null;

let loadingModels = false;

async function getModels() {
  if (models) return models;
  if (loadingModels) {
    return await loadingModels;
  }

  loadingModels = loadModels();
  return await loadingModels;
}

async function loadModels() {
  logger.info('Loading models from configured Ollama hosts...');

  let tmpRoutes = {};
  let tmpModels = {};

  for( let host of config.routing.hosts) {
    let isCloud = host.includes('ollama.com');
    try {
      const res = await fetch(`${host}/api/tags`);
      if (!res.ok) {
        logger.warn(`Failed to fetch models from ${host}: ${res.status} ${res.statusText}`);
        continue;
      }
      const data = await res.json();

      for (const model of data.models) {
        if( !tmpModels[model.name] ) {
          if( isCloud ) {
            model.name += ` (${new URL(host).host})`;
          }

          tmpRoutes[model.name] = {hosts: [host]};
          tmpModels[model.name] = model;
        } else {
          tmpRoutes[model.name].hosts.push(host);
        }
      }
    } catch (err) {
      logger.warn(`Error fetching models from ${host}: ${err.message}`);
    }
  }

  models = tmpModels;
  modelRoutes = tmpRoutes;
  loadingModels = false;
  config.routing.routeMap = new Map(Object.entries(tmpRoutes).map(([model, info]) => [model.toUpperCase(), info.hosts[0]]));

  return {models, modelRoutes};
}

export { getModels };