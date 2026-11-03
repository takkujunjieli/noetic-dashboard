import {initUniverse} from './qlib-universe.js?v=20261102-history';
import {initObservations} from './market-observations.js?v=20261102';
import {initAttribution} from './factor-attribution.js?v=20261101';
document.getElementById('qlib-notice').textContent='观察过去的涨跌及其因子贡献。归因是统计解释，未解释收益不等于公司 alpha，也不是未来收益预测。';
initObservations();
initAttribution();
if(['localhost','127.0.0.1','[::1]'].includes(location.hostname))initUniverse();
