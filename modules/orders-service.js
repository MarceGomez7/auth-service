const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.ORDERS_PORT || 3000);
const OIDC_ISSUER = process.env.OIDC_ISSUER || 'http://localhost:8080/realms/delivery';
const OIDC_METADATA_URL = process.env.OIDC_METADATA_URL || `${OIDC_ISSUER}/.well-known/openid-configuration`;
const OIDC_INTERNAL_BASE_URL = process.env.OIDC_INTERNAL_BASE_URL || '';
const API_AUDIENCE = 'orders-api';
const CATALOG_URL = process.env.CATALOG_URL || `http://localhost:${Number(process.env.CATALOG_PORT || 3002)}`;
const NOTIFICATIONS_URL = process.env.NOTIFICATIONS_URL || `http://localhost:${Number(process.env.NOTIFICATIONS_PORT || 3003)}`;
const SERVICE_SECRET = process.env.SERVICE_SECRET || 'clave-interna-local-demo';
const INDEX = path.join(__dirname, '..', 'public', 'index.html');
let nextId = 105;
let orders = [
  { id: 101, customer: 'Sofía Cliente', items: '2 × Café latte · 1 × Croissant', address: 'Av. Santa Fe 1850, Recoleta', total: 8700, status: 'PENDIENTE', createdAt: '12:35' },
  { id: 102, customer: 'Valentina Ríos', items: '1 × Ensalada de estación', address: 'Junín 640, Balvanera', total: 9200, status: 'PREPARANDO', createdAt: '12:42' },
  { id: 103, customer: 'Tomás Acosta', items: '1 × Sándwich de campo · 1 × Limonada', address: 'Paraná 920, Retiro', total: 12400, status: 'EN CAMINO', createdAt: '12:49', courier: 'Mateo Repartidor' },
  { id: 104, customer: 'Camila Torres', items: '3 × Empanadas de carne', address: 'Uruguay 310, San Nicolás', total: 7800, status: 'PENDIENTE', createdAt: '12:53' },
];

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function readJson(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 20000) throw new Error('Solicitud demasiado grande.'); }
  try { return JSON.parse(text || '{}'); } catch { throw new Error('El cuerpo debe ser JSON válido.'); }
}
let oidcMetadata = null;
let jwksCache = { keys: [], expiresAt: 0 };
async function getOidcMetadata() {
  if (oidcMetadata) return oidcMetadata;
  const response = await fetch(OIDC_METADATA_URL);
  if (!response.ok) throw new Error('No se pudo consultar el proveedor OIDC.');
  oidcMetadata = await response.json();
  return oidcMetadata;
}
async function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token inválido: formato incorrecto.');
  const [headerPart, payloadPart, signature] = parts;
  let header, claims;
  try { header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()); claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()); }
  catch { throw new Error('Token inválido: no se pudo leer.'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Token inválido: algoritmo o clave no permitidos.');
  if (claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('Token vencido. Iniciá sesión para obtener uno nuevo.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== OIDC_ISSUER || !aud.includes(API_AUDIENCE)) throw new Error('Token emitido para otro servicio.');
  const metadata = await getOidcMetadata();
  if (Date.now() > jwksCache.expiresAt) {
    const jwksUrl = OIDC_INTERNAL_BASE_URL ? `${OIDC_INTERNAL_BASE_URL}${new URL(metadata.jwks_uri).pathname}` : metadata.jwks_uri;
    const response = await fetch(jwksUrl);
    if (!response.ok) throw new Error('No se pudieron consultar las claves JWKS.');
    jwksCache = { keys: (await response.json()).keys, expiresAt: Date.now() + 300000 };
  }
  const jwk = jwksCache.keys.find(key => key.kid === header.kid && key.use === 'sig');
  if (!jwk) { jwksCache.expiresAt = 0; throw new Error('Clave de firma del token desconocida.'); }
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), publicKey, Buffer.from(signature, 'base64url'));
  if (!valid) throw new Error('Token inválido: firma incorrecta.');
  return claims;
}
async function authenticate(req, res) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { send(res, 401, { error: 'Falta el token Bearer.' }); return null; }
  try { return await verifyToken(auth.slice(7)); }
  catch (error) { send(res, 401, { error: error.message }); return null; }
}
function requireRole(res, claims, roles) {
  const tokenRoles = claims.realm_access?.roles || [];
  const granted = roles.some(role => tokenRoles.includes(role));
  if (granted) return true;
  send(res, 403, { error: `Permiso denegado. Se requiere rol: ${roles.join(' o ')}.`, roles_recibidos: tokenRoles });
  return false;
}
function logResult(req, status, role = 'anónimo') {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${status} [${role}]`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(INDEX, 'utf8'), 'text/html; charset=utf-8');
  if (url.pathname === '/health') return send(res, 200, { service: 'orders-service', status: 'ok' });
  if (url.pathname.startsWith('/api/')) {
    const claims = await authenticate(req, res);
    if (!claims) { logResult(req, 401); return; }
    if (req.method === 'GET' && url.pathname === '/api/pedidos') {
      const roles = claims.realm_access?.roles || [];
      const visible = roles.includes('CLIENTE') ? orders.filter(order => order.customer === claims.name || order.customer === `${claims.given_name || ''} ${claims.family_name || ''}`.trim()) : orders;
      logResult(req, 200, roles.join(',')); return send(res, 200, { pedidos: visible, roles, user: claims.preferred_username });
    }
    if (req.method === 'POST' && url.pathname === '/api/pedidos') {
      if (!requireRole(res, claims, ['CLIENTE'])) { logResult(req, 403, (claims.realm_access?.roles || []).join(',')); return; }
      try {
        const { products: requestedProducts, address } = await readJson(req);
        const catalogResponse = await fetch(`${CATALOG_URL}/catalog/products`);
        const catalogData = await catalogResponse.json();
        const catalog = new Map(catalogData.products.map(product => [product.id, product]));
        const selected = Array.isArray(requestedProducts) ? requestedProducts : [];
        if (selected.some(item => !catalog.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1)) { logResult(req, 400, (claims.realm_access?.roles || []).join(',')); return send(res, 400, { error: 'Hay productos o cantidades inválidos.' }); }
        const items = selected.map(item => `${item.quantity} × ${catalog.get(item.id).name}`).join(' · ');
        if (!items || !address) { logResult(req, 400, (claims.realm_access?.roles || []).join(',')); return send(res, 400, { error: 'Elegí productos e indicá una dirección de entrega.' }); }
        const total = selected.reduce((sum, item) => sum + catalog.get(item.id).price * item.quantity, 0);
        const customer = `${claims.given_name || ''} ${claims.family_name || ''}`.trim() || claims.preferred_username;
        const order = { id: nextId++, customer, items: items.slice(0, 180), address: String(address).slice(0, 180), total, status: 'PENDIENTE', createdAt: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) };
        orders.unshift(order); logResult(req, 201, (claims.realm_access?.roles || []).join(',')); return send(res, 201, { pedido: order, mensaje: 'Pedido creado.' });
      } catch (error) { logResult(req, 400, (claims.realm_access?.roles || []).join(',')); return send(res, 400, { error: error.message }); }
    }
    const delivered = url.pathname.match(/^\/api\/pedidos\/(\d+)\/entregado$/);
    if (req.method === 'PUT' && delivered) {
      if (!requireRole(res, claims, ['REPARTIDOR'])) { logResult(req, 403, (claims.realm_access?.roles || []).join(',')); return; }
      const order = orders.find(item => item.id === Number(delivered[1]));
      if (!order) { logResult(req, 404, (claims.realm_access?.roles || []).join(',')); return send(res, 404, { error: 'No existe ese pedido.' }); }
      order.status = 'ENTREGADO'; order.courier = `${claims.given_name || ''} ${claims.family_name || ''}`.trim() || claims.preferred_username;
      try {
        const notificationResponse = await fetch(`${NOTIFICATIONS_URL}/internal/notifications`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-key': SERVICE_SECRET }, body: JSON.stringify({ orderId: order.id, customer: order.customer, status: order.status }) });
        if (!notificationResponse.ok) console.error(`Notifications Service respondió HTTP ${notificationResponse.status}`);
        else console.log(`Orders Service notificó la entrega del pedido #${order.id}`);
      } catch (error) { console.error(`No se pudo contactar Notifications Service: ${error.message}`); }
      logResult(req, 200, (claims.realm_access?.roles || []).join(',')); return send(res, 200, { pedido: order, mensaje: 'Pedido marcado como entregado.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/catalogo') {
      if (!requireRole(res, claims, ['CLIENTE'])) { logResult(req, 403, (claims.realm_access?.roles || []).join(',')); return; }
      try { const response = await fetch(`${CATALOG_URL}/catalog/products`); const data = await response.json(); logResult(req, 200, 'CLIENTE'); return send(res, 200, data); }
      catch (error) { logResult(req, 503, 'CLIENTE'); return send(res, 503, { error: `Catalog Service no disponible: ${error.message}` }); }
    }
  }
  logResult(req, 404); return send(res, 404, { error: 'Ruta no encontrada.' });
});
server.on('error', error => { console.error(`Orders Service: ${error.code === 'EADDRINUSE' ? `el puerto ${PORT} ya está ocupado` : error.message}`); process.exitCode = 1; });
server.listen(PORT, '0.0.0.0', () => console.log(`Orders Service (app + API) escuchando en http://localhost:${PORT}`));
