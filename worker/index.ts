import { Hono } from 'hono';
import { loadSessionMiddleware } from './auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Attach session middleware to all API requests
app.use('/api/*', loadSessionMiddleware);

// Mount API routes
app.route('/api', authRoutes);
app.route('/api', projectRoutes);
app.route('/api/admin', adminRoutes);

app.all('/api/*', (c) => c.json({ error: 'API endpoint không tồn tại' }, 404));

// Clean share URL redirect: /share/<token> -> /?share=<token>
app.get('/share/:token', (c) => {
  const token = c.req.param('token');
  const url = new URL(c.req.url);
  return c.redirect(`${url.origin}/?share=${encodeURIComponent(token)}`, 302);
});

// Serve Admin SPA entry at /admin and /admin/*
// Note: Cloudflare Workers Assets canonicalizes /admin.html -> /admin (307),
// so fetch /admin directly to avoid a redirect loop.
app.get('/admin', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});
app.get('/admin/*', async (c) => {
  const url = new URL('/admin', c.req.url);
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

// Fallback to Cloudflare Static Assets
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
