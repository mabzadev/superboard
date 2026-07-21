import { Hono } from 'hono';
import { Env } from '../types';

const notifications = new Hono<{ Bindings: Env }>();

// OpenGrow upstream compatibility: unauthenticated diagnostics endpoint.
notifications.get('/test', (c) => c.json({ notifications: 'asdasda' }));

export default notifications;
