import {initUniverse} from './qlib-universe.js?v=20261103-en';
import {initObservations} from './market-observations.js?v=20261103-en';
import {initAttribution} from './factor-attribution.js?v=20261103-en';
document.getElementById('qlib-notice').textContent='Review historical returns and their factor contributions. Attribution is a statistical explanation; unexplained return is not proven company alpha or a forecast.';
initObservations();
initAttribution();
if(['localhost','127.0.0.1','[::1]'].includes(location.hostname))initUniverse();
