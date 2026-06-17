
const KEY = process.env.SAMWISE_API_KEY;
const HOST = process.env.SAMWISE_API_HOST || 'https://samwise.library.ucdavis.edu';
const PATH = process.env.SAMWISE_BASE_API_PATH || '/api';
const args = process.argv.slice(2);

if( !args.length ) {
  console.error('Usage: node tooling-enabled.js <model>');
  process.exit(1);
}
if( !KEY ) {
  console.error('Environment variable SAMWISE_API_KEY is not set');
  process.exit(1);
}

const MODEL = args[0];
console.log(`Using model: ${MODEL}`);
console.log(`Using url: ${HOST}${PATH}/chat/completions`);

const res = await fetch(`${HOST}${PATH}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: 'What is the weather in Sacramento?' }],
    tools: [{
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query']
        }
      }
    }]
  })
});
const data = await res.json();

if( data.detail === 'Model not found' ) {
  console.log(`Model ${MODEL} not found`);
  let models = await fetch(`${HOST}${PATH}/models`, {
    headers: { 'Authorization': `Bearer ${KEY}` }
  });
  console.log('Available models:', (await models.json()).data.map(model => model.id).join(', '));
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
