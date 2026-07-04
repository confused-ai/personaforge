import DefaultTheme from 'vitepress/theme';
import './style.css';

import AnnouncementBanner from './components/AnnouncementBanner.vue';
import HeroStats from './components/HeroStats.vue';
import CodeDemo from './components/CodeDemo.vue';
import BatteriesIncluded from './components/BatteriesIncluded.vue';
import ProvidersGrid from './components/ProvidersGrid.vue';
import ComparisonSection from './components/ComparisonSection.vue';
import EnterpriseSection from './components/EnterpriseSection.vue';
import DelightfulDX from './components/DelightfulDX.vue';
import CtaBanner from './components/CtaBanner.vue';
import HonoCards from './components/HonoCards.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('AnnouncementBanner', AnnouncementBanner);
    app.component('HeroStats', HeroStats);
    app.component('CodeDemo', CodeDemo);
    app.component('BatteriesIncluded', BatteriesIncluded);
    app.component('ProvidersGrid', ProvidersGrid);
    app.component('ComparisonSection', ComparisonSection);
    app.component('EnterpriseSection', EnterpriseSection);
    app.component('DelightfulDX', DelightfulDX);
    app.component('CtaBanner', CtaBanner);
    app.component('HonoCards', HonoCards);
  },
};
