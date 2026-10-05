import { Nav, Masthead, MoodTabs } from './components/Shell.jsx';
import { ProfileCard, Calibrate } from './components/Sidebar.jsx';
import { Stage } from './components/Stage.jsx';
import NowPlaying from './components/NowPlaying.jsx';
import Dialogs from './components/Dialogs.jsx';
import Toasts from './components/Toasts.jsx';
import Noise from './components/reactbits/Noise.jsx';
import { WarmTooltipGroup } from './components/reactbits/WarmTooltip.jsx';
import { useStore } from './app/useStore.js';

export default function App() {
  const s = useStore();
  return (
    <WarmTooltipGroup>
      <div className="app">
        <a className="skip" href="#main">Skip to results</a>
        <Nav />
        <Masthead />
        <MoodTabs />
        <main id="main" className="layout">
          <aside className="side" aria-label="Profile and calibration">
            <ProfileCard />
            <Calibrate />
          </aside>
          {s.ready ? <Stage /> : <p className="muted loading">Loading the catalog</p>}
        </main>
        <NowPlaying />
        <Dialogs />
        <Toasts />
        {/* grain: one static frame on a fixed, click-through layer */}
        <div className="noise-layer" aria-hidden="true"><Noise patternAlpha={10} patternRefreshInterval={100000} /></div>
      </div>
    </WarmTooltipGroup>
  );
}
