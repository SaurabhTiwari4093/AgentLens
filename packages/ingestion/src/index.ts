export { buildGateway } from './gateway/server.js';
export { runWriter, type WriterHandle } from './writer/main.js';
export { writeSpans } from './writer/db.js';
export { ensurePartitions } from './writer/partition-job.js';
export { encodeSpanRow } from './writer/copy.js';
export { config } from './config.js';
