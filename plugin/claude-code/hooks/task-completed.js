#!/usr/bin/env node
// Thin shim — delegates to compiled TypeScript handler
import { handle } from '../dist/hooks/handler.js';
await handle('task-completed');
