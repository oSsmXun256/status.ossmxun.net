import { readFileSync } from 'node:fs';

export interface ServiceDefinition {
  id: string;
  name: string;
  host: string;
  group: string;
  monitorId: number;
}

const configPath = new URL('../../src/data/services.json', import.meta.url);
export const services = JSON.parse(readFileSync(configPath, 'utf8')) as ServiceDefinition[];
