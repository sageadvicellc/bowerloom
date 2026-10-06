// Read-only compatibility command. Never rewrite Content sources or README.
import {getDocuments} from '../src/lib/content.mjs';
const documents = await getDocuments();
console.log(JSON.stringify({mode:'checked-in-memory',pages:documents.length,sourceWrites:0}));
