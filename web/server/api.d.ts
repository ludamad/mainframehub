import { Express } from 'express';
import { DiscoveryService } from '../../src/services/discovery.js';
import { PRService } from '../../src/services/pr-service.js';
interface APIServices {
    discovery: DiscoveryService;
    prService: PRService;
    config: any;
}
export declare function setupAPI(app: Express, services: APIServices): void;
export {};
//# sourceMappingURL=api.d.ts.map