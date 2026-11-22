import type { DomainModule, GameContent } from '../contracts/types';
import { createCompanyModule } from '../modules/company';
import { createComputeModule } from '../modules/compute';
import { createResearchModule } from '../modules/research';
import { createLabModule } from '../modules/lab';
import { createProductsModule } from '../modules/products';
import { createAgentsModule } from '../modules/agents';
import { createMarketsModule } from '../modules/markets';
import { createCampaignModule } from '../modules/campaign';

/** One writer per durable slice; the coordinator owns ordering and settlement. */
export function createDefaultModules(content: GameContent): readonly DomainModule[] {
  return [createCompanyModule(content), createComputeModule(content), createLabModule(content), createResearchModule(content), createProductsModule(content), createAgentsModule(content), createMarketsModule(content), createCampaignModule()];
}
