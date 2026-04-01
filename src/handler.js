import { quoteRoute }  from './routes/quote.js';
import { configRoute } from './routes/config.js';

export function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  const method = event.requestContext.http.method;
  const rawPath = event.requestContext.http.path;
  const path = rawPath.replace(/^\/prod/, '');

  try {
    if (method === 'POST' && path === '/quote')          return await quoteRoute(event);
    if (method === 'GET'  && path === '/pricing-config') return await configRoute.get(event);
    if (method === 'PUT'  && path === '/pricing-config') return await configRoute.put(event);
    return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('Handler error:', err);
    return respond(500, { error: err.message || String(err), stack: err.stack });
  }
};
