const { tmpdir } = require('os');
const path = require('path');
const http = require('http');
const { stat, unlink } = require('fs').promises;

const config = require('config');
const Koa = require('koa');
const Router = require('koa-router');
const send = require('koa-send');

const { renderTile } = require('./renderrer');
const { mapnikConfig } = require('./style');

const app = new Koa();
const router = new Router();

const minZoom = config.get('zoom.min');
const maxZoom = config.get('zoom.max');

const serverPort = config.get('server.port');

const tilesDir = path.resolve(__dirname, '..', config.get('dirs.tiles'));

router.get('/:zoom/:x/:y', async (ctx) => {
  const { zoom, x, y } = ctx.params;
  if (zoom < minZoom || zoom > maxZoom) {
    return;
  }
  const file = await renderTile(Number.parseInt(zoom, 10), Number.parseInt(x, 10), Number.parseInt(y, 10), false);
  const stats = await stat(file);

  ctx.status = 200;
  ctx.set('Last-Modified', stats.mtime.toUTCString());

  if (ctx.fresh) {
    ctx.status = 304;
    return;
  }

  await send(ctx, `${zoom}/${x}/${y}.png`, { root: tilesDir });
});

let tmpIndex = Date.now();

// example: http://localhost:4000/pdf?zoom=13&bbox=21.4389,48.6531,21.6231,48.7449&scale=0.75
router.get('/pdf', async (ctx) => {
  const zoom = Number.parseInt(ctx.query.zoom, 10);
  const bbox = (ctx.query.bbox || '').split(',').map((c) => Number.parseFloat(c));
  if (zoom < 0 || zoom > 20 || bbox.length !== 4 || bbox.some((c) => Number.isNaN(c))) {
    ctx.status = 400;
    return;
  }
  const filename = `export-${tmpIndex++}.pdf`;
  const exportFile = path.resolve(tmpdir(), filename);
  try {
    await renderTile.toPdf(exportFile, mapnikConfig, zoom, bbox,
      Number.parseFloat(ctx.query.scale) || undefined,
      Number.parseFloat(ctx.query.width) || undefined,
    );
    ctx.status = 200;
    await send(ctx, filename, { root: tmpdir() });
  } finally {
    await unlink(exportFile);
  }
});

app
  .use(router.routes())
  .use(router.allowedMethods());

const server = http.createServer(app.callback());

function listenHttp() {
  server.listen(serverPort, () => {
    console.log(`Listening on port ${serverPort}.`);
  });
}

function closeServer() {
  server.close();
}

module.exports = { listenHttp, closeServer };