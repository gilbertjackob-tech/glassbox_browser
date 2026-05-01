// Dev-only standalone server. Not used in production Electron build.
import { startApiServer } from '../src/main/apiServer.js';

startApiServer().catch(console.error);
