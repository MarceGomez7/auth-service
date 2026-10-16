const http = require('node:http');
const PORT = Number(process.env.CATALOG_PORT || 3002);
const products = [
  { id: 'caf-01', name: 'Café latte', price: 3200, available: true },
  { id: 'bak-02', name: 'Croissant', price: 1800, available: true },
  { id: 'lun-03', name: 'Ensalada de estación', price: 9200, available: true },
  { id: 'sand-04', name: 'Sándwich de campo', price: 7800, available: true },
  { id: 'bev-05', name: 'Limonada', price: 2400, available: true },
];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/health') return res.end(JSON.stringify({ service: 'catalog-service', status: 'ok' }));
  if (req.method === 'GET' && url.pathname === '/catalog/products') return res.end(JSON.stringify({ products }));
  if (req.method === 'GET' && url.pathname.startsWith('/catalog/products/')) {
    const product = products.find(item => item.id === url.pathname.split('/').pop());
    res.statusCode = product ? 200 : 404;
    return res.end(JSON.stringify(product || { error: 'Producto no encontrado.' }));
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: 'Ruta no encontrada en Catalog Service.' }));
});
server.on('error', error => { console.error(`Catalog Service: ${error.code === 'EADDRINUSE' ? `el puerto ${PORT} ya está ocupado` : error.message}`); process.exitCode = 1; });
server.listen(PORT, '0.0.0.0', () => console.log(`Catalog Service escuchando en http://localhost:${PORT}`));
