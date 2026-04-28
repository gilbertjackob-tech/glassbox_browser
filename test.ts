import { tabManager } from './src/server/tabManager.js';
console.log(typeof tabManager.createTabSync);
try {
  tabManager.createTabSync('default');
  console.log('Success creating tab!');
} catch(e) {
  console.error(e);
}
