const http = require('node:http');

const PORT = Number(process.env.NOTIFICATIONS_PORT || 3003);
const INTERNAL_SECRET =
  process.env.SERVICE_SECRET || 'clave-interna-local-demo';

const sentNotifications = [];
let nextId = 1;

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';

  for await (const chunk of req) {
    body += chunk;
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('JSON inválido.');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      service: 'notifications-service',
      status: 'ok',
    });
  }

  if (req.method !== 'POST' || url.pathname !== '/internal/notifications') {
    return json(res, 404, {
      error: 'Ruta no encontrada en Notifications Service.',
    });
  }

  if (req.headers['x-service-key'] !== INTERNAL_SECRET) {
    return json(res, 401, {
      error: 'Credencial de servicio inválida.',
    });
  }

  try {
    const { orderId, customer, status } = await readJson(req);

    if (!orderId || !customer || status !== 'ENTREGADO') {
      return json(res, 400, {
        error: 'Datos de notificación inválidos.',
      });
    }

    const notification = {
      id: nextId++,
      orderId,
      recipient: customer,
      message: `Tu pedido #${orderId} fue entregado.`,
      createdAt: new Date().toISOString(),
    };

    sentNotifications.unshift(notification);
    console.log(
      `Notificación enviada a ${customer}: pedido #${orderId} entregado`,
    );

    return json(res, 201, { notification });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
});

server.on('error', (error) => {
  const message =
    error.code === 'EADDRINUSE'
      ? `el puerto ${PORT} ya está ocupado`
      : error.message;

  console.error(`Notifications Service: ${message}`);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Notifications Service escuchando en http://localhost:${PORT}`);
});
