import * as ebayService from "./ebayService.js";
import * as traderaService from "./traderaService.js";
import * as dbaService from "./dbaService.js";
import * as vintedService from "./vintedService.js";
import * as sellpyService from "./sellpyService.js";
import * as grailedService from "./grailedService.js";
import * as kleinanzeigenService from "./kleinanzeigenService.js";
import * as momoxService from "./momoxService.js";
import * as vestiaireService from "./vestiaireService.js";

import { 
    marrktService, 
    secondFootballShirtsService, 
    supersaelgerService 
} from './shopifyScraper.js';

// Sikkerhed for at Shopify scraperne pakkes ud uanset hvordan de eksporteres
const getSearchObj = (mod) => mod.service ? mod.service : mod;

console.log("🚀 Services loaded:", {
    eBay: typeof ebayService.search === 'function' ? 'OK' : 'MISSING',
    Tradera: typeof traderaService.search === 'function' ? 'OK' : 'MISSING',
    DBA: typeof dbaService.search === 'function' ? 'OK' : 'MISSING',
    Vinted: typeof vintedService.search === 'function' ? 'OK' : 'MISSING',
    Sellpy: typeof sellpyService.search === 'function' ? 'OK' : 'MISSING',
    Grailed: typeof grailedService.search === 'function' ? 'OK' : 'MISSING',
    Kleinanzeigen: typeof kleinanzeigenService?.search === 'function' ? 'OK' : 'MISSING',
    Momox: typeof momoxService.search === 'function' ? 'OK' : 'MISSING',
    Vestiaire: typeof vestiaireService.search === 'function' ? 'OK' : 'MISSING',
    Marrkt: typeof getSearchObj(marrktService).search === 'function' ? 'OK' : 'MISSING',
    "Second Football Shirts": typeof getSearchObj(secondFootballShirtsService).search === 'function' ? 'OK' : 'MISSING',
    "Supersælger": typeof getSearchObj(supersaelgerService).search === 'function' ? 'OK' : 'MISSING'
});

const services = {
  eBay: ebayService,
  Tradera: traderaService,
  DBA: dbaService,
  Vinted: vintedService,
  Sellpy: sellpyService,
  Grailed: grailedService,
  Kleinanzeigen: kleinanzeigenService,
  Momox: momoxService,
  Vestiaire: vestiaireService,
  // Brug vores sikkerheds-funktion, så de virker direkte:
  Marrkt: getSearchObj(marrktService),
  "Second Football Shirts": getSearchObj(secondFootballShirtsService),
  "Supersælger": getSearchObj(supersaelgerService)
};

export const allServices = Object.entries(services).map(([name, service]) => ({
  name,
  service,
}));

export { 
    ebayService, 
    traderaService, 
    dbaService, 
    vintedService, 
    sellpyService, 
    grailedService,
    kleinanzeigenService,
    momoxService,
    vestiaireService,
    marrktService,
    secondFootballShirtsService,
    supersaelgerService,
    services as default
};
