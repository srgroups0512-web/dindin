import 'dotenv/config';
import {DataStore} from './store.js';

const store = new DataStore();
try {
  await store.connect();
  await store.health();
  console.log(`Database connection healthy (${store.mode}).`);
} finally {
  await store.close();
}
